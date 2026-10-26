import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { config } from '../config.js'
import { prisma } from '../db.js'

export const SCOPES = ['playlist-read-private', 'playlist-read-collaborative', 'user-library-read']

export function isConfigured() {
  return Boolean(config.SPOTIFY_CLIENT_ID && config.SPOTIFY_CLIENT_SECRET && config.SPOTIFY_REDIRECT_URI)
}

export class SpotifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

// --- Token encryption ---------------------------------------------------------
// Tokens are encrypted at rest with a key derived from the client secret: a
// database dump alone doesn't give access to anyone's Spotify account.

function key() {
  return createHash('sha256').update(`spotifiak-token:${config.SPOTIFY_CLIENT_SECRET}`).digest()
}

function encrypt(plain: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.')
}

function decrypt(stored: string) {
  const [iv, tag, data] = stored.split('.').map((p) => Buffer.from(p, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

// --- OAuth --------------------------------------------------------------------

const STATE_TTL_MS = 10 * 60 * 1000
const pendingStates = new Map<string, { userId: string; returnTo: string; expiresAt: number }>()

/** Authorization URL; the state ties Spotify's callback to this user without a cookie. */
export function authorizeUrl(userId: string, returnTo: string) {
  const state = randomBytes(24).toString('base64url')
  pendingStates.set(state, { userId, returnTo, expiresAt: Date.now() + STATE_TTL_MS })
  for (const [s, v] of pendingStates) if (v.expiresAt < Date.now()) pendingStates.delete(s)

  const url = new URL('/authorize', config.SPOTIFY_ACCOUNTS_URL)
  url.search = new URLSearchParams({
    client_id: config.SPOTIFY_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: config.SPOTIFY_REDIRECT_URI!,
    scope: SCOPES.join(' '),
    state,
  }).toString()
  return url.toString()
}

/** Single use: a replayed or expired state is rejected. */
export function consumeState(state: string) {
  const entry = pendingStates.get(state)
  pendingStates.delete(state)
  return entry && entry.expiresAt > Date.now() ? entry : null
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const basic = Buffer.from(`${config.SPOTIFY_CLIENT_ID}:${config.SPOTIFY_CLIENT_SECRET}`).toString('base64')
  const res = await fetch(new URL('/api/token', config.SPOTIFY_ACCOUNTS_URL), {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new SpotifyError(`Spotify token request failed: ${res.status} ${await res.text()}`, res.status)
  return (await res.json()) as TokenResponse
}

/** Exchanges the callback code and stores the (encrypted) tokens for the user. */
export async function connect(userId: string, code: string) {
  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.SPOTIFY_REDIRECT_URI!,
  })
  if (!tokens.refresh_token) throw new SpotifyError('Spotify did not return a refresh token', 502)

  const me = await rawGet<{ id: string; display_name: string | null }>('/me', tokens.access_token)
  const data = {
    spotifyUserId: me.id,
    displayName: me.display_name,
    accessToken: encrypt(tokens.access_token),
    refreshToken: encrypt(tokens.refresh_token),
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
  }
  await prisma.spotifyAccount.upsert({ where: { userId }, create: { userId, ...data }, update: data })
}

export async function disconnect(userId: string) {
  await prisma.spotifyAccount.deleteMany({ where: { userId } })
}

// Refresh a minute early so a token never expires mid-import.
const REFRESH_MARGIN_MS = 60_000

async function accessToken(userId: string, forceRefresh = false) {
  const account = await prisma.spotifyAccount.findUnique({ where: { userId } })
  if (!account) throw new SpotifyError('Compte Spotify non connecté', 401)

  const expired = async () => {
    await disconnect(userId)
    return new SpotifyError('La connexion à Spotify a expiré, reconnectez votre compte', 401)
  }

  let stored: { access: string; refresh: string }
  try {
    stored = { access: decrypt(account.accessToken), refresh: decrypt(account.refreshToken) }
  } catch {
    // Encrypted with another client secret: unusable, the user must reconnect.
    throw await expired()
  }
  if (!forceRefresh && account.expiresAt.getTime() - REFRESH_MARGIN_MS > Date.now()) return stored.access

  let tokens: TokenResponse
  try {
    tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: stored.refresh })
  } catch (err) {
    // Spotify refused the refresh token (access revoked): reconnect. Network errors are
    // rethrown as is, so a flaky connection doesn't disconnect anyone.
    if (err instanceof SpotifyError && (err.status === 400 || err.status === 401)) throw await expired()
    throw err
  }
  await prisma.spotifyAccount.update({
    where: { userId },
    data: {
      accessToken: encrypt(tokens.access_token),
      // Spotify may rotate the refresh token.
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  })
  return tokens.access_token
}

// --- API ----------------------------------------------------------------------

const MAX_RATE_LIMIT_WAIT_S = 30

async function rawGet<T>(path: string, token: string): Promise<T> {
  const url = path.startsWith('http') ? path : `${config.SPOTIFY_API_URL}${path}`
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) })
    if (res.status === 429 && attempt < 3) {
      const wait = Math.min(Number(res.headers.get('retry-after') ?? 1), MAX_RATE_LIMIT_WAIT_S)
      await new Promise((r) => setTimeout(r, wait * 1000))
      continue
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      throw new SpotifyError(body?.error?.message ?? `Spotify ${res.status}`, res.status)
    }
    return (await res.json()) as T
  }
}

/** GET as the user, refreshing the token once if Spotify rejects it. */
export async function get<T>(userId: string, path: string): Promise<T> {
  try {
    return await rawGet<T>(path, await accessToken(userId))
  } catch (err) {
    if (err instanceof SpotifyError && err.status === 401) return rawGet<T>(path, await accessToken(userId, true))
    throw err
  }
}

interface Page<T> {
  items: T[]
  next: string | null
  total: number
}

/** Follows `next` links; Spotify pages hold at most 50 items. */
export async function getAll<T>(userId: string, path: string): Promise<T[]> {
  const all: T[] = []
  let next: string | null = path
  while (next) {
    const page: Page<T> = await get<Page<T>>(userId, next)
    all.push(...page.items)
    next = page.next
  }
  return all
}
