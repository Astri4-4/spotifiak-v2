import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { config } from './config.js'
import { prisma } from './db.js'
import { deezer, normalize } from './enrich.js'

// Releases from this many days back, and every announced one.
const RELEASE_WINDOW_DAYS = 183
const RELEASES_TTL_MS = 6 * 3600 * 1000
// Ticketmaster allows 5000 requests a day: concerts are kept longer.
const CONCERTS_TTL_MS = 12 * 3600 * 1000
// Ticketmaster allows 5 requests per second.
const TICKETMASTER_INTERVAL_MS = 250
const REQUEST_TIMEOUT_MS = 10_000
const EVENTS_PER_ARTIST = 50

// --- Pure helpers (tested) ----------------------------------------------------

interface DeezerRelease {
  id: number
  title: string
  cover_medium?: string
  release_date?: string
  record_type?: string
  link?: string
}

export interface Release {
  id: number
  title: string
  /** album, single, ep or compile, as Deezer names them. */
  type: string
  /** YYYY-MM-DD */
  date: string
  coverUrl: string | null
  link: string
}

/** Deezer's releases of an artist within the window (the last six months, and announced ones). */
export function recentReleases(all: DeezerRelease[], today: Date, windowDays = RELEASE_WINDOW_DAYS): Release[] {
  const from = new Date(today.getTime() - windowDays * 24 * 3600 * 1000).toISOString().slice(0, 10)
  return all
    .filter((r): r is DeezerRelease & { release_date: string } => !!r.release_date && r.release_date >= from)
    .map((r) => ({
      id: r.id,
      title: r.title,
      type: r.record_type ?? 'album',
      date: r.release_date,
      coverUrl: r.cover_medium ?? null,
      link: r.link ?? `https://www.deezer.com/album/${r.id}`,
    }))
}

interface Attraction {
  id: string
  name: string
}

/** The Ticketmaster artist with exactly this name (ignoring case and accents), or none:
 *  a keyword search also returns tribute bands and namesakes. */
export function pickAttraction(name: string, attractions: Attraction[]): Attraction | null {
  const wanted = normalize(name)
  return attractions.find((a) => normalize(a.name) === wanted) ?? null
}

interface TicketmasterEvent {
  id: string
  name: string
  url?: string
  dates?: { start?: { localDate?: string; localTime?: string }; status?: { code?: string } }
  _embedded?: { venues?: { name?: string; city?: { name?: string }; country?: { name?: string; countryCode?: string } }[] }
}

export interface Concert {
  id: string
  name: string
  /** YYYY-MM-DD, local to the venue. */
  date: string
  /** HH:MM, local to the venue; null when not announced. */
  time: string | null
  venue: string | null
  city: string | null
  country: string | null
  url: string | null
  cancelled: boolean
}

export function toConcert(e: TicketmasterEvent): Concert | null {
  const date = e.dates?.start?.localDate
  if (!date) return null
  const venue = e._embedded?.venues?.[0]
  return {
    id: e.id,
    name: e.name,
    date,
    time: e.dates?.start?.localTime?.slice(0, 5) ?? null,
    venue: venue?.name ?? null,
    city: venue?.city?.name ?? null,
    country: venue?.country?.name ?? venue?.country?.countryCode ?? null,
    url: e.url ?? null,
    cancelled: e.dates?.status?.code === 'cancelled',
  }
}

// --- Sources, cached in memory and filled in the background --------------------

interface Entry<T> {
  at: number
  value: T
}

const releasesCache = new Map<number, Entry<Release[]>>()
const concertsCache = new Map<string, Entry<Concert[]>>()
const pending = new Set<string>()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let lastTicketmasterAt = 0

