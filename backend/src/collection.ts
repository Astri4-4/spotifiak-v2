import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from './db.js'
import { toTrack, trackSelect } from './library.js'

const MOSAIC_SIZE = 4
// Positions are floats; when neighbours get this close, renumber the playlist.
const MIN_POSITION_GAP = 1e-6

const trackIdParams = z.object({ trackId: z.string() })
const playlistParams = z.object({ id: z.string() })
const entryParams = z.object({ id: z.string(), entryId: z.string() })
const playlistBody = z.object({
  name: z.string().trim().min(1, 'Le nom ne peut pas être vide').max(100).optional(),
  description: z.string().trim().max(300).optional(),
})

/** Up to 4 covers from distinct albums for the playlist mosaic, like Spotify. */
function mosaic(entries: { track: { id: string; albumId: string | null; album: { coverUrl: string | null } | null } }[]) {
  const seen = new Set<string>()
  const covers: { trackId: string; coverUrl: string | null }[] = []
  for (const { track } of entries) {
    const key = track.albumId ?? track.id
    if (seen.has(key)) continue
    seen.add(key)
    covers.push({ trackId: track.id, coverUrl: track.album?.coverUrl ?? null })
    if (covers.length === MOSAIC_SIZE) break
  }
  return covers
}

const mosaicEntries = {
  orderBy: { position: 'asc' as const },
  take: 30,
  select: { track: { select: { id: true, albumId: true, album: { select: { coverUrl: true } } } } },
}

