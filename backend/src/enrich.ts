import type { FastifyBaseLogger } from 'fastify'
import { config } from './config.js'
import { prisma } from './db.js'

// Deezer allows 50 requests per 5 seconds; stay well under it.
const MIN_REQUEST_INTERVAL_MS = 150
const REQUEST_TIMEOUT_MS = 10_000
const MAX_ATTEMPTS = 4
// Entities Deezer didn't know are retried after this long (new releases, typo fixes).
const RETRY_UNMATCHED_AFTER_MS = 7 * 24 * 3600 * 1000

interface DeezerArtist {
  id: number
  name: string
  picture_xl?: string
  nb_fan?: number
}

interface DeezerAlbum {
  id: number
  title: string
  cover_xl: string
  artist?: DeezerArtist
}

interface DeezerTrack {
  id: number
  album: DeezerAlbum
  artist: DeezerArtist
}

interface DeezerError {
  error: { type: string; message: string; code: number }
}

const QUOTA_EXCEEDED = 4
const NOT_FOUND = 800

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let lastRequestAt = 0

/** GET from the Deezer API; returns null when Deezer says the entity doesn't exist. */
async function deezer<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  const url = new URL(path, config.DEEZER_API_URL)
  if (params) url.search = new URLSearchParams(params).toString()

  for (let attempt = 1; ; attempt++) {
    const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastRequestAt = Date.now()

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      if (res.status >= 500) throw new Error(`Deezer ${res.status}`)
      // Deezer reports errors with a 200 status and an error object.
      const body = (await res.json()) as T | DeezerError
      if (body && typeof body === 'object' && 'error' in body) {
        if (body.error.code === NOT_FOUND) return null
        if (body.error.code === QUOTA_EXCEEDED) throw new Error('Deezer quota exceeded')
        throw Object.assign(new Error(`Deezer: ${body.error.message}`), { permanent: true })
      }
      return body
    } catch (err) {
      if ((err as { permanent?: boolean }).permanent || attempt >= MAX_ATTEMPTS) throw err
      await sleep(1000 * 2 ** attempt)
    }
  }
}

/** Case, accents, punctuation and "feat." suffixes don't matter when comparing names. */
export function normalize(s: string) {
  return s
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s*[([](feat|ft|with)\.?\s[^)\]]*[)\]]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

async function albumFromIsrc(isrc: string): Promise<DeezerAlbum | null> {
  const track = await deezer<DeezerTrack>(`/track/isrc:${encodeURIComponent(isrc)}`)
  return track ? { ...track.album, artist: track.artist } : null
}

async function albumFromSearch(title: string, artist: string): Promise<DeezerAlbum | null> {
  const wantedTitle = normalize(title)
  const wantedArtist = normalize(artist)
  // The fielded query is precise but sometimes returns nothing for albums Deezer has
  // (e.g. Daft Punk's Discovery); free text finds those. Either way the result must
  // match title and artist exactly: a same-titled album by someone else is worse than none.
  for (const q of [`artist:"${artist}" album:"${title}"`, `${artist} ${title}`]) {
    const res = await deezer<{ data: DeezerAlbum[] }>('/search/album', { q })
    const match = res?.data.find(
      (a) => normalize(a.title) === wantedTitle && a.artist && normalize(a.artist.name) === wantedArtist,
    )
    if (match) return match
  }
  return null
}

async function artistFromSearch(name: string): Promise<DeezerArtist | null> {
  const res = await deezer<{ data: DeezerArtist[] }>('/search/artist', { q: name })
  const wanted = normalize(name)
  // Homonyms and fan-made profiles exist: among exact name matches, the most followed wins.
  const matches = (res?.data ?? []).filter((a) => normalize(a.name) === wanted)
  return matches.sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0))[0] ?? null
}

