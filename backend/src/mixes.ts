import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from './db.js'
import { mosaic, toTrack, trackSelect } from './library.js'

// Mixes made from what people listen to in Spotifiak (plays and likes), nothing else:
// - Daily Mix 1–6: groups of artists the user plays in the same listening sessions, each mix
//   mixing their favourite tracks of those artists with ones they play less.
// - "Entre amis": one per friend sharing their activity, both people's tastes together.
// - Discover Weekly: tracks the user never played, by artists people play alongside theirs.
// - Release Radar: tracks added lately by artists the user listens to or follows.
// - Radios (artist or track), genres and the listening history, opened on demand.
// Daily ones change once a day (seeded by the date), weekly ones on Mondays.

const HISTORY_DAYS = 180
// A play counts half as much after this many days.
const HALF_LIFE_DAYS = 30
const LIKE_SCORE = 2
// A new session starts after this long without playing.
const SESSION_GAP_MS = 30 * 60_000
const MAX_DAILY_MIXES = 6
const MAX_CLUSTER_ARTISTS = 8
// Artists considered for the Daily Mixes, by affinity.
const CANDIDATE_ARTISTS = 40
// How much shared listening joins an artist to a group (one session with just the two = 1).
const MIN_LINK = 1
const MIX_SIZE = 50
const MIN_MIX_TRACKS = 15
// Share of a Daily Mix taken from the user's favourites; the rest are tracks they play less.
const FAVOURITES_SHARE = 0.6
// Without any mix yet, try again this soon rather than tomorrow (a new account starts listening).
const EMPTY_RETRY_MS = 3600_000

const DAY_MS = 24 * 3600_000

const RADIO_SIZE = 50
const RADIO_ARTISTS = 12
// Share of a radio from artists related to the seed; the rest is the seed artist.
const RELATED_SHARE = 2 / 3
// Below this many related artists, a radio adds artists of the same genre.
const MIN_RELATED = 5
const DISCOVER_SIZE = 30
const DISCOVER_SEEDS = 15
// Unplayed tracks of an artist the user already likes count this much against related ones.
const KNOWN_ARTIST_SHARE = 0.3
const DISCOVER_PER_ARTIST = 3
const RADAR_DAYS = 14
const RADAR_SIZE = 50
const MIN_RADAR_TRACKS = 3
const HISTORY_SIZE = 100
const GENRE_SIZE = 50

export interface PlayEvent {
  trackId: string
  artistId: string
  playedAt: Date
}

export interface LibraryTrack {
  id: string
  artistId: string
  albumId: string | null
}

// --- Scoring ---------------------------------------------------------------------

/** How much the user likes each track: plays fading with age, plus likes. */
export function trackScores(plays: PlayEvent[], likedIds: Iterable<string>, now = Date.now()) {
  const scores = new Map<string, number>()
  for (const p of plays) {
    const ageDays = Math.max(0, now - p.playedAt.getTime()) / DAY_MS
    scores.set(p.trackId, (scores.get(p.trackId) ?? 0) + 0.5 ** (ageDays / HALF_LIFE_DAYS))
  }
  for (const id of likedIds) scores.set(id, (scores.get(id) ?? 0) + LIKE_SCORE)
  return scores
}

export function artistScores(scores: Map<string, number>, artistOf: Map<string, string>) {
  const affinity = new Map<string, number>()
  for (const [trackId, score] of scores) {
    const artist = artistOf.get(trackId)
    if (artist) affinity.set(artist, (affinity.get(artist) ?? 0) + score)
  }
  return affinity
}

// --- Artists played together --------------------------------------------------

