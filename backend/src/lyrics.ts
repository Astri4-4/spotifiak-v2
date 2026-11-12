import { readFile } from 'node:fs/promises'
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { parseFile } from 'music-metadata'
import { z } from 'zod'
import { config } from './config.js'
import { prisma } from './db.js'
import { resolveMusicPath } from './stream.js'

// A track's lyrics, from the best source that has them: synced lyrics (with a time per line)
// before plain ones, and the files before LRCLIB (lrclib.net, a free public lyrics database).
// Sources, in order: an .lrc file next to the audio (deemix writes them), the file's tags, LRCLIB.

const FETCH_TIMEOUT_MS = 8_000
const USER_AGENT = 'Spotifiak/1.0 (lyrics)'
// LRCLIB misses are cached too; lyrics get added there over time.
const RETRY_MISS_AFTER_MS = 30 * 24 * 3600 * 1000
// LRCLIB's duration match, in seconds, when searching.
const DURATION_TOLERANCE_SEC = 3

export interface LyricsLine {
  /** Seconds from the start; null for plain (unsynced) lyrics. */
  time: number | null
  text: string
}

export interface Lyrics {
  synced: boolean
  lines: LyricsLine[]
  instrumental: boolean
  source: 'file' | 'tags' | 'lrclib' | null
}

const NONE: Lyrics = { synced: false, lines: [], instrumental: false, source: null }

// --- Parsing ------------------------------------------------------------------

const STAMP = /^\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/
// Enhanced LRC's per-word times: <mm:ss.xx>
const WORD_STAMP = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g

/** Lines of an LRC file, sorted by time; metadata tags ([ar:], [ti:]...) are skipped. */
export function parseLrc(text: string): LyricsLine[] {
  let offset = 0
  const lines: { time: number; text: string }[] = []
  for (const raw of text.split(/\r?\n/)) {
    const offsetTag = /^\s*\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw)
    if (offsetTag) {
      // Milliseconds; positive shows the lyrics sooner.
      offset = Number(offsetTag[1]) / 1000
      continue
    }
    const times: number[] = []
    let rest = raw
    for (let m = STAMP.exec(rest); m; m = STAMP.exec(rest)) {
      times.push(Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0))
      rest = rest.slice(m[0].length)
    }
    const line = rest.replace(WORD_STAMP, '').trim()
    for (const time of times) lines.push({ time: Math.max(0, Math.round((time - offset) * 1000) / 1000), text: line })
  }
  return lines.sort((a, b) => a.time - b.time)
}

/** Plain lyrics as lines, without the blank lines around them. */
export function plainLines(text: string): LyricsLine[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  while (lines.length && !lines[0]) lines.shift()
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  return lines.map((text) => ({ time: null, text }))
}

const hasWords = (lines: LyricsLine[]) => lines.some((l) => l.text)

// --- Local sources ------------------------------------------------------------

interface Local {
  synced?: Lyrics
  plain?: Lyrics
}

async function fromFile(trackPath: string): Promise<Local> {
  const file = resolveMusicPath(trackPath)
  if (!file) return {}
  const local: Local = {}

  const lrc = await readFile(file.replace(/\.[^./]+$/, '.lrc'), 'utf8').catch(() => null)
  if (lrc) {
    const synced = parseLrc(lrc)
    if (hasWords(synced)) return { synced: { synced: true, lines: synced, instrumental: false, source: 'file' } }
    // An .lrc without times: plain lyrics.
    if (lrc.trim()) local.plain = { synced: false, lines: plainLines(lrc), instrumental: false, source: 'file' }
  }

  const tags = (await parseFile(file, { skipCovers: true }).catch(() => null))?.common.lyrics ?? []
  for (const tag of tags) {
    const timed = tag.syncText.filter((l) => l.timestamp !== undefined)
    if (timed.length && hasWords(timed.map((l) => ({ time: 0, text: l.text })))) {
      const lines = timed
        .map((l) => ({ time: l.timestamp! / 1000, text: l.text.trim() }))
        .sort((a, b) => a.time - b.time)
      return { synced: { synced: true, lines, instrumental: false, source: 'tags' } }
    }
    const text = tag.text ?? tag.syncText.map((l) => l.text).join('\n')
    if (!local.plain && text.trim()) local.plain = { synced: false, lines: plainLines(text), instrumental: false, source: 'tags' }
  }
  return local
}

// --- LRCLIB ---------------------------------------------------------------------

