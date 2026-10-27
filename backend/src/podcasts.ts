import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify'
import { XMLParser } from 'fast-xml-parser'
import { z } from 'zod'
import { config } from './config.js'
import { prisma } from './db.js'
import type { Prisma } from './generated/prisma/client.js'

// Podcasts come from their RSS feeds: the server reads the feeds and keeps the episode
// list, the browser streams the audio straight from the publisher. Search goes through
// public podcast directories (Apple's and fyyd's), which give each podcast's feed URL.

const FETCH_TIMEOUT_MS = 20_000
// Feeds of long-running shows reach a few megabytes; refuse anything far beyond.
const MAX_FEED_BYTES = 30 * 1024 * 1024
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
// A podcast page refreshes its feed when it was last read longer ago than this.
const STALE_AFTER_MS = 60 * 60 * 1000
const MAX_EPISODES_LISTED = 300
const DESCRIPTION_PREVIEW = 600
const USER_AGENT = 'Spotifiak/1.0 (podcast client)'

const idParams = z.object({ id: z.string() })

// --- Feeds ---------------------------------------------------------------------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Keep values as strings: a guid "0123" must not become the number 123.
  parseTagValue: false,
  isArray: (name) => name === 'item',
})

type XmlValue = string | { '#text'?: string; '@_href'?: string; '@_url'?: string } | undefined

const text = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v.trim() || undefined
  if (Array.isArray(v)) return text(v[0])
  if (v && typeof v === 'object' && '#text' in v) return text((v as { '#text': unknown })['#text'])
  return undefined
}