function needsLookup(now: number) {
  return {
    OR: [
      { enrichedAt: null },
      { deezerId: null, enrichedAt: { lt: new Date(now - RETRY_UNMATCHED_AFTER_MS) } },
    ],
  }
}

export interface EnrichStatus {
  enabled: boolean
  running: boolean
  albums: { done: number; total: number; matched: number }
  artists: { done: number; total: number; matched: number }
  lastFinishedAt: Date | null
  lastFailed: number
}

export const enrichStatus: EnrichStatus = {
  enabled: config.DEEZER_ENRICH,
  running: false,
  albums: { done: 0, total: 0, matched: 0 },
  artists: { done: 0, total: 0, matched: 0 },
  lastFinishedAt: null,
  lastFailed: 0,
}

/**
 * Fetches album covers and artist pictures from Deezer for entities not looked up yet.
 * Albums are matched by ISRC when a track has one (exact), otherwise by artist + title.
 */
export async function enrichLibrary(log: FastifyBaseLogger): Promise<void> {
  if (!config.DEEZER_ENRICH || enrichStatus.running) return
  const s = enrichStatus
  Object.assign(s, {
    running: true,
    albums: { done: 0, total: 0, matched: 0 },
    artists: { done: 0, total: 0, matched: 0 },
  })
  let failed = 0

  try {
    const now = Date.now()

    const albums = await prisma.album.findMany({
      where: needsLookup(now),
      select: {
        id: true,
        title: true,
        artist: { select: { id: true, name: true, enrichedAt: true } },
        tracks: { where: { isrc: { not: null } }, select: { isrc: true }, take: 1 },
      },
    })

    s.albums.total = albums.length
    for (const album of albums) {
      try {
        // A recording (ISRC) can appear on several releases, e.g. compilations: only
        // trust the ISRC hit if it's this album. Without a confident match we keep the
        // art embedded in the files, which deemix took from the right release.
        const isrc = album.tracks[0]?.isrc
        const byIsrc = isrc ? await albumFromIsrc(isrc) : null
        const match =
          byIsrc && normalize(byIsrc.title) === normalize(album.title)
            ? byIsrc
            : await albumFromSearch(album.title, album.artist.name)

        await prisma.album.update({
          where: { id: album.id },
          data: { deezerId: match?.id ?? null, coverUrl: match?.cover_xl ?? null, enrichedAt: new Date() },
        })
        if (!match) continue
        s.albums.matched++

        // The album's Deezer artist is an exact match for free, no name search needed.
        const deezerArtist = match.artist
        if (deezerArtist?.picture_xl && normalize(deezerArtist.name) === normalize(album.artist.name)) {
          await prisma.artist.update({
            where: { id: album.artist.id },
            data: { deezerId: deezerArtist.id, pictureUrl: deezerArtist.picture_xl, enrichedAt: new Date() },
          })
        }
      } catch (err) {
        failed++
        log.warn({ err, album: album.title }, 'Deezer album lookup failed')
      } finally {
        s.albums.done++
      }
    }

    // Artists not resolved through one of their albums (e.g. only featured on tracks).
    const artists = await prisma.artist.findMany({ where: needsLookup(now), select: { id: true, name: true } })
    s.artists.total = artists.length
    for (const artist of artists) {
      try {
        const match = await artistFromSearch(artist.name)
        await prisma.artist.update({
          where: { id: artist.id },
          data: { deezerId: match?.id ?? null, pictureUrl: match?.picture_xl ?? null, enrichedAt: new Date() },
        })
        if (match) s.artists.matched++
      } catch (err) {
        failed++
        log.warn({ err, artist: artist.name }, 'Deezer artist lookup failed')
      } finally {
        s.artists.done++
      }
    }

    if (s.albums.total || s.artists.total) {
      log.info({ albums: s.albums, artists: s.artists, failed }, 'Deezer enrichment finished')
    }
  } finally {
    Object.assign(s, { running: false, lastFinishedAt: new Date(), lastFailed: failed })
  }
}
