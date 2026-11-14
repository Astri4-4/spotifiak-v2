import type { FastifyInstance } from 'fastify'
import { prisma } from './db.js'
import { artistSelect, toArtist, toTrack, trackSelect } from './library.js'

// "Tes ères musicales": the listening history cut into chapters, each named after the
// artists that define it ("L'ère Daft Punk", mars → mai 2026). A week whose artists look
// like the chapter's so far continues it; one that doesn't starts a new chapter.

const WEEK_MS = 7 * 24 * 3600 * 1000
/** Fewer plays than this say little about a week: they join the chapter they fall in. */
const MIN_WEEK_PLAYS = 5
/** Below this likeness (cosine of artist plays) a week starts a new chapter. */
const SAME_ERA = 0.3
/** Smaller chapters are folded into the previous one. */
const MIN_ERA_PLAYS = 15
const TOP_ARTISTS = 5
const TOP_TRACKS = 20

export interface Listen {
  trackId: string
  artistId: string
  playedAt: Date
}

export interface Era {
  start: Date
  end: Date
  plays: number
  /** Most played first. */
  artists: { id: string; plays: number }[]
  tracks: { id: string; plays: number }[]
  /** The artists that define the chapter (named after them): played much more than usual. */
  signature: string[]
}

/** Monday 00:00 UTC of the week of `d`. */
export function weekStart(d: Date) {
  const day = (d.getUTCDay() + 6) % 7
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)
}

function count<K>(items: K[]) {
  const counts = new Map<K, number>()
  for (const k of items) counts.set(k, (counts.get(k) ?? 0) + 1)
  return counts
}

function add<K>(into: Map<K, number>, from: Map<K, number>) {
  for (const [k, n] of from) into.set(k, (into.get(k) ?? 0) + n)
}

export function cosine<K>(a: Map<K, number>, b: Map<K, number>) {
  let dot = 0
  let na = 0
  let nb = 0
  for (const [k, n] of a) {
    na += n * n
    dot += n * (b.get(k) ?? 0)
  }
  for (const n of b.values()) nb += n * n
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

const sorted = <K>(m: Map<K, number>) => [...m].sort((x, y) => y[1] - x[1])

/** Chapters of `listens` (any order), oldest first. */
export function findEras(listens: Listen[]): Era[] {
  if (!listens.length) return []
  const byWeek = new Map<number, Listen[]>()
  for (const l of listens) {
    const w = weekStart(l.playedAt)
    const week = byWeek.get(w)
    if (week) week.push(l)
    else byWeek.set(w, [l])
  }

  type Chapter = { weeks: Listen[][]; artists: Map<string, number> }
  const chapters: Chapter[] = []
  for (const w of [...byWeek.keys()].sort((a, b) => a - b)) {
    const week = byWeek.get(w)!
    const artists = count(week.map((l) => l.artistId))
    const last = chapters.at(-1)
    const continues = last && (week.length < MIN_WEEK_PLAYS || cosine(last.artists, artists) >= SAME_ERA)
    if (continues) {
      last.weeks.push(week)
      add(last.artists, artists)
    } else {
      chapters.push({ weeks: [week], artists })
    }
  }

  // Tiny chapters (a holiday week, one-off listens) don't make an era of their own; once
  // one is folded back, what follows it may well be the same era going on.
  const merged: Chapter[] = []
  for (const c of chapters) {
    const plays = c.weeks.reduce((n, w) => n + w.length, 0)
    const prev = merged.at(-1)
    if (prev && (plays < MIN_ERA_PLAYS || cosine(prev.artists, c.artists) >= SAME_ERA)) {
      prev.weeks.push(...c.weeks)
      add(prev.artists, c.artists)
    } else merged.push(c)
  }
  // The first chapter may itself be tiny: fold it into the next.
  if (merged.length > 1 && merged[0].weeks.flat().length < MIN_ERA_PLAYS) {
    const [first, second] = merged
    second.weeks.unshift(...first.weeks)
    add(second.artists, first.artists)
    merged.shift()
  }

  const overall = count(listens.map((l) => l.artistId))
  const total = listens.length
  return merged.map((c) => {
    const all = c.weeks.flat()
    const plays = all.length
    const artists = sorted(c.artists)
    // Defining artists: a good share of the chapter, and more than the user's usual share.
    const signature = artists
      .map(([id, n]) => ({ id, share: n / plays, lift: n / plays / ((overall.get(id) ?? n) / total) }))
      .filter((a) => a.share >= 0.08)
      .sort((a, b) => b.share * Math.log2(1 + b.lift) - a.share * Math.log2(1 + a.lift))
      .slice(0, 2)
      .map((a) => a.id)
    const times = all.map((l) => l.playedAt.getTime())
    return {
      start: new Date(Math.min(...times)),
      end: new Date(Math.max(...times)),
      plays,
      artists: artists.slice(0, TOP_ARTISTS).map(([id, n]) => ({ id, plays: n })),
      tracks: sorted(count(all.map((l) => l.trackId)))
        .slice(0, TOP_TRACKS)
        .map(([id, n]) => ({ id, plays: n })),
      signature: signature.length ? signature : artists.slice(0, 1).map(([id]) => id),
    }
  })
}

/** "L'ère Daft Punk", "L'ère Angèle & Stromae". */
export function eraTitle(names: string[]) {
  return names.length ? `L’ère ${names.join(' & ')}` : 'Une ère sans nom'
}

export async function eraRoutes(app: FastifyInstance) {
  app.get('/me/eras', async (req) => {
    const rows = await prisma.play.findMany({
      where: { userId: req.user!.id },
      select: { trackId: true, playedAt: true, track: { select: { artistId: true } } },
      orderBy: { playedAt: 'asc' },
    })
    const eras = findEras(rows.map((r) => ({ trackId: r.trackId, artistId: r.track.artistId, playedAt: r.playedAt })))
    const [tracks, artists] = await Promise.all([
      prisma.track.findMany({ where: { id: { in: [...new Set(eras.flatMap((e) => e.tracks.map((t) => t.id)))] } }, select: trackSelect }),
      prisma.artist.findMany({ where: { id: { in: [...new Set(eras.flatMap((e) => e.artists.map((a) => a.id).concat(e.signature)))] } }, select: artistSelect }),
    ])
    const trackById = new Map(tracks.map((t) => [t.id, toTrack(t)]))
    const artistById = new Map(artists.map((a) => [a.id, toArtist(a)]))
    const now = Date.now()
    return eras
      .map((e, i) => ({
        id: e.start.toISOString().slice(0, 10),
        title: eraTitle(e.signature.flatMap((id) => artistById.get(id)?.name ?? [])),
        start: e.start,
        end: e.end,
        plays: e.plays,
        // The latest chapter is still being written while the user keeps listening.
        current: i === eras.length - 1 && now - e.end.getTime() < 2 * WEEK_MS,
        artists: e.artists.flatMap(({ id, plays }) => {
          const artist = artistById.get(id)
          return artist ? [{ ...artist, plays }] : []
        }),
        tracks: e.tracks.flatMap(({ id }) => trackById.get(id) ?? []),
      }))
      .reverse()
  })
}