/** Plays split into listening sessions (sorted by time). */
export function sessions(plays: PlayEvent[]) {
  const sorted = [...plays].sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime())
  const result: PlayEvent[][] = []
  for (const play of sorted) {
    const last = result.at(-1)
    if (last && play.playedAt.getTime() - last.at(-1)!.playedAt.getTime() <= SESSION_GAP_MS) last.push(play)
    else result.push([play])
  }
  return result
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** How often each pair of artists shares a session; a session with many artists links each pair less. */
export function coListening(allSessions: PlayEvent[][]) {
  const links = new Map<string, number>()
  for (const session of allSessions) {
    const artists = [...new Set(session.map((p) => p.artistId))]
    if (artists.length < 2) continue
    const weight = 1 / (artists.length - 1)
    for (let i = 0; i < artists.length; i++) {
      for (let j = i + 1; j < artists.length; j++) {
        const key = pairKey(artists[i], artists[j])
        links.set(key, (links.get(key) ?? 0) + weight)
      }
    }
  }
  return links
}

/**
 * Groups of artists for the Daily Mixes: each starts from the most liked artist left and takes
 * in the artists most played with the group, while they are linked enough.
 */
export function clusterArtists(affinity: Map<string, number>, links: Map<string, number>) {
  const left = [...affinity]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, CANDIDATE_ARTISTS)
    .map(([id]) => id)
  const clusters: string[][] = []
  while (left.length && clusters.length < MAX_DAILY_MIXES) {
    const cluster = [left.shift()!]
    while (cluster.length < MAX_CLUSTER_ARTISTS) {
      let best = -1
      let bestLink = 0
      left.forEach((artist, i) => {
        const link = cluster.reduce((sum, member) => sum + (links.get(pairKey(artist, member)) ?? 0), 0)
        if (link > bestLink) {
          best = i
          bestLink = link
        }
      })
      if (best < 0 || bestLink < MIN_LINK) break
      cluster.push(left.splice(best, 1)[0])
    }
    clusters.push(cluster)
  }
  return clusters
}

// --- Building mixes ---------------------------------------------------------------