interface LrclibRecord {
  duration?: number
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

interface TrackInfo {
  title: string
  artist: string
  album: string | null
  durationSec: number | null
}

async function lrclib(pathname: string, params: Record<string, string>) {
  const url = new URL(pathname, config.LRCLIB_URL)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`LRCLIB answered ${res.status}`)
  return res.json() as Promise<unknown>
}

/** The search result to use: the closest duration, with synced lyrics preferred. */
export function pickRecord(records: LrclibRecord[], durationSec: number | null): LrclibRecord | null {
  const fits = records.filter(
    (r) => durationSec === null || r.duration === undefined || Math.abs(r.duration - durationSec) <= DURATION_TOLERANCE_SEC,
  )
  return fits.find((r) => r.syncedLyrics) ?? fits.find((r) => r.plainLyrics || r.instrumental) ?? null
}

async function searchLrclib(track: TrackInfo): Promise<LrclibRecord | null> {
  // The exact lookup needs the album and duration; it also finds lyrics the search ranks low.
  if (track.album && track.durationSec) {
    const exact = (await lrclib('/api/get', {
      track_name: track.title,
      artist_name: track.artist,
      album_name: track.album,
      duration: String(track.durationSec),
    })) as LrclibRecord | null
    if (exact && (exact.syncedLyrics || exact.plainLyrics || exact.instrumental)) return exact
  }
  const found = (await lrclib('/api/search', { track_name: track.title, artist_name: track.artist })) as LrclibRecord[] | null
  return pickRecord(Array.isArray(found) ? found : [], track.durationSec)
}

function toLyrics(row: { synced: string | null; plain: string | null; instrumental: boolean }): Lyrics {
  if (row.synced) {
    const lines = parseLrc(row.synced)
    if (hasWords(lines)) return { synced: true, lines, instrumental: false, source: 'lrclib' }
  }
  if (row.plain?.trim()) return { synced: false, lines: plainLines(row.plain), instrumental: false, source: 'lrclib' }
  return { ...NONE, instrumental: row.instrumental, source: row.instrumental ? 'lrclib' : null }
}

async function fromLrclib(trackId: string, track: TrackInfo, log: FastifyBaseLogger): Promise<Lyrics> {
  const cached = await prisma.trackLyrics.findUnique({ where: { trackId } })
  const miss = cached && !cached.synced && !cached.plain && !cached.instrumental
  if (cached && !(miss && Date.now() - cached.fetchedAt.getTime() > RETRY_MISS_AFTER_MS)) return toLyrics(cached)
  let record: LrclibRecord | null
  try {
    record = await searchLrclib(track)
  } catch (err) {
    // Not cached: the next request tries again.
    log.warn({ err: (err as Error).message, trackId }, 'LRCLIB lookup failed')
    return cached ? toLyrics(cached) : NONE
  }
  const row = {
    synced: record?.syncedLyrics || null,
    plain: record?.plainLyrics || null,
    instrumental: !!record?.instrumental,
    fetchedAt: new Date(),
  }
  await prisma.trackLyrics.upsert({ where: { trackId }, create: { trackId, ...row }, update: row })
  return toLyrics(row)
}

// --- Routes ---------------------------------------------------------------------

// Players ask as each track starts: one lookup per track at a time.
const inFlight = new Map<string, Promise<Lyrics | null>>()

async function lyricsOf(trackId: string, log: FastifyBaseLogger): Promise<Lyrics | null> {
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: { path: true, title: true, durationSec: true, artist: { select: { name: true } }, album: { select: { title: true } } },
  })
  if (!track) return null
  const local = await fromFile(track.path)
  if (local.synced) return local.synced
  if (!config.LYRICS_LRCLIB) return local.plain ?? NONE
  // The primary artist: the artist tag may list several ("A, B", "A feat. B").
  const info = { title: track.title, artist: track.artist.name, album: track.album?.title ?? null, durationSec: track.durationSec }
  const online = await fromLrclib(trackId, info, log)
  if (online.synced) return online
  return local.plain ?? online
}

export async function lyricsRoutes(app: FastifyInstance) {
  app.get('/tracks/:id/lyrics', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    let pending = inFlight.get(id)
    if (!pending) {
      pending = lyricsOf(id, req.log).finally(() => inFlight.delete(id))
      inFlight.set(id, pending)
    }
    const lyrics = await pending
    return lyrics ?? reply.code(404).send({ error: 'Titre introuvable' })
  })
}
