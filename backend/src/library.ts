import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from './db.js'
import type { Prisma } from './generated/prisma/client.js'

export const trackSelect = {
  id: true,
  title: true,
  artistName: true,
  artistId: true,
  album: { select: { id: true, title: true, coverUrl: true } },
  durationSec: true,
  trackNumber: true,
  discNumber: true,
  createdAt: true,
  // Only its extension is sent (format): clients pick a playable stream from it.
  path: true,
} satisfies Prisma.TrackSelect

const trackOrder: Prisma.TrackOrderByWithRelationInput[] = [
  { discNumber: 'asc' },
  { trackNumber: 'asc' },
  { title: 'asc' },
]

// One track per album/artist whose file art is the fallback when Deezer has no image.
const coverTrack = { select: { id: true }, orderBy: trackOrder, take: 1 }

export const albumSelect = {
  id: true,
  title: true,
  year: true,
  createdAt: true,
  coverUrl: true,
  artist: { select: { id: true, name: true, pictureUrl: true } },
  tracks: coverTrack,
  _count: { select: { tracks: true } },
} satisfies Prisma.AlbumSelect

export const artistSelect = {
  id: true,
  name: true,
  pictureUrl: true,
  tracks: coverTrack,
  // Without a Deezer picture, show one of the artist's album covers instead.
  albums: { select: { coverUrl: true }, where: { coverUrl: { not: null } }, take: 1 },
} satisfies Prisma.ArtistSelect

export function toTrack<T extends { createdAt: Date; path: string }>({ createdAt, path: file, ...t }: T) {
  return { ...t, format: path.extname(file).slice(1).toLowerCase(), addedAt: createdAt }
}

export function toAlbum<T extends { tracks: { id: string }[]; _count: { tracks: number } }>({ tracks, _count, ...a }: T) {
  return { ...a, coverTrackId: tracks[0]?.id ?? null, trackCount: _count.tracks }
}

export function toArtist<T extends { pictureUrl: string | null; tracks: { id: string }[]; albums: { coverUrl: string | null }[] }>({
  tracks,
  albums,
  pictureUrl,
  ...a
}: T) {
  return { ...a, pictureUrl: pictureUrl ?? albums[0]?.coverUrl ?? null, coverTrackId: tracks[0]?.id ?? null }
}

const idParams = z.object({ id: z.string() })
const paging = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const })

const MOSAIC_SIZE = 4

/** Up to 4 covers from distinct albums for the playlist mosaic, like Spotify. */
export function mosaic(entries: { track: { id: string; albumId: string | null; album: { coverUrl: string | null } | null } }[]) {
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

export const mosaicEntries = {
  orderBy: { position: 'asc' as const },
  take: 30,
  select: { track: { select: { id: true, albumId: true, album: { select: { coverUrl: true } } } } },
}

export async function libraryRoutes(app: FastifyInstance) {
  app.get('/tracks', async (req) => {
    const { limit, offset } = paging.parse(req.query)
    const [items, total] = await Promise.all([
      prisma.track.findMany({ select: trackSelect, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      prisma.track.count(),
    ])
    return { items: items.map(toTrack), total }
  })

  app.get('/tracks/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params)
    const track = await prisma.track.findUnique({ where: { id }, select: trackSelect })
    return track ? toTrack(track) : reply.code(404).send({ error: 'Track not found' })
  })

  app.get('/albums', async (req) => {
    const { limit, offset } = paging.parse(req.query)
    const items = await prisma.album.findMany({
      select: albumSelect,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    })
    return { items: items.map(toAlbum) }
  })

  app.get('/albums/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params)
    const album = await prisma.album.findUnique({ where: { id }, select: albumSelect })
    if (!album) return reply.code(404).send({ error: 'Album not found' })
    const tracks = await prisma.track.findMany({
      where: { albumId: id },
      select: trackSelect,
      orderBy: trackOrder,
    })
    return { ...toAlbum(album), tracks: tracks.map(toTrack) }
  })

  app.get('/artists', async (req) => {
    const { limit, offset } = paging.parse(req.query)
    const items = await prisma.artist.findMany({
      select: artistSelect,
      orderBy: { name: 'asc' },
      take: limit,
      skip: offset,
    })
    return { items: items.map(toArtist) }
  })

  app.get('/artists/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params)
    const artist = await prisma.artist.findUnique({ where: { id }, select: artistSelect })
    if (!artist) return reply.code(404).send({ error: 'Artist not found' })
    const [albums, tracks] = await Promise.all([
      prisma.album.findMany({
        where: { artistId: id },
        select: albumSelect,
        orderBy: [{ year: 'desc' }, { title: 'asc' }],
      }),
      prisma.track.findMany({
        where: { artistId: id },
        select: trackSelect,
        // Until play counts exist, "popular" means most recently added.
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ])
    return { ...toArtist(artist), albums: albums.map(toAlbum), tracks: tracks.map(toTrack) }
  })

  app.get('/search', async (req) => {
    const { q } = z.object({ q: z.string().min(1) }).parse(req.query)
    const [tracks, albums, artists, playlists] = await Promise.all([
      prisma.track.findMany({
        where: { OR: [{ title: contains(q) }, { artistName: contains(q) }, { album: { title: contains(q) } }] },
        select: trackSelect,
        orderBy: { title: 'asc' },
        take: 20,
      }),
      prisma.album.findMany({
        where: { OR: [{ title: contains(q) }, { artist: { name: contains(q) } }] },
        select: albumSelect,
        orderBy: { title: 'asc' },
        take: 12,
      }),
      prisma.artist.findMany({
        where: { name: contains(q) },
        select: artistSelect,
        orderBy: { name: 'asc' },
        take: 12,
      }),
      // The user's own playlists, and everyone's public ones that have tracks.
      prisma.playlist.findMany({
        where: {
          AND: [
            { OR: [{ name: contains(q) }, { description: contains(q) }] },
            { OR: [{ ownerId: req.user!.id }, { public: true, tracks: { some: {} } }] },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 12,
        select: {
          id: true,
          name: true,
          description: true,
          updatedAt: true,
          owner: { select: { displayName: true } },
          _count: { select: { tracks: true } },
          tracks: mosaicEntries,
        },
      }),
    ])
    return {
      tracks: tracks.map(toTrack),
      albums: albums.map(toAlbum),
      artists: artists.map(toArtist),
      playlists: playlists.map(({ _count, tracks, ...p }) => ({ ...p, trackCount: _count.tracks, covers: mosaic(tracks) })),
    }
  })
}