/** A random generator seeded by a string: the same mix all day, a new one tomorrow. */
export function seededRandom(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: T[], random: () => number) {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** Reorders tracks so the same artist doesn't play twice in a row, when possible. */
export function spreadArtists<T extends { artistId: string }>(tracks: T[]) {
  const left = [...tracks]
  const result: T[] = []
  while (left.length) {
    const previous = result.at(-1)?.artistId
    const i = Math.max(0, left.findIndex((t) => t.artistId !== previous))
    result.push(left.splice(i, 1)[0])
  }
  return result
}

/** A Daily Mix: favourites of the group's artists (a different selection each day), then tracks played less. */
export function buildDailyMix(cluster: string[], scores: Map<string, number>, library: LibraryTrack[], random: () => number) {
  const artists = new Set(cluster)
  const pool = library.filter((t) => artists.has(t.artistId))
  const byScore = pool.filter((t) => (scores.get(t.id) ?? 0) > 0).sort((a, b) => scores.get(b.id)! - scores.get(a.id)!)
  const favouriteCount = Math.round(MIX_SIZE * FAVOURITES_SHARE)
  const favourites = shuffle(byScore.slice(0, favouriteCount * 2), random).slice(0, favouriteCount)
  const chosen = new Set(favourites.map((t) => t.id))
  const others = shuffle(
    pool.filter((t) => !chosen.has(t.id)),
    random,
  ).slice(0, MIX_SIZE - favourites.length)
  return spreadArtists(shuffle([...favourites, ...others], random))
}

export type BlendSource = 'both' | 'me' | 'friend'

/** "Entre amis": tracks both people like first, then one of each person's favourites in turn. */
export function buildBlend(mine: Map<string, number>, theirs: Map<string, number>, random: () => number) {
  const shared = [...mine.keys()]
    .filter((id) => theirs.has(id))
    .sort((a, b) => Math.min(theirs.get(b)!, mine.get(b)!) - Math.min(theirs.get(a)!, mine.get(a)!))
    .slice(0, Math.round(MIX_SIZE / 3))
  const used = new Set(shared)
  const favourites = (scores: Map<string, number>) =>
    shuffle(
      [...scores]
        .filter(([id]) => !used.has(id))
        .sort((a, b) => b[1] - a[1])
        .slice(0, MIX_SIZE)
        .map(([id]) => id),
      random,
    )
  const mineLeft = favourites(mine)
  const theirsLeft = favourites(theirs)
  const result: { trackId: string; from: BlendSource }[] = shuffle(shared, random).map((trackId) => ({ trackId, from: 'both' }))
  // The next track of a list the other person's turns haven't taken yet.
  const take = (list: string[]) => {
    while (list.length) {
      const id = list.shift()!
      if (!used.has(id)) return id
    }
    return undefined
  }
  while (result.length < MIX_SIZE) {
    const fromMe = take(mineLeft)
    if (fromMe) {
      used.add(fromMe)
      result.push({ trackId: fromMe, from: 'me' })
    }
    if (result.length >= MIX_SIZE) break
    const fromFriend = take(theirsLeft)
    if (fromFriend) {
      used.add(fromFriend)
      result.push({ trackId: fromFriend, from: 'friend' })
    }
    if (!fromMe && !fromFriend) break
  }
  return result
}

/** The artists most played alongside `seed` (by everyone), strongest link first. */
export function relatedArtists(seed: string, links: Map<string, number>, limit = RADIO_ARTISTS) {
  const related: [string, number][] = []
  for (const [key, weight] of links) {
    const [a, b] = key.split('|')
    if (a === seed) related.push([b, weight])
    else if (b === seed) related.push([a, weight])
  }
  return related.sort((x, y) => y[1] - x[1]).slice(0, limit)
}

function byArtist(tracks: LibraryTrack[]) {
  const groups = new Map<string, LibraryTrack[]>()
  for (const t of tracks) groups.set(t.artistId, [...(groups.get(t.artistId) ?? []), t])
  return groups
}

/** A radio: the seed artist and related ones, each related artist in proportion to its link; a track radio starts with its track. */
export function buildRadio(seed: string, related: [string, number][], library: LibraryTrack[], random: () => number, firstTrackId?: string) {
  const first = library.find((t) => t.id === firstTrackId)
  const groups = byArtist(shuffle(library.filter((t) => t !== first), random))
  const total = related.reduce((sum, [, w]) => sum + w, 0)
  const relatedCap = Math.round(RADIO_SIZE * RELATED_SHARE)
  const fromRelated = related
    .flatMap(([artist, w]) => (groups.get(artist) ?? []).slice(0, Math.ceil((relatedCap * w) / total)))
    .slice(0, relatedCap)
  const fromSeed = (groups.get(seed) ?? []).slice(0, RADIO_SIZE - fromRelated.length)
  const rest = spreadArtists(shuffle([...fromSeed, ...fromRelated], random)).slice(0, RADIO_SIZE - (first ? 1 : 0))
  return first ? [first, ...rest] : rest
}

/**
 * Discover Weekly: tracks the user never played, from the artists people play alongside the user's
 * favourites (and, less, from the favourites themselves), a few per artist.
 */
export function buildDiscovery(
  affinity: Map<string, number>,
  links: Map<string, number>,
  library: LibraryTrack[],
  heard: Set<string>,
  random: () => number,
) {
  const weights = new Map<string, number>()
  const add = (artist: string, w: number) => weights.set(artist, (weights.get(artist) ?? 0) + w)
  const seeds = [...affinity].sort((a, b) => b[1] - a[1]).slice(0, DISCOVER_SEEDS)
  for (const [artist, score] of seeds) {
    add(artist, score * KNOWN_ARTIST_SHARE)
    for (const [other, link] of relatedArtists(artist, links)) add(other, score * link)
  }
  const groups = byArtist(shuffle(library.filter((t) => !heard.has(t.id)), random))
  const candidates = [...weights]
    .sort((a, b) => b[1] - a[1])
    .flatMap(([artist]) => (groups.get(artist) ?? []).slice(0, DISCOVER_PER_ARTIST))
    .slice(0, DISCOVER_SIZE * 2)
  return spreadArtists(shuffle(candidates, random).slice(0, DISCOVER_SIZE))
}

/** A genre's id in URLs: "Hip-Hop/Rap" → "hip-hop-rap". */
export function genreSlug(name: string) {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** "A, B et C" */
export function listNames(names: string[]) {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} et ${names.at(-1)}`
}

// --- Data -------------------------------------------------------------------------

const personSelect = { id: true, username: true, displayName: true, avatarUpdatedAt: true } as const

async function tasteOf(userId: string, now: number) {
  const [plays, likes] = await Promise.all([
    prisma.play.findMany({
      where: { userId, playedAt: { gte: new Date(now - HISTORY_DAYS * DAY_MS) } },
      select: { trackId: true, playedAt: true, track: { select: { artistId: true } } },
    }),
    prisma.like.findMany({ where: { userId }, select: { trackId: true, track: { select: { artistId: true } } } }),
  ])
  const events = plays.map((p) => ({ trackId: p.trackId, playedAt: p.playedAt, artistId: p.track.artistId }))
  const artistOf = new Map([...events, ...likes.map((l) => ({ trackId: l.trackId, artistId: l.track.artistId }))].map((t) => [t.trackId, t.artistId]))
  return { events, scores: trackScores(events, likes.map((l) => l.trackId), now), artistOf }
}

const mixTrackSelect = { ...trackSelect, albumId: true } as const

async function loadTracks(ids: string[]) {
  const rows = await prisma.track.findMany({ where: { id: { in: ids } }, select: mixTrackSelect })
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.flatMap((id) => byId.get(id) ?? [])
}

type MixTrackRow = Awaited<ReturnType<typeof loadTracks>>[number]

interface Mix {
  id: string
  kind: 'daily' | 'blend' | 'weekly' | 'radar' | 'radio' | 'genre' | 'history'
  title: string
  description: string
  friend: { id: string; username: string; displayName: string; avatarUpdatedAt: Date | null } | null
  rows: MixTrackRow[]
  from?: Map<string, BlendSource>
}

async function dailyMixes(userId: string, day: string, now: number): Promise<Mix[]> {
  const { events, scores, artistOf } = await tasteOf(userId, now)
  const affinity = artistScores(scores, artistOf)
  const clusters = clusterArtists(affinity, coListening(sessions(events)))
  if (!clusters.length) return []
  const artistIds = clusters.flat()
  const [library, artists] = await Promise.all([
    prisma.track.findMany({ where: { artistId: { in: artistIds } }, select: { id: true, artistId: true, albumId: true } }),
    prisma.artist.findMany({ where: { id: { in: artistIds } }, select: { id: true, name: true } }),
  ])
  const names = new Map(artists.map((a) => [a.id, a.name]))
  const mixes: Mix[] = []
  for (const cluster of clusters) {
    const random = seededRandom(`${userId}:${day}:daily:${cluster[0]}`)
    const ids = buildDailyMix(cluster, scores, library, random).map((t) => t.id)
    if (ids.length < MIN_MIX_TRACKS) continue
    const n = mixes.length + 1
    mixes.push({
      id: `daily-${n}`,
      kind: 'daily',
      title: `Daily Mix ${n}`,
      description: `Avec ${listNames(cluster.slice(0, 3).flatMap((id) => names.get(id) ?? []))}`,
      friend: null,
      rows: await loadTracks(ids),
    })
  }
  return mixes
}

async function blends(userId: string, day: string, now: number): Promise<Mix[]> {
  const friendships = await prisma.friendship.findMany({
    where: { status: 'accepted', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requester: { select: { ...personSelect, shareActivity: true } }, addressee: { select: { ...personSelect, shareActivity: true } } },
  })
  // Only friends who share what they listen to.
  const friends = friendships
    .map((f) => (f.requester.id === userId ? f.addressee : f.requester))
    .filter((f) => f.shareActivity)
    .map(({ shareActivity: _, ...person }) => person)
  if (!friends.length) return []
  const mine = (await tasteOf(userId, now)).scores
  if (!mine.size) return []
  const mixes: Mix[] = []
  for (const friend of friends.sort((a, b) => a.displayName.localeCompare(b.displayName))) {
    const theirs = (await tasteOf(friend.id, now)).scores
    if (!theirs.size) continue
    const picks = buildBlend(mine, theirs, seededRandom(`${userId}:${day}:blend:${friend.id}`))
    if (picks.length < MIN_MIX_TRACKS) continue
    mixes.push({
      id: `blend-${friend.id}`,
      kind: 'blend',
      title: `Toi et ${friend.displayName}`,
      description: 'Vos goûts réunis, mis à jour chaque jour',
      friend,
      rows: await loadTracks(picks.map((p) => p.trackId)),
      from: new Map(picks.map((p) => [p.trackId, p.from])),
    })
  }
  return mixes
}

// --- Weekly mixes and mixes opened on demand ------------------------------------------

// Artists played together by people sharing their activity, refreshed daily.
let sharedLinksCache: { day: string; links: Promise<Map<string, number>> } | null = null

function sharedLinks(day: string, now: number) {
  if (sharedLinksCache?.day === day) return sharedLinksCache.links
  const links = prisma.play
    .findMany({
      where: { playedAt: { gte: new Date(now - HISTORY_DAYS * DAY_MS) }, user: { shareActivity: true } },
      select: { userId: true, trackId: true, playedAt: true, track: { select: { artistId: true } } },
    })
    .then((plays) => {
      const byUser = new Map<string, PlayEvent[]>()
      for (const p of plays) byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), { trackId: p.trackId, playedAt: p.playedAt, artistId: p.track.artistId }])
      return coListening([...byUser.values()].flatMap(sessions))
    })
  sharedLinksCache = { day, links }
  links.catch(() => (sharedLinksCache = null))
  return links
}

/** Everyone's shared links, plus the user's own when they keep their activity private. */
async function linksFor(userId: string, events: PlayEvent[], day: string, now: number) {
  const [shared, user] = await Promise.all([sharedLinks(day, now), prisma.user.findUnique({ where: { id: userId }, select: { shareActivity: true } })])
  if (user?.shareActivity) return shared
  const links = new Map(shared)
  for (const [key, w] of coListening(sessions(events))) links.set(key, (links.get(key) ?? 0) + w)
  return links
}

async function artistNames(ids: string[]) {
  const artists = await prisma.artist.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
  const names = new Map(artists.map((a) => [a.id, a.name]))
  return ids.flatMap((id) => names.get(id) ?? [])
}

async function weeklyMixes(userId: string, week: string, now: number): Promise<Mix[]> {
  const { events, scores, artistOf } = await tasteOf(userId, now)
  const affinity = artistScores(scores, artistOf)
  const [links, heardRows, followed] = await Promise.all([
    linksFor(userId, events, today(now), now),
    prisma.play.findMany({ where: { userId }, distinct: ['trackId'], select: { trackId: true } }),
    prisma.followedArtist.findMany({ where: { userId }, select: { artistId: true } }),
  ])
  const mixes: Mix[] = []

  // shortcut: loads every track's ids, fine for a home library; filter by artist past ~100k tracks.
  const library = await prisma.track.findMany({ select: { id: true, artistId: true, albumId: true } })
  const heard = new Set([...heardRows.map((p) => p.trackId), ...scores.keys()])
  const discovery = buildDiscovery(affinity, links, library, heard, seededRandom(`${userId}:${week}:discover`))
  if (discovery.length >= MIN_MIX_TRACKS) {
    mixes.push({
      id: 'discover-weekly',
      kind: 'weekly',
      title: 'Discover Weekly',
      description: 'Des titres que tu n\'as jamais écoutés, choisis pour toi',
      friend: null,
      rows: await loadTracks(discovery.map((t) => t.id)),
    })
  }

  const artists = [...new Set([...affinity.keys(), ...followed.map((f) => f.artistId)])]
  const radar = await prisma.track.findMany({
    where: { artistId: { in: artists }, createdAt: { gte: new Date(now - RADAR_DAYS * DAY_MS) } },
    select: mixTrackSelect,
    orderBy: [{ createdAt: 'desc' }, { albumId: 'asc' }, { discNumber: 'asc' }, { trackNumber: 'asc' }],
    take: RADAR_SIZE,
  })
  if (radar.length >= MIN_RADAR_TRACKS) {
    mixes.push({
      id: 'release-radar',
      kind: 'radar',
      title: 'Release Radar',
      description: 'Les nouveautés de tes artistes',
      friend: null,
      rows: radar,
    })
  }
  return mixes
}

/** The most common genre of an artist's tracks. */
async function genreOf(artistId: string) {
  const [top] = await prisma.track.groupBy({
    by: ['genre'],
    where: { artistId, genre: { not: null } },
    _count: { genre: true },
    orderBy: { _count: { genre: 'desc' } },
    take: 1,
  })
  return top?.genre ?? null
}

async function radioMix(userId: string, kind: 'artist' | 'track', id: string, day: string, now: number): Promise<Mix | null> {
  const seedTrack = kind === 'track' ? await prisma.track.findUnique({ where: { id }, select: { id: true, title: true, artistId: true } }) : null
  const artist = await prisma.artist.findUnique({ where: { id: seedTrack?.artistId ?? id }, select: { id: true, name: true } })
  if (!artist || (kind === 'track' && !seedTrack)) return null
  const { events } = await tasteOf(userId, now)
  const related = relatedArtists(artist.id, await linksFor(userId, events, day, now))
  if (related.length < MIN_RELATED) {
    // Too little listening data: same-genre artists fill in, weaker than any played-together one.
    const genre = await genreOf(artist.id)
    const known = new Set([artist.id, ...related.map(([a]) => a)])
    const sameGenre = genre
      ? await prisma.track.findMany({ where: { genre, artistId: { notIn: [...known] } }, distinct: ['artistId'], select: { artistId: true } })
      : []
    const weight = Math.min(1, ...related.map(([, w]) => w)) / 2
    const random = seededRandom(`${day}:genre-fill:${artist.id}`)
    related.push(...shuffle(sameGenre, random).slice(0, RADIO_ARTISTS - related.length).map((t): [string, number] => [t.artistId, weight]))
  }
  const library = await prisma.track.findMany({
    where: { artistId: { in: [artist.id, ...related.map(([a]) => a)] } },
    select: { id: true, artistId: true, albumId: true },
  })
  const ids = buildRadio(artist.id, related, library, seededRandom(`${userId}:${day}:radio:${kind}:${id}`), seedTrack?.id).map((t) => t.id)
  const names = await artistNames(related.slice(0, 3).map(([a]) => a))
  return {
    id: `radio-${kind}-${id}`,
    kind: 'radio',
    title: `Radio ${seedTrack?.title ?? artist.name}`,
    description: names.length ? `Avec ${listNames([artist.name, ...names])}` : `Avec ${artist.name}`,
    friend: null,
    rows: await loadTracks(ids),
  }
}

/** Every genre in the library, most tracks first. */
export async function listGenres() {
  const groups = await prisma.track.groupBy({ by: ['genre'], where: { genre: { not: null } }, _count: { genre: true } })
  return groups
    .map((g) => ({ id: genreSlug(g.genre!), name: g.genre!, trackCount: g._count.genre }))
    .filter((g) => g.id)
    .sort((a, b) => b.trackCount - a.trackCount)
}

/** A genre: its most played tracks, then others to discover, new ones each day. */
async function genreMix(slug: string, day: string): Promise<Mix | null> {
  const genre = (await listGenres()).find((g) => g.id === slug)
  if (!genre) return null
  const tracks = await prisma.track.findMany({
    where: { genre: { equals: genre.name } },
    select: { id: true, artistId: true, albumId: true, _count: { select: { plays: true } } },
  })
  const random = seededRandom(`${day}:genre:${slug}`)
  const popular = tracks
    .filter((t) => t._count.plays > 0)
    .sort((a, b) => b._count.plays - a._count.plays)
    .slice(0, GENRE_SIZE / 2)
  const chosen = new Set(popular.map((t) => t.id))
  const others = shuffle(
    tracks.filter((t) => !chosen.has(t.id)),
    random,
  ).slice(0, GENRE_SIZE - popular.length)
  return {
    id: `genre-${slug}`,
    kind: 'genre',
    title: genre.name,
    description: `Les titres ${genre.name} les plus écoutés, et d'autres à découvrir`,
    friend: null,
    rows: await loadTracks(spreadArtists(shuffle([...popular, ...others], random)).map((t) => t.id)),
  }
}

