import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { prisma } from './db.js'
import type { DeezerTrack } from './deemix.js'
import { annotateTracks } from './downloads.js'
import { deezer, normalize } from './enrich.js'
import { albumSelect, toAlbum } from './library.js'
import { artistScores, tasteOf } from './mixes.js'
import { sharingFriends } from './taste.js'

// Music outside the library, shown on the Découvrir page:
// - for you: artists Deezer relates to the ones the user plays most in Spotifiak, none of them in the
//   library yet, with their top tracks (and Deezer's 30 s previews to listen before downloading);
// - albums to finish: albums the user plays (3+ of their tracks) that the library only has part of;
// - from friends: Deezer's top tracks of the artists the user's friends love, missing from the library.
// Suggestions only: the user picks what to download (nothing fills the disk on its own).

const FINISH_MIN_TRACKS = 3
const FINISH_CANDIDATES = 12
const FRIEND_ARTISTS = 8
const TOP_TRACKS_PER_ARTIST = 5
const FOR_YOU_SEEDS = 6
const NEW_ARTISTS_PER_SEED = 4
const NEW_ARTIST_TRACKS = 3
const DAY_MS = 24 * 3600_000

const albumSizes = new Map<number, { total: number | null; at: number }>()

/** An album's number of tracks on Deezer, remembered for a week. */
async function deezerAlbumSize(deezerId: number) {
  const cached = albumSizes.get(deezerId)
  if (cached && Date.now() - cached.at < 7 * DAY_MS) return cached.total
  const album = await deezer<{ nb_tracks: number }>(`/album/${deezerId}`)
  albumSizes.set(deezerId, { total: album?.nb_tracks ?? null, at: Date.now() })
  return album?.nb_tracks ?? null
}

/** The albums that have at least `min` of these tracks, most first. */
export function albumsWithMost(trackAlbums: (string | null)[], min = FINISH_MIN_TRACKS) {
  const counts = new Map<string, number>()
  for (const id of trackAlbums) if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  return [...counts]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id)
}

async function albumsToFinish(userId: string) {
  const { scores } = await tasteOf(userId, Date.now())
  const tracks = await prisma.track.findMany({ where: { id: { in: [...scores.keys()] } }, select: { albumId: true } })
  const ids = albumsWithMost(tracks.map((t) => t.albumId)).slice(0, FINISH_CANDIDATES)
  const albums = await prisma.album.findMany({ where: { id: { in: ids }, deezerId: { not: null } }, select: { ...albumSelect, deezerId: true } })
  const result = []
  for (const { deezerId, ...album } of albums) {
    const total = await deezerAlbumSize(deezerId!)
    const have = album._count.tracks
    if (total && have < total) {
      result.push({ album: toAlbum(album), have, total, link: `https://www.deezer.com/album/${deezerId}` })
    }
  }
  return result
}

/** Related artists that aren't in the library yet, a few per seed, each once. */
export function newArtists(
  related: { seed: string; artists: { id: number; name: string }[] }[],
  known: Set<string>,
  perSeed = NEW_ARTISTS_PER_SEED,
) {
  const seen = new Set<number>()
  return related.flatMap(({ seed, artists }) =>
    artists
      .filter((a) => !known.has(normalize(a.name)) && !seen.has(a.id))
      .slice(0, perSeed)
      .map((a) => {
        seen.add(a.id)
        return { artist: a, because: seed }
      }),
  )
}

async function forYou(userId: string) {
  const { scores, artistOf } = await tasteOf(userId, Date.now())
  const ranked = [...artistScores(scores, artistOf)].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  const [seeds, library] = await Promise.all([
    prisma.artist.findMany({ where: { id: { in: ranked.slice(0, FOR_YOU_SEEDS * 2) }, deezerId: { not: null } }, select: { id: true, name: true, deezerId: true } }),
    prisma.artist.findMany({ select: { name: true } }),
  ])
  const chosen = ranked.flatMap((id) => seeds.find((a) => a.id === id) ?? []).slice(0, FOR_YOU_SEEDS)
  const related: { seed: string; artists: { id: number; name: string }[] }[] = []
  for (const seed of chosen) {
    const list = await deezer<{ data: { id: number; name: string }[] }>(`/artist/${seed.deezerId}/related`, { limit: '10' })
    related.push({ seed: seed.name, artists: list?.data ?? [] })
  }
  const results: { track: DeezerTrack; because: string }[] = []
  for (const { artist, because } of newArtists(related, new Set(library.map((a) => normalize(a.name))))) {
    const top = await deezer<{ data: DeezerTrack[] }>(`/artist/${artist.id}/top`, { limit: String(NEW_ARTIST_TRACKS) })
    results.push(...(top?.data ?? []).map((track) => ({ track, because })))
  }
  return results
}