const attr = (v: unknown, name: '@_href' | '@_url'): string | undefined => {
  if (Array.isArray(v)) return attr(v[0], name)
  return v && typeof v === 'object' ? text((v as Record<string, unknown>)[name]) : undefined
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Descriptions are HTML: keep the text and its paragraphs, never the markup. */
export function plainText(html: string | undefined, max = 4000) {
  if (!html) return null
  const out = html
    .replace(/<(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return out ? out.slice(0, max) : null
}

/** itunes:duration is "3723", "62:03" or "1:02:03". */
export function parseDuration(v: string | undefined) {
  if (!v) return null
  const parts = v.split(':').map(Number)
  if (!parts.length || parts.some((p) => !Number.isFinite(p))) return null
  return Math.round(parts.reduce((total, p) => total * 60 + p, 0)) || null
}

const httpUrl = (v: string | undefined) => (v && /^https?:\/\//i.test(v) ? v : undefined)

export interface ParsedFeed {
  title: string
  author: string | null
  description: string | null
  imageUrl: string | null
  link: string | null
  episodes: {
    guid: string
    title: string
    description: string | null
    audioUrl: string
    imageUrl: string | null
    durationSec: number | null
    publishedAt: Date
  }[]
}

export function parseFeed(xml: string): ParsedFeed {
  const channel = (parser.parse(xml) as { rss?: { channel?: Record<string, unknown> } }).rss?.channel
  const title = channel && text(channel.title)
  if (!channel || !title) throw new Error("Ce n'est pas un flux RSS de podcast")

  const imageUrl = httpUrl(attr(channel['itunes:image'], '@_href') ?? text((channel.image as { url?: XmlValue })?.url))
  const episodes: ParsedFeed['episodes'] = []
  for (const item of (channel.item as Record<string, unknown>[] | undefined) ?? []) {
    const audioUrl = httpUrl(attr(item.enclosure, '@_url'))
    if (!audioUrl) continue // text-only posts
    const published = new Date(text(item.pubDate) ?? '')
    episodes.push({
      guid: text(item.guid) ?? audioUrl,
      title: text(item.title) ?? 'Sans titre',
      description: plainText(text(item['content:encoded']) ?? text(item.description) ?? text(item['itunes:summary'])),
      audioUrl,
      imageUrl: httpUrl(attr(item['itunes:image'], '@_href')) ?? null,
      durationSec: parseDuration(text(item['itunes:duration'])),
      publishedAt: Number.isNaN(published.getTime()) ? new Date(0) : published,
    })
  }

  return {
    title,
    author: text(channel['itunes:author']) ?? null,
    description: plainText(text(channel.description) ?? text(channel['itunes:summary'])),
    imageUrl: imageUrl ?? null,
    link: httpUrl(text(channel.link)) ?? null,
    episodes,
  }
}

async function download(url: string, maxBytes: number) {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (Number(res.headers.get('content-length') ?? 0) > maxBytes) throw new Error('Trop volumineux')
  const body = Buffer.from(await res.arrayBuffer())
  if (body.length > maxBytes) throw new Error('Trop volumineux')
  return { body, type: res.headers.get('content-type') ?? '' }
}

/** Reads a feed and stores the podcast and its new episodes; returns the podcast id. */
export async function refreshFeed(feedUrl: string) {
  const feed = parseFeed((await download(feedUrl, MAX_FEED_BYTES)).body.toString('utf8'))
  const info = { title: feed.title, author: feed.author, description: feed.description, imageUrl: feed.imageUrl, link: feed.link }
  const podcast = await prisma.podcast.upsert({
    where: { feedUrl },
    create: { feedUrl, ...info, fetchedAt: new Date() },
    update: { ...info, fetchedAt: new Date() },
  })

  // Feeds list every episode on each read: insert the new ones, update the few that
  // changed (publishers fix titles and move audio files).
  const known = new Map(
    (
      await prisma.podcastEpisode.findMany({
        where: { podcastId: podcast.id },
        select: { id: true, guid: true, title: true, audioUrl: true, durationSec: true },
      })
    ).map((e) => [e.guid, e]),
  )
  const seen = new Set<string>()
  const created: Prisma.PodcastEpisodeCreateManyInput[] = []
  const changed: { id: string; data: Prisma.PodcastEpisodeUpdateInput }[] = []
  for (const e of feed.episodes) {
    if (seen.has(e.guid)) continue // some feeds repeat an item
    seen.add(e.guid)
    const old = known.get(e.guid)
    if (!old) created.push({ ...e, podcastId: podcast.id })
    else if (old.title !== e.title || old.audioUrl !== e.audioUrl || old.durationSec !== e.durationSec) {
      changed.push({ id: old.id, data: e })
    }
  }
  if (created.length) await prisma.podcastEpisode.createMany({ data: created, skipDuplicates: true })
  for (const { id, data } of changed) await prisma.podcastEpisode.update({ where: { id }, data })
  return podcast.id
}

/** Refreshes the feeds people subscribe to, one at a time. */
async function refreshSubscribed(log: FastifyBaseLogger) {
  const podcasts = await prisma.podcast.findMany({
    where: { ownerId: null, subscribers: { some: {} } },
    select: { feedUrl: true },
  })
  for (const { feedUrl } of podcasts) {
    await refreshFeed(feedUrl).catch((err: Error) => log.warn({ feedUrl, err: err.message }, 'podcast refresh failed'))
  }
}

export function startPodcastRefresh(log: FastifyBaseLogger) {
  if (!config.PODCAST_REFRESH_MINUTES) return
  setInterval(() => void refreshSubscribed(log), config.PODCAST_REFRESH_MINUTES * 60_000).unref()
}

// --- API shapes ----------------------------------------------------------------

const episodeSelect = {
  id: true,
  title: true,
  description: true,
  durationSec: true,
  publishedAt: true,
  audioUrl: true,
  imageUrl: true,
  sourceUrl: true,
  status: true,
  error: true,
  podcast: { select: { id: true, title: true, imageUrl: true } },
} satisfies Prisma.PodcastEpisodeSelect

type EpisodeRow = Prisma.PodcastEpisodeGetPayload<{ select: typeof episodeSelect }>

function toEpisode(e: EpisodeRow, progress?: { positionSec: number; completed: boolean }) {
  return {
    id: e.id,
    title: e.title,
    description: e.description && e.description.slice(0, DESCRIPTION_PREVIEW),
    durationSec: e.durationSec,
    publishedAt: e.publishedAt,
    // Videos added to a created podcast are served by the API (see youtube.ts).
    audioUrl: e.sourceUrl ? null : e.audioUrl,
    sourceUrl: e.sourceUrl,
    status: e.status,
    error: e.error,
    // Images go through the API (see the image routes): same origin, no CORS trouble.
    hasImage: !!(e.imageUrl ?? e.podcast.imageUrl),
    podcast: { id: e.podcast.id, title: e.podcast.title },
    progress: progress ?? null,
  }
}

const podcastSummary = (p: { id: string; title: string; author: string | null; imageUrl: string | null }) => ({
  id: p.id,
  title: p.title,
  author: p.author,
  hasImage: !!p.imageUrl,
})

async function progressOf(userId: string, episodeIds: string[]) {
  const rows = await prisma.episodeProgress.findMany({
    where: { userId, episodeId: { in: episodeIds } },
    select: { episodeId: true, positionSec: true, completed: true },
  })
  return new Map(rows.map((r) => [r.episodeId, { positionSec: r.positionSec, completed: r.completed }]))
}

async function sendImage(reply: FastifyReply, url: string | null | undefined) {
  if (!url) return reply.code(404).send({ error: 'Pas d’image' })
  try {
    const { body, type } = await download(url, MAX_IMAGE_BYTES)
    if (!type.startsWith('image/')) return reply.code(404).send({ error: 'Pas d’image' })
    return reply.type(type).header('cache-control', 'public, max-age=604800').send(body)
  } catch {
    return reply.code(502).send({ error: 'Image injoignable' })
  }
}

// --- Routes --------------------------------------------------------------------

interface AppleResult {
  collectionName?: string
  artistName?: string
  feedUrl?: string
  artworkUrl600?: string
}

interface FyydResult {
  title?: string
  author?: string
  xmlURL?: string
  imgURL?: string
}

interface SearchResult {
  feedUrl: string
  title: string
  author: string | null
  imageUrl: string | null
}

const SEARCH_TIMEOUT_MS = 8000
const SEARCH_LIMIT = 20
// Apple results without a feed looked up one by one on fyyd, at most this many.
const MAX_FEED_LOOKUPS = 8

const normalizeTitle = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

async function getJson<T>(url: URL) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

async function searchApple(term: string): Promise<AppleResult[]> {
  const url = new URL('/search', config.PODCAST_SEARCH_URL)
  url.search = new URLSearchParams({
    term,
    media: 'podcast',
    entity: 'podcast',
    limit: String(SEARCH_LIMIT),
    country: config.PODCAST_COUNTRY,
  }).toString()
  return (await getJson<{ results?: AppleResult[] }>(url)).results ?? []
}

async function searchFyyd(term: string, count = SEARCH_LIMIT): Promise<SearchResult[]> {
  const url = new URL('/0.2/search/podcast', config.PODCAST_FYYD_URL)
  url.search = new URLSearchParams({ term, count: String(count) }).toString()
  return ((await getJson<{ data?: FyydResult[] }>(url)).data ?? []).flatMap((r) =>
    r.xmlURL && r.title ? [{ feedUrl: r.xmlURL, title: r.title, author: r.author || null, imageUrl: r.imgURL || null }] : [],
  )
}

/**
 * Apple ranks best but hides some feeds (Radio France's among them); those are
 * looked up on fyyd by title. fyyd's own results fill the rest.
 */
async function searchDirectories(term: string, log: FastifyBaseLogger): Promise<SearchResult[]> {
  const [apple, fyyd] = await Promise.allSettled([searchApple(term), searchFyyd(term)])
  for (const r of [apple, fyyd]) if (r.status === 'rejected') log.warn({ err: r.reason }, 'podcast directory failed')
  if (apple.status === 'rejected' && fyyd.status === 'rejected') throw new Error('No podcast directory reachable')
  const fromFyyd = fyyd.status === 'fulfilled' ? fyyd.value : []

  const byTitle = new Map(fromFyyd.map((r) => [normalizeTitle(r.title), r]))
  let lookups = 0
  const fromApple = await Promise.all(
    (apple.status === 'fulfilled' ? apple.value : []).map(async (r): Promise<SearchResult | null> => {
      if (!r.collectionName) return null
      const key = normalizeTitle(r.collectionName)
      let feedUrl = r.feedUrl ?? byTitle.get(key)?.feedUrl
      if (!feedUrl && fyyd.status === 'fulfilled' && lookups++ < MAX_FEED_LOOKUPS) {
        const found = await searchFyyd(r.collectionName, 5).catch(() => [])
        feedUrl = found.find((f) => normalizeTitle(f.title) === key)?.feedUrl
      }
      if (!feedUrl) return null
      return { feedUrl, title: r.collectionName, author: r.artistName ?? null, imageUrl: r.artworkUrl600 ?? null }
    }),
  )

  const results: SearchResult[] = []
  const seen = new Set<string>()
  for (const r of [...fromApple, ...fromFyyd]) {
    if (!r || seen.has(r.feedUrl) || seen.has(normalizeTitle(r.title))) continue
    seen.add(r.feedUrl)
    seen.add(normalizeTitle(r.title))
    results.push(r)
  }
  return results.slice(0, SEARCH_LIMIT)
}

export async function podcastRoutes(app: FastifyInstance) {
  app.get('/podcasts/search', async (req, reply) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(200) }).parse(req.query)
    let found: SearchResult[]
    try {
      found = await searchDirectories(q, req.log)
    } catch {
      return reply.code(502).send({ error: 'Recherche de podcasts indisponible' })
    }
    const known = new Map(
      (
        await prisma.podcast.findMany({
          where: { feedUrl: { in: found.map((r) => r.feedUrl) } },
          select: { id: true, feedUrl: true },
        })
      ).map((p) => [p.feedUrl, p.id]),
    )
    return found.map((r) => ({ ...r, podcastId: known.get(r.feedUrl) ?? null }))
  })

  // Opens a podcast from a search result or a pasted RSS URL (reads the feed the first time).
  app.post('/podcasts', async (req, reply) => {
    const { feedUrl } = z
      .object({ feedUrl: z.string().trim().url().regex(/^https?:\/\//i, 'Adresse http(s) attendue') })
      .parse(req.body)
    const existing = await prisma.podcast.findUnique({ where: { feedUrl }, select: { id: true } })
    if (existing) return { id: existing.id }
    try {
      return { id: await refreshFeed(feedUrl) }
    } catch (err) {
      // Opened twice at once: the other request stored it.
      const stored = await prisma.podcast.findUnique({ where: { feedUrl }, select: { id: true } })
      if (stored) return { id: stored.id }
      req.log.info({ feedUrl, err: (err as Error).message }, 'podcast feed rejected')
      return reply.code(422).send({ error: `Impossible de lire ce flux : ${(err as Error).message}` })
    }
  })

  app.get('/podcasts/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params)
    const userId = req.user!.id
    let podcast = await prisma.podcast.findUnique({ where: { id } })
    if (!podcast) return reply.code(404).send({ error: 'Podcast introuvable' })

    const owned = podcast.ownerId === userId
    if (!podcast.ownerId && (!podcast.fetchedAt || Date.now() - podcast.fetchedAt.getTime() > STALE_AFTER_MS)) {
      // Shows what is stored when the publisher is unreachable.
      await refreshFeed(podcast.feedUrl).catch((err: Error) =>
        req.log.warn({ feedUrl: podcast!.feedUrl, err: err.message }, 'podcast refresh failed'),
      )
      podcast = (await prisma.podcast.findUnique({ where: { id } }))!
    }

    // Others only see the videos of a created podcast once downloaded.
    const visible = owned ? { podcastId: id } : { podcastId: id, status: 'ready' as const }
    const [episodes, subscription, total] = await Promise.all([
      prisma.podcastEpisode.findMany({
        where: visible,
        orderBy: { publishedAt: 'desc' },
        take: MAX_EPISODES_LISTED,
        select: episodeSelect,
      }),
      prisma.podcastSubscription.findUnique({ where: { userId_podcastId: { userId, podcastId: id } } }),
      prisma.podcastEpisode.count({ where: visible }),
    ])
    const progress = await progressOf(
      userId,
      episodes.map((e) => e.id),
    )
    return {
      ...podcastSummary(podcast),
      description: podcast.description,
      link: podcast.link,
      feedUrl: podcast.ownerId ? null : podcast.feedUrl,
      owned,
      subscribed: !!subscription,
      episodeCount: total,
      episodes: episodes.map((e) => toEpisode(e, progress.get(e.id))),
    }
  })

  app.get('/podcasts/:id/image', async (req, reply) => {
    const { id } = idParams.parse(req.params)
    const podcast = await prisma.podcast.findUnique({ where: { id }, select: { imageUrl: true } })
    return sendImage(reply, podcast?.imageUrl)
  })

  // The episode's own artwork, or the podcast's.
  app.get('/episodes/:id/image', async (req, reply) => {
    const { id } = idParams.parse(req.params)
    const episode = await prisma.podcastEpisode.findUnique({
      where: { id },
      select: { imageUrl: true, podcast: { select: { imageUrl: true } } },
    })
    return sendImage(reply, episode?.imageUrl ?? episode?.podcast.imageUrl)
  })

  // --- The user's podcasts ---

  app.get('/me/podcasts', async (req) => {
    const subscriptions = await prisma.podcastSubscription.findMany({
      where: { userId: req.user!.id },
      orderBy: { subscribedAt: 'desc' },
      select: { subscribedAt: true, podcast: { select: { id: true, title: true, author: true, imageUrl: true } } },
    })
    return subscriptions.map(({ subscribedAt, podcast }) => ({ ...podcastSummary(podcast), subscribedAt }))
  })

  app.put('/me/podcasts/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params)
    if (!(await prisma.podcast.findUnique({ where: { id }, select: { id: true } }))) {
      return reply.code(404).send({ error: 'Podcast introuvable' })
    }
    await prisma.podcastSubscription.upsert({
      where: { userId_podcastId: { userId: req.user!.id, podcastId: id } },
      create: { userId: req.user!.id, podcastId: id },
      update: {},
    })
    return reply.code(204).send()
  })

  app.delete('/me/podcasts/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params)
    await prisma.podcastSubscription.deleteMany({ where: { userId: req.user!.id, podcastId: id } })
    return reply.code(204).send()
  })

  // New episodes of the user's podcasts that they haven't finished.
  app.get('/me/podcasts/episodes', async (req) => {
    const userId = req.user!.id
    const episodes = await prisma.podcastEpisode.findMany({
      where: {
        podcast: { subscribers: { some: { userId } } },
        progress: { none: { userId, completed: true } },
        status: 'ready',
      },
      orderBy: { publishedAt: 'desc' },
      take: 20,
      select: episodeSelect,
    })
    const progress = await progressOf(
      userId,
      episodes.map((e) => e.id),
    )
    return episodes.map((e) => toEpisode(e, progress.get(e.id)))
  })

  app.put('/me/episodes/:id/progress', async (req, reply) => {
    const { id } = idParams.parse(req.params)
    const { positionSec, completed } = z
      .object({ positionSec: z.number().min(0).max(1e6), completed: z.boolean() })
      .parse(req.body)
    const data = { positionSec: Math.round(positionSec), completed }
    try {
      await prisma.episodeProgress.upsert({
        where: { userId_episodeId: { userId: req.user!.id, episodeId: id } },
        create: { userId: req.user!.id, episodeId: id, ...data },
        update: data,
      })
    } catch {
      return reply.code(404).send({ error: 'Épisode introuvable' })
    }
    return reply.code(204).send()
  })
}