/** The tracks the user played last, most recent first, each once. */
async function historyMix(userId: string): Promise<Mix> {
  const plays = await prisma.play.findMany({ where: { userId }, orderBy: { playedAt: 'desc' }, take: HISTORY_SIZE * 5, select: { trackId: true } })
  return {
    id: 'history',
    kind: 'history',
    title: 'Écoutés récemment',
    description: 'Tes derniers titres écoutés',
    friend: null,
    rows: await loadTracks([...new Set(plays.map((p) => p.trackId))].slice(0, HISTORY_SIZE)),
  }
}

// --- Caches -------------------------------------------------------------------------

// Each user's mixes for the day (or week), computed on first request.
type MixCache = Map<string, { key: string; mixes: Promise<Mix[]> }>
const dailyCache: MixCache = new Map()
const weeklyCache: MixCache = new Map()

/** The server's local date: mixes change at midnight. */
const today = (now: number) => new Date(now).toLocaleDateString('sv-SE')

/** The Monday of this week: weekly mixes change then. */
export function weekOf(now: number) {
  const d = new Date(now)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return today(d.getTime())
}

function cached(cache: MixCache, userId: string, key: string, build: () => Promise<Mix[]>) {
  const hit = cache.get(userId)
  if (hit && hit.key === key) return hit.mixes
  const mixes = build()
  cache.set(userId, { key, mixes })
  mixes.then(
    (list) => {
      // Nothing yet (a new account): look again in an hour rather than tomorrow.
      if (!list.length) setTimeout(() => cache.get(userId)?.mixes === mixes && cache.delete(userId), EMPTY_RETRY_MS).unref()
    },
    () => cache.delete(userId),
  )
  return mixes
}