export async function collectionRoutes(app: FastifyInstance) {
  // Playlists are private: someone else's playlist is reported as missing, not forbidden.
  async function ownedPlaylist(id: string, userId: string, reply: FastifyReply) {
    const playlist = await prisma.playlist.findFirst({ where: { id, ownerId: userId } })
    if (!playlist) reply.code(404).send({ error: 'Playlist introuvable' })
    return playlist
  }

  // Bumps updatedAt so the library sorts recently edited playlists first.
  const touch = (id: string) => prisma.playlist.update({ where: { id }, data: { updatedAt: new Date() } })

  // --- Liked tracks ---

  app.get('/me/likes/ids', async (req) => {
    const likes = await prisma.like.findMany({ where: { userId: req.user!.id }, select: { trackId: true } })
    return likes.map((l) => l.trackId)
  })

  app.get('/me/likes', async (req) => {
    const likes = await prisma.like.findMany({
      where: { userId: req.user!.id },
      orderBy: { likedAt: 'desc' },
      select: { likedAt: true, track: { select: trackSelect } },
    })
    // addedAt is when it was liked: that's the "Date d'ajout" column of this list.
    return likes.map(({ likedAt, track }) => ({ ...toTrack(track), addedAt: likedAt }))
  })

  app.put('/me/likes/:trackId', async (req, reply) => {
    const { trackId } = trackIdParams.parse(req.params)
    if (!(await prisma.track.findUnique({ where: { id: trackId }, select: { id: true } }))) {
      return reply.code(404).send({ error: 'Titre introuvable' })
    }
    await prisma.like.upsert({
      where: { userId_trackId: { userId: req.user!.id, trackId } },
      create: { userId: req.user!.id, trackId },
      update: {},
    })
    return reply.code(204).send()
  })

  app.delete('/me/likes/:trackId', async (req, reply) => {
    const { trackId } = trackIdParams.parse(req.params)
    await prisma.like.deleteMany({ where: { userId: req.user!.id, trackId } })
    return reply.code(204).send()
  })

  // --- Playlists ---

  app.get('/playlists', async (req) => {
    const playlists = await prisma.playlist.findMany({
      where: { ownerId: req.user!.id },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        updatedAt: true,
        _count: { select: { tracks: true } },
        tracks: mosaicEntries,
      },
    })
    return playlists.map(({ _count, tracks, ...p }) => ({ ...p, trackCount: _count.tracks, covers: mosaic(tracks) }))
  })

  app.post('/playlists', async (req, reply) => {
    const body = playlistBody.parse(req.body ?? {})
    const count = await prisma.playlist.count({ where: { ownerId: req.user!.id } })
    const playlist = await prisma.playlist.create({
      data: {
        name: body.name ?? `Ma playlist n° ${count + 1}`,
        description: body.description || null,
        ownerId: req.user!.id,
      },
      select: { id: true, name: true },
    })
    return reply.code(201).send(playlist)
  })

  app.get('/playlists/:id', async (req, reply) => {
    const { id } = playlistParams.parse(req.params)
    const playlist = await prisma.playlist.findFirst({
      where: { id, ownerId: req.user!.id },
      select: {
        id: true,
        name: true,
        description: true,
        updatedAt: true,
        owner: { select: { displayName: true } },
        tracks: {
          orderBy: { position: 'asc' },
          select: { id: true, addedAt: true, track: { select: { ...trackSelect, albumId: true } } },
        },
      },
    })
    if (!playlist) return reply.code(404).send({ error: 'Playlist introuvable' })
    const { tracks, ...rest } = playlist
    return {
      ...rest,
      covers: mosaic(tracks),
      entries: tracks.map((e) => {
        const { albumId: _, ...track } = e.track
        return { id: e.id, track: { ...toTrack(track), addedAt: e.addedAt } }
      }),
    }
  })

  app.patch('/playlists/:id', async (req, reply) => {
    const { id } = playlistParams.parse(req.params)
    const body = playlistBody.parse(req.body)
    if (!(await ownedPlaylist(id, req.user!.id, reply))) return
    const playlist = await prisma.playlist.update({
      where: { id },
      data: {
        name: body.name,
        description: body.description === undefined ? undefined : body.description || null,
      },
      select: { id: true, name: true, description: true },
    })
    return playlist
  })

  app.delete('/playlists/:id', async (req, reply) => {
    const { id } = playlistParams.parse(req.params)
    if (!(await ownedPlaylist(id, req.user!.id, reply))) return
    await prisma.playlist.delete({ where: { id } })
    return reply.code(204).send()
  })

  app.post('/playlists/:id/tracks', async (req, reply) => {
    const { id } = playlistParams.parse(req.params)
    const { trackIds } = z.object({ trackIds: z.array(z.string()).min(1).max(1000) }).parse(req.body)
    if (!(await ownedPlaylist(id, req.user!.id, reply))) return

    const existing = new Set(
      (await prisma.track.findMany({ where: { id: { in: trackIds } }, select: { id: true } })).map((t) => t.id),
    )
    const valid = trackIds.filter((t) => existing.has(t))
    if (!valid.length) return reply.code(404).send({ error: 'Titre introuvable' })

    const last = await prisma.playlistTrack.findFirst({
      where: { playlistId: id },
      orderBy: { position: 'desc' },
      select: { position: true },
    })
    const start = (last?.position ?? 0) + 1
    await prisma.$transaction([
      prisma.playlistTrack.createMany({
        data: valid.map((trackId, i) => ({ playlistId: id, trackId, position: start + i })),
      }),
      touch(id),
    ])
    return reply.code(201).send({ added: valid.length })
  })

  app.delete('/playlists/:id/tracks/:entryId', async (req, reply) => {
    const { id, entryId } = entryParams.parse(req.params)
    if (!(await ownedPlaylist(id, req.user!.id, reply))) return
    await prisma.$transaction([prisma.playlistTrack.deleteMany({ where: { id: entryId, playlistId: id } }), touch(id)])
    return reply.code(204).send()
  })

  /** Moves an entry before another one (`beforeEntryId`), or to the end when it's null. */
  app.patch('/playlists/:id/tracks/:entryId', async (req, reply) => {
    const { id, entryId } = entryParams.parse(req.params)
    const { beforeEntryId } = z.object({ beforeEntryId: z.string().nullable() }).parse(req.body)
    if (!(await ownedPlaylist(id, req.user!.id, reply))) return

    const entries = await prisma.playlistTrack.findMany({
      where: { playlistId: id },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    })
    if (!entries.some((e) => e.id === entryId)) return reply.code(404).send({ error: 'Titre introuvable' })

    const others = entries.filter((e) => e.id !== entryId)
    const index = beforeEntryId === null ? others.length : others.findIndex((e) => e.id === beforeEntryId)
    if (index < 0) return reply.code(400).send({ error: 'Position invalide' })

    const prev = others[index - 1]?.position
    const next = others[index]?.position
    const position =
      prev === undefined ? (next ?? 1) - 1 : next === undefined ? prev + 1 : (prev + next) / 2

    if (prev !== undefined && next !== undefined && next - prev < MIN_POSITION_GAP) {
      // Too many moves between the same neighbours: renumber everything in the new order.
      const ordered = [...others.slice(0, index).map((e) => e.id), entryId, ...others.slice(index).map((e) => e.id)]
      await prisma.$transaction([
        ...ordered.map((eid, i) => prisma.playlistTrack.update({ where: { id: eid }, data: { position: i + 1 } })),
        touch(id),
      ])
    } else {
      await prisma.$transaction([prisma.playlistTrack.update({ where: { id: entryId }, data: { position } }), touch(id)])
    }
    return reply.code(204).send()
  })
}
