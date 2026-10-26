import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from '../config.js'
import { prisma } from '../db.js'
import { authorizeUrl, connect, consumeState, disconnect, get, getAll, isConfigured, SpotifyError } from './client.js'
import { startImport } from './importer.js'

const IMPORT_PAGE = '/import/spotify'
// Spotify not connected / connection expired. Not 401: the frontend treats 401 as an
// expired Spotifiak session and signs the user out.
const SPOTIFY_NOT_CONNECTED = 409

interface SpotifyPlaylist {
  id: string
  name: string
  collaborative: boolean
  owner: { id: string; display_name: string | null }
  images: { url: string; width: number | null }[] | null
  items?: { total: number }
  /** Deprecated by Spotify in favour of `items`. */
  tracks?: { total: number }
}

export async function spotifyRoutes(app: FastifyInstance) {
  app.get('/spotify/status', async (req) => {
    const account = await prisma.spotifyAccount.findUnique({
      where: { userId: req.user!.id },
      select: { displayName: true, spotifyUserId: true, connectedAt: true },
    })
    return {
      configured: isConfigured(),
      // Shown to admins so they can register it in the Spotify app settings.
      redirectUri: req.user!.role === 'admin' ? (config.SPOTIFY_REDIRECT_URI ?? null) : null,
      account,
    }
  })

  app.get('/spotify/authorize', async (req, reply) => {
    if (!isConfigured()) return reply.code(503).send({ error: "L'import Spotify n'est pas configuré" })
    // Back to the address the user is on (through nginx/Vite), with its port.
    const returnTo = `${req.protocol}://${req.headers.host}`
    return { url: authorizeUrl(req.user!.id, returnTo) }
  })

  app.get('/spotify/callback', async (req, reply) => {
    const { code, state, error } = z
      .object({ code: z.string().optional(), state: z.string(), error: z.string().optional() })
      .parse(req.query)
    const pending = consumeState(state)
    if (!pending) return reply.code(400).type('text/html').send('<p>Lien expiré, relancez la connexion à Spotify depuis Spotifiak.</p>')

    const back = (params: Record<string, string>) =>
      reply.redirect(`${pending.returnTo}${IMPORT_PAGE}?${new URLSearchParams(params)}`)

    if (error || !code) return back({ error: error === 'access_denied' ? 'Connexion refusée sur Spotify' : (error ?? 'Erreur Spotify') })
    try {
      await connect(pending.userId, code)
      return back({ connected: '1' })
    } catch (err) {
      req.log.warn({ err }, 'Spotify connection failed')
      return back({ error: (err as Error).message })
    }
  })

  app.delete('/spotify/connection', async (req, reply) => {
    await disconnect(req.user!.id)
    return reply.code(204).send()
  })

  app.get('/spotify/playlists', async (req, reply) => {
    const account = await prisma.spotifyAccount.findUnique({ where: { userId: req.user!.id } })
    if (!account) return reply.code(SPOTIFY_NOT_CONNECTED).send({ error: 'Compte Spotify non connecté' })
    try {
      const [playlists, liked, imports] = await Promise.all([
        getAll<SpotifyPlaylist>(req.user!.id, '/me/playlists?limit=50'),
        get<{ total: number }>(req.user!.id, '/me/tracks?limit=1'),
        prisma.spotifyImport.findMany({
          where: { userId: req.user!.id, spotifyPlaylistId: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: { spotifyPlaylistId: true, playlistId: true },
        }),
      ])
      const lastImport = new Map<string, string | null>()
      for (const i of imports) if (!lastImport.has(i.spotifyPlaylistId!)) lastImport.set(i.spotifyPlaylistId!, i.playlistId)

      return {
        likedTotal: liked.total,
        playlists: playlists.map((p) => ({
          id: p.id,
          name: p.name,
          owner: p.owner.display_name ?? p.owner.id,
          total: p.items?.total ?? p.tracks?.total ?? 0,
          // Smallest image that's still sharp in a 48px thumbnail.
          image: [...(p.images ?? [])].sort((a, b) => (a.width ?? 0) - (b.width ?? 0)).find((i) => (i.width ?? 300) >= 60)?.url ?? p.images?.[0]?.url ?? null,
          // Spotify only exposes the tracks of playlists you own or collaborate on.
          importable: p.owner.id === account.spotifyUserId || p.collaborative,
          importedPlaylistId: lastImport.get(p.id) ?? null,
        })),
      }
    } catch (err) {
      if (err instanceof SpotifyError) return reply.code(err.status === 401 ? SPOTIFY_NOT_CONNECTED : 502).send({ error: err.message })
      throw err
    }
  })

  app.post('/spotify/imports', async (req, reply) => {
    const body = z
      .union([z.object({ liked: z.literal(true) }), z.object({ playlistId: z.string(), name: z.string().min(1).max(100) })])
      .parse(req.body)
    if (!(await prisma.spotifyAccount.findUnique({ where: { userId: req.user!.id } }))) {
      return reply.code(SPOTIFY_NOT_CONNECTED).send({ error: 'Compte Spotify non connecté' })
    }
    const imp = await startImport(
      req.log,
      req.user!.id,
      'liked' in body ? 'liked' : { spotifyPlaylistId: body.playlistId, name: body.name },
    )
    return reply.code(202).send({ id: imp.id, playlistId: imp.playlistId })
  })

  app.get('/spotify/imports', async (req) => {
    const imports = await prisma.spotifyImport.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, name: true, status: true, error: true, playlistId: true, spotifyPlaylistId: true, createdAt: true },
    })
    const counts = await prisma.spotifyImportTrack.groupBy({
      by: ['importId', 'status'],
      where: { importId: { in: imports.map((i) => i.id) } },
      _count: true,
    })
    return imports.map((i) => {
      const c = { pending: 0, matched: 0, queued: 0, not_found: 0 }
      for (const row of counts) if (row.importId === i.id) c[row.status] = row._count
      return { ...i, liked: !i.spotifyPlaylistId, counts: c, total: c.pending + c.matched + c.queued + c.not_found }
    })
  })

  app.get('/spotify/imports/:id/missing', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const imp = await prisma.spotifyImport.findFirst({ where: { id, userId: req.user!.id }, select: { id: true } })
    if (!imp) return reply.code(404).send({ error: 'Import introuvable' })
    return prisma.spotifyImportTrack.findMany({
      where: { importId: id, status: { in: ['queued', 'not_found'] } },
      orderBy: { position: 'asc' },
      select: { id: true, title: true, artist: true, album: true, status: true },
    })
  })
}