async function mixesOf(userId: string) {
  const now = Date.now()
  const day = today(now)
  const week = weekOf(now)
  const [weekly, daily] = await Promise.all([
    cached(weeklyCache, userId, week, () => weeklyMixes(userId, week, now)),
    cached(dailyCache, userId, day, () => Promise.all([dailyMixes(userId, day, now), blends(userId, day, now)]).then(([d, b]) => [...d, ...b])),
  ])
  return [...weekly, ...daily]
}

/** Any mix by id: the listed ones, or a radio, genre or the history, made when opened. */
async function openMix(userId: string, id: string) {
  const now = Date.now()
  if (id === 'history') return historyMix(userId)
  const radio = /^radio-(artist|track)-(.+)$/.exec(id)
  if (radio) return radioMix(userId, radio[1] as 'artist' | 'track', radio[2], today(now), now)
  if (id.startsWith('genre-')) return genreMix(id.slice('genre-'.length), today(now))
  return (await mixesOf(userId)).find((m) => m.id === id) ?? null
}

function summary(mix: Mix) {
  return {
    id: mix.id,
    kind: mix.kind,
    title: mix.title,
    description: mix.description,
    friend: mix.friend,
    trackCount: mix.rows.length,
    covers: mosaic(mix.rows.map((track) => ({ track }))),
  }
}

export async function mixRoutes(app: FastifyInstance) {
  app.get('/me/mixes', async (req) => (await mixesOf(req.user!.id)).map(summary))

  app.get('/me/mixes/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const mix = await openMix(req.user!.id, id)
    if (!mix) return reply.code(404).send({ error: 'Mix introuvable' })
    return {
      ...summary(mix),
      tracks: mix.rows.map(({ albumId: _, ...row }) => ({
        ...toTrack(row),
        ...(mix.from ? { from: mix.from.get(row.id) ?? null } : {}),
      })),
    }
  })
}