async function fromFriends(userId: string) {
  const friends = await sharingFriends(userId)
  if (!friends.length) return []
  const now = Date.now()
  // Each friend's artist scores, scaled so one heavy listener doesn't drown the others.
  const affinities = await Promise.all(
    friends.map(async (friend) => {
      const { scores, artistOf } = await tasteOf(friend.id, now)
      const affinity = artistScores(scores, artistOf)
      const max = Math.max(1, ...affinity.values())
      return { friend, affinity: new Map([...affinity].map(([id, v]) => [id, v / max])) }
    }),
  )
  const combined = new Map<string, number>()
  for (const { affinity } of affinities) for (const [id, v] of affinity) combined.set(id, (combined.get(id) ?? 0) + v)
  const ranked = [...combined].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  const artists = await prisma.artist.findMany({ where: { id: { in: ranked.slice(0, FRIEND_ARTISTS * 2) }, deezerId: { not: null } }, select: { id: true, deezerId: true } })
  const chosen = ranked.flatMap((id) => artists.find((a) => a.id === id) ?? []).slice(0, FRIEND_ARTISTS)

  const results: { track: DeezerTrack; fans: string[] }[] = []
  for (const artist of chosen) {
    const top = await deezer<{ data: DeezerTrack[] }>(`/artist/${artist.deezerId}/top`, { limit: String(TOP_TRACKS_PER_ARTIST) })
    // Who loves this artist: the friends it ranks highest for, up to two.
    const fans = affinities
      .filter((a) => (a.affinity.get(artist.id) ?? 0) > 0)
      .sort((x, y) => y.affinity.get(artist.id)! - x.affinity.get(artist.id)!)
      .slice(0, 2)
      .map((a) => a.friend.displayName)
    results.push(...(top?.data ?? []).map((track) => ({ track, fans })))
  }
  const annotated = await annotateTracks(
    userId,
    results.map((r) => r.track),
  )
  return annotated.flatMap((track, i) => (track.libraryTrack ? [] : [{ ...track, fans: results[i].fans }]))
}

// Deezer is slow and rate limited: each user's suggestions are made once a day.
interface Made {
  albums: Awaited<ReturnType<typeof albumsToFinish>>
  tracks: Awaited<ReturnType<typeof fromFriends>>
  forYou: Awaited<ReturnType<typeof forYou>>
}
const cache = new Map<string, { day: string; value: Promise<Made> }>()

function suggestionsOf(userId: string, log: FastifyBaseLogger) {
  const day = new Date().toLocaleDateString('sv-SE')
  const cached = cache.get(userId)
  if (cached?.day === day) return cached.value
  const value = Promise.all([albumsToFinish(userId), fromFriends(userId), forYou(userId)]).then(([albums, tracks, forYou]) => ({
    albums,
    tracks,
    forYou,
  }))
  cache.set(userId, { day, value })
  value.catch((err) => {
    log.warn({ err }, 'download suggestions failed')
    cache.delete(userId)
  })
  return value
}

export async function suggestionRoutes(app: FastifyInstance) {
  app.get('/me/suggestions', async (req) => {
    const made = await suggestionsOf(req.user!.id, req.log)
    // The library and download states change during the day: the tracks are checked again each time.
    const [friends, mine] = await Promise.all([
      annotateTracks(req.user!.id, made.tracks),
      annotateTracks(
        req.user!.id,
        made.forYou.map((s) => s.track),
      ),
    ])
    return {
      albums: made.albums,
      tracks: friends.flatMap((t, i) => (t.libraryTrack ? [] : [{ ...t, fans: made.tracks[i].fans }])),
      forYou: mine.flatMap((t, i) => (t.libraryTrack ? [] : [{ ...t, because: made.forYou[i].because }])),
    }
  })
}
