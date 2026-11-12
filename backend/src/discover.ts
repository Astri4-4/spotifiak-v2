import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from './db.js'
import { albumSelect, artistSelect, toAlbum, toArtist, toTrack, trackSelect } from './library.js'
import { listGenres } from './mixes.js'

const RECENT_ALBUMS = 12
const RECENT_PLAYS = 300
const WRAPPED_TRACKS = 10
const WRAPPED_ARTISTS = 5
const WRAPPED_GENRES = 3

export interface WrappedPlay {
  trackId: string
  artistId: string
  genre: string | null
  durationSec: number | null
}

/** The ids counted most often, most first. */
function top(ids: Iterable<string>, n: number) {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id, plays]) => ({ id, plays }))
}

/** A year of plays in numbers: minutes, top tracks, artists and genres. */
export function summarizePlays(plays: WrappedPlay[]) {
  return {
    plays: plays.length,
    // shortcut: counts each play as the whole track, since clients don't report how long they played.
    minutes: Math.round(plays.reduce((sum, p) => sum + (p.durationSec ?? 0), 0) / 60),
    tracks: top(
      plays.map((p) => p.trackId),
      WRAPPED_TRACKS,
    ),
    artists: top(
      plays.map((p) => p.artistId),
      WRAPPED_ARTISTS,
    ),
    genres: top(
      plays.flatMap((p) => p.genre ?? []),
      WRAPPED_GENRES,
    ),
  }
}

export async function discoverRoutes(app: FastifyInstance) {
  // The albums the user played last ("Écoutés récemment" on the home page).
  app.get('/me/recent', async (req) => {
    const plays = await prisma.play.findMany({
      where: { userId: req.user!.id },
      orderBy: { playedAt: 'desc' },
      take: RECENT_PLAYS,
      select: { track: { select: { albumId: true } } },
    })
    const ids = [...new Set(plays.flatMap((p) => p.track.albumId ?? []))].slice(0, RECENT_ALBUMS)
    const albums = await prisma.album.findMany({ where: { id: { in: ids } }, select: albumSelect })
    const byId = new Map(albums.map((a) => [a.id, toAlbum(a)]))
    return ids.flatMap((id) => byId.get(id) ?? [])
  })

  app.get('/genres', () => listGenres())

  // The user's year in Spotifiak, like Spotify Wrapped.
  app.get('/me/wrapped', async (req) => {
    const current = new Date().getFullYear()
    const { year } = z.object({ year: z.coerce.number().int().min(2000).max(current).default(current) }).parse(req.query)
    const userId = req.user!.id
    const [first, rows] = await Promise.all([
      prisma.play.findFirst({ where: { userId }, orderBy: { playedAt: 'asc' }, select: { playedAt: true } }),
      prisma.play.findMany({
        where: { userId, playedAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
        select: { trackId: true, track: { select: { artistId: true, genre: true, durationSec: true } } },
      }),
    ])
    const summary = summarizePlays(rows.map((r) => ({ trackId: r.trackId, ...r.track })))
    const [tracks, artists] = await Promise.all([
      prisma.track.findMany({ where: { id: { in: summary.tracks.map((t) => t.id) } }, select: trackSelect }),
      prisma.artist.findMany({ where: { id: { in: summary.artists.map((a) => a.id) } }, select: artistSelect }),
    ])
    const trackById = new Map(tracks.map((t) => [t.id, t]))
    const artistById = new Map(artists.map((a) => [a.id, a]))
    const firstYear = first?.playedAt.getFullYear() ?? current
    return {
      year,
      // Years with plays, newest first, to switch between.
      years: Array.from({ length: current - firstYear + 1 }, (_, i) => current - i),
      plays: summary.plays,
      minutes: summary.minutes,
      topTracks: summary.tracks.flatMap(({ id, plays }) => {
        const track = trackById.get(id)
        return track ? [{ ...toTrack(track), plays }] : []
      }),
      topArtists: summary.artists.flatMap(({ id, plays }) => {
        const artist = artistById.get(id)
        return artist ? [{ ...toArtist(artist), plays }] : []
      }),
      topGenres: summary.genres.map(({ id, plays }) => ({ name: id, plays })),
    }
  })
}
