import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import cookie from '@fastify/cookie'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { config } from './config.js'
import { prisma } from './db.js'

export interface AuthUser {
  id: string
  username: string
  displayName: string
  role: 'admin' | 'user'
  /** Friends see what this user listens to. */
  shareActivity: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null
  }
}

const COOKIE_NAME = 'spotifiak_session'
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000
// Sliding sessions: extend expiry on use, but write to the database at most this often.
const SESSION_TOUCH_MS = 3600 * 1000

// Routes reachable without a session.
// /spotify/callback identifies the user by its OAuth state: Spotify requires a loopback
// IP redirect for http, which doesn't carry a session cookie set on localhost.
const PUBLIC_PREFIXES = ['/health', '/auth/', '/spotify/callback']

// --- Passwords ---------------------------------------------------------------

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 }

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))),
  )
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const { N, r, p, keylen, maxmem } = SCRYPT
  const hash = await scrypt(password, salt, keylen, { N, r, p, maxmem })
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$')
}

async function verifyPassword(password: string, stored: string) {
  const [algo, N, r, p, salt, hash] = stored.split('$')
  if (algo !== 'scrypt') return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  })
  return timingSafeEqual(actual, expected)
}

// Verified against when the username doesn't exist, so response time doesn't reveal it.
const dummyHash = hashPassword(randomBytes(16).toString('hex'))

// --- Sessions ----------------------------------------------------------------

const tokenId = (token: string) => createHash('sha256').update(token).digest('hex')

async function createSession(reply: FastifyReply, userId: string, userAgent?: string) {
  const token = randomBytes(32).toString('base64url')
  await prisma.session.create({
    data: {
      id: tokenId(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: userAgent?.slice(0, 255),
    },
  })
  reply.setCookie(COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE || reply.request.protocol === 'https',
    maxAge: SESSION_TTL_MS / 1000,
  })
}

const userSelect = { id: true, username: true, displayName: true, role: true, shareActivity: true } as const

async function userFromSession(req: FastifyRequest): Promise<AuthUser | null> {
  const token = req.cookies[COOKIE_NAME]
  if (!token) return null
  const session = await prisma.session.findUnique({
    where: { id: tokenId(token) },
    select: { id: true, expiresAt: true, lastUsedAt: true, user: { select: userSelect } },
  })
  if (!session) return null
  const now = Date.now()
  if (session.expiresAt.getTime() < now) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }
  if (now - session.lastUsedAt.getTime() > SESSION_TOUCH_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) },
    })
  }
  return session.user
}

// --- Brute-force protection --------------------------------------------------

const LOGIN_WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES_PER_IP = 20
const MAX_FAILURES_PER_USERNAME = 10
const failures = new Map<string, { count: number; resetAt: number }>()

function isLimited(key: string, max: number) {
  const entry = failures.get(key)
  if (!entry || entry.resetAt < Date.now()) return false
  return entry.count >= max
}

function recordFailure(key: string) {
  const now = Date.now()
  const entry = failures.get(key)
  if (!entry || entry.resetAt < now) failures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
  else entry.count++
}

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of failures) if (entry.resetAt < now) failures.delete(key)
}, LOGIN_WINDOW_MS).unref()

// --- Validation --------------------------------------------------------------

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, "3 à 32 caractères : lettres, chiffres, '.', '_' ou '-'")
const password = z.string().min(8, '8 caractères minimum').max(256)
const displayName = z.string().trim().min(1).max(50)
const role = z.enum(['admin', 'user'])

// --- Routes ------------------------------------------------------------------

export function requireAdmin(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (req.user?.role !== 'admin') {
    reply.code(403).send({ error: 'Réservé aux administrateurs' })
    return
  }
  done()
}

async function adminCount() {
  return prisma.user.count({ where: { role: 'admin' } })
}

/**
 * Installs session auth on the root instance. Call it directly (not through
 * app.register) and before other routes: a hook added inside a registered plugin
 * would only protect that plugin's own routes.
 */