async function ticketmaster<T>(path: string, params: Record<string, string>): Promise<T> {
  const wait = lastTicketmasterAt + TICKETMASTER_INTERVAL_MS - Date.now()
  lastTicketmasterAt = Date.now() + Math.max(0, wait)
  if (wait > 0) await sleep(wait)
  const url = new URL(`${config.TICKETMASTER_API_URL}/${path}`)
  url.search = new URLSearchParams({ ...params, apikey: config.TICKETMASTER_API_KEY! }).toString()
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Ticketmaster ${res.status}`)
  return (await res.json()) as T
}

async function loadReleases(deezerId: number): Promise<Release[]> {
  const page = await deezer<{ data: DeezerRelease[] }>(`/artist/${deezerId}/albums`, { limit: '100' })
  return recentReleases(page?.data ?? [], new Date())
}

async function loadConcerts(name: string): Promise<Concert[]> {
  const found = await ticketmaster<{ _embedded?: { attractions?: Attraction[] } }>('attractions.json', {
    keyword: name,
    classificationName: 'music',
    size: '20',
  })
  const attraction = pickAttraction(name, found._embedded?.attractions ?? [])
  if (!attraction) return []
  const events = await ticketmaster<{ _embedded?: { events?: TicketmasterEvent[] } }>('events.json', {
    attractionId: attraction.id,
    sort: 'date,asc',
    size: String(EVENTS_PER_ARTIST),
  })
  return (events._embedded?.events ?? []).map(toConcert).filter((c): c is Concert => !!c)
}

/** What the cache has (possibly stale), loading a missing or stale value in the background.
 *  Returns undefined while a missing value loads. */
function cachedOrLoad<K, T>(
  cache: Map<K, Entry<T>>,
  key: K,
  ttl: number,
  load: () => Promise<T>,
  log: FastifyBaseLogger,
): T | undefined {
  const entry = cache.get(key)
  const id = `${String(ttl)}:${String(key)}`
  if ((!entry || Date.now() - entry.at > ttl) && !pending.has(id)) {
    pending.add(id)
    load()
      .then((value) => cache.set(key, { at: Date.now(), value }))
      .catch((err: Error) => {
        log.warn({ key, err: err.message }, 'calendar source failed')
        // Retried after a while rather than on every request.
        cache.set(key, { at: Date.now() - ttl + 15 * 60 * 1000, value: entry?.value ?? ([] as T) })
      })
      .finally(() => pending.delete(id))
  }
  return entry?.value
}

export async function calendarRoutes(app: FastifyInstance) {
  // New releases and upcoming shows of the artists the user follows. Sources load in the
  // background: `loading` counts artists still missing; clients ask again until it's 0.
  app.get('/me/calendar', async (req) => {
    const followed = await prisma.followedArtist.findMany({
      where: { userId: req.user!.id },
      select: { artist: { select: { id: true, name: true, deezerId: true, pictureUrl: true } } },
    })
    const concertsEnabled = !!config.TICKETMASTER_API_KEY
    let loading = 0
    const releases: (Release & { artist: { id: string; name: string; pictureUrl: string | null }; albumId: string | null })[] = []
    const concerts: (Concert & { artist: { id: string; name: string; pictureUrl: string | null } })[] = []

    for (const { artist } of followed) {
      const { deezerId, ...person } = artist
      if (deezerId) {
        const found = cachedOrLoad(releasesCache, deezerId, RELEASES_TTL_MS, () => loadReleases(deezerId), req.log)
        if (found) releases.push(...found.map((r) => ({ ...r, artist: person, albumId: null })))
        else loading++
      }
      if (concertsEnabled) {
        const found = cachedOrLoad(concertsCache, normalize(artist.name), CONCERTS_TTL_MS, () => loadConcerts(artist.name), req.log)
        if (found) concerts.push(...found.map((c) => ({ ...c, artist: person })))
        else loading++
      }
    }

    // Releases already in the library open there instead of offering a download.
    const local = await prisma.album.findMany({
      where: { deezerId: { in: releases.map((r) => r.id) } },
      select: { id: true, deezerId: true },
    })
    const localIds = new Map(local.map((a) => [a.deezerId, a.id]))
    for (const r of releases) r.albumId = localIds.get(r.id) ?? null

    const today = new Date().toISOString().slice(0, 10)
    return {
      concertsEnabled,
      loading,
      releases: releases.sort((a, b) => b.date.localeCompare(a.date)),
      concerts: concerts.filter((c) => c.date >= today).sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? ''))),
    }
  })
}