export async function setupAuth(app: FastifyInstance) {
  await app.register(cookie)
  app.decorateRequest('user', null)

  app.addHook('onRequest', async (req, reply) => {
    req.user = await userFromSession(req)
    const path = req.url.split('?')[0]
    if (!req.user && !PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p))) {
      return reply.code(401).send({ error: 'Non connecté' })
    }
  })

  app.get('/auth/status', async (req) => {
    const users = await prisma.user.count()
    return { user: req.user, needsSetup: users === 0, signupOpen: users === 0 || config.ALLOW_SIGNUP }
  })

  app.post('/auth/register', async (req, reply) => {
    const body = z
      .object({ username, password, displayName: displayName.optional() })
      .parse(req.body)

    // Serializable so two simultaneous first sign-ups can't both become admin.
    const user = await prisma.$transaction(
      async (tx) => {
        const count = await tx.user.count()
        if (count > 0 && !config.ALLOW_SIGNUP) return null
        if (await tx.user.findUnique({ where: { username: body.username } })) return 'taken' as const
        return tx.user.create({
          data: {
            username: body.username,
            displayName: body.displayName ?? body.username,
            passwordHash: await hashPassword(body.password),
            role: count === 0 ? 'admin' : 'user',
          },
          select: userSelect,
        })
      },
      { isolationLevel: 'Serializable' },
    )
    if (user === null) return reply.code(403).send({ error: 'Les inscriptions sont fermées' })
    if (user === 'taken') return reply.code(409).send({ error: "Ce nom d'utilisateur est déjà pris" })

    await createSession(reply, user.id, req.headers['user-agent'])
    return reply.code(201).send({ user })
  })

  app.post('/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string().trim().toLowerCase().max(64), password: z.string().max(256) }).parse(req.body)
    const ipKey = `ip:${req.ip}`
    const userKey = `user:${body.username}`
    if (isLimited(ipKey, MAX_FAILURES_PER_IP) || isLimited(userKey, MAX_FAILURES_PER_USERNAME)) {
      return reply.code(429).send({ error: 'Trop de tentatives, réessayez dans quelques minutes' })
    }

    const user = await prisma.user.findUnique({
      where: { username: body.username },
      select: { ...userSelect, passwordHash: true },
    })
    const valid = await verifyPassword(body.password, user?.passwordHash ?? (await dummyHash))
    if (!user || !valid) {
      recordFailure(ipKey)
      recordFailure(userKey)
      return reply.code(401).send({ error: "Nom d'utilisateur ou mot de passe incorrect" })
    }

    failures.delete(userKey)
    await createSession(reply, user.id, req.headers['user-agent'])
    const { passwordHash: _, ...publicUser } = user
    return { user: publicUser }
  })

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE_NAME]
    if (token) await prisma.session.deleteMany({ where: { id: tokenId(token) } })
    reply.clearCookie(COOKIE_NAME, { path: '/' })
    return { ok: true }
  })

  // --- Own account (requires a session; /me is not under /auth/) ---

  app.patch('/me', async (req) => {
    const body = z.object({ displayName: displayName.optional(), shareActivity: z.boolean().optional() }).parse(req.body)
    const user = await prisma.user.update({ where: { id: req.user!.id }, data: body, select: userSelect })
    return { user }
  })

  app.post('/me/password', async (req, reply) => {
    const body = z.object({ currentPassword: z.string().max(256), newPassword: password }).parse(req.body)
    const { passwordHash } = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } })
    if (!(await verifyPassword(body.currentPassword, passwordHash))) {
      return reply.code(400).send({ error: 'Mot de passe actuel incorrect' })
    }
    await prisma.user.update({ where: { id: req.user!.id }, data: { passwordHash: await hashPassword(body.newPassword) } })
    // Sign out every other device.
    const current = tokenId(req.cookies[COOKIE_NAME]!)
    await prisma.session.deleteMany({ where: { userId: req.user!.id, id: { not: current } } })
    return { ok: true }
  })

  // --- Account management (admins) ---

  app.get('/users', { preHandler: requireAdmin }, async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        ...userSelect,
        createdAt: true,
        sessions: { select: { lastUsedAt: true }, orderBy: { lastUsedAt: 'desc' }, take: 1 },
      },
    })
    return users.map(({ sessions, ...u }) => ({ ...u, lastSeenAt: sessions[0]?.lastUsedAt ?? null }))
  })

  app.post('/users', { preHandler: requireAdmin }, async (req, reply) => {
    const body = z
      .object({ username, password, displayName: displayName.optional(), role: role.default('user') })
      .parse(req.body)
    if (await prisma.user.findUnique({ where: { username: body.username } })) {
      return reply.code(409).send({ error: "Ce nom d'utilisateur est déjà pris" })
    }
    const user = await prisma.user.create({
      data: {
        username: body.username,
        displayName: body.displayName ?? body.username,
        passwordHash: await hashPassword(body.password),
        role: body.role,
      },
      select: userSelect,
    })
    return reply.code(201).send({ user })
  })

  app.patch('/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const body = z.object({ role: role.optional(), password: password.optional(), displayName: displayName.optional() }).parse(req.body)
    const target = await prisma.user.findUnique({ where: { id } })
    if (!target) return reply.code(404).send({ error: 'Compte introuvable' })
    if (body.role === 'user' && target.role === 'admin' && (await adminCount()) <= 1) {
      return reply.code(400).send({ error: 'Il doit rester au moins un administrateur' })
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        role: body.role,
        displayName: body.displayName,
        passwordHash: body.password ? await hashPassword(body.password) : undefined,
      },
      select: userSelect,
    })
    // A password reset signs the user out everywhere.
    if (body.password) await prisma.session.deleteMany({ where: { userId: id } })
    return { user }
  })

  app.delete('/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    if (id === req.user!.id) return reply.code(400).send({ error: 'Vous ne pouvez pas supprimer votre propre compte' })
    const target = await prisma.user.findUnique({ where: { id } })
    if (!target) return reply.code(404).send({ error: 'Compte introuvable' })
    if (target.role === 'admin' && (await adminCount()) <= 1) {
      return reply.code(400).send({ error: 'Il doit rester au moins un administrateur' })
    }
    await prisma.user.delete({ where: { id } })
    return reply.code(204).send()
  })
}
