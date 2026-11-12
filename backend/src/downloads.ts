import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from './db.js'
import * as deemix from './deemix.js'
import type { Download, DownloadStatus } from './generated/prisma/client.js'
import { toTrack, trackSelect } from './library.js'
import { notify } from './push.js'
import { scheduleScan } from './scanner.js'

// Downloads go through deemix, which only says "queued". This follows each one in deemix's
// queue (waiting, downloading with its progress, done, failed), scans the library as soon as it
// is done, finds the tracks it wrote, and then tells whoever asked for it (push notification).

const POLL_MS = 3000
// deemix has just closed its files: give it a moment before scanning.
const SCAN_DELAY_MS = 3000
// A finished download not found in the library after this long is given up on (told anyway).
const FIND_TIMEOUT_MS = 15 * 60_000
// deemix lost an item (restarted without its queue file): failed after this many polls without it.
const MISSING_POLLS = 10
// Search results checked against the library.
const SEARCH_LIMIT = 30

const ACTIVE: DownloadStatus[] = ['queued', 'downloading']
const FINISHED: DownloadStatus[] = ['done', 'partial', 'failed']

// --- Helpers (pure) ---------------------------------------------------------------

const LINK = /deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(track|album|artist|playlist)\/(\d+)/i

export function parseDeezerLink(url: string) {
  const m = LINK.exec(url)
  return m ? { type: m[1].toLowerCase(), id: m[2] } : null
}

/** A download's status from its deemix queue item. */
export function statusOf(item: deemix.QueueItem, current?: deemix.QueueItem): DownloadStatus {
  if (current?.uuid === item.uuid) return 'downloading'
  switch (item.status) {
    case 'completed':
      return 'done'
    case 'withErrors':
      return 'partial'
    case 'failed':
      return 'failed'
    case 'downloading':
      return 'downloading'
    default:
      return 'queued'
  }
}

/** The end of a path deemix wrote, its folder and file name, which the library path also ends with. */
export function pathSuffix(file: string) {
  return file.split(/[\\/]+/).filter(Boolean).slice(-2).join('/')
}

/** What deemix reported as failing, for the downloads list. */
export function errorText(item: deemix.QueueItem): string | null {
  const errors = item.errors ?? []
  if (!errors.length) return item.status === 'failed' ? 'Échec du téléchargement' : null
  const first = errors[0]
  const what = first.data?.title ? `${first.data.title} : ` : ''
  const more = errors.length > 1 ? ` (+${errors.length - 1} autre${errors.length > 2 ? 's' : ''})` : ''
  return `${what}${first.message ?? 'échec'}${more}`
}

/**
 * A title or name for comparing Deezer's with the library's: no accents, case, punctuation,
 * "(feat. …)" or "- Remastered 2011". Remixes, live and other versions stay different.
 */
export function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[([][^)\]]*\b(feat|ft|with|remaster(ed)?)\b[^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+[^-]*\bremaster(ed)?\b.*$/g, '')
    .replace(/\bfeat\.?\s.*$/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Whether a library track is this Deezer track: same title, artist among its artists, same length. */
export function sameTrack(
  local: { title: string; artistName: string; durationSec: number | null },
  deezerTrack: { title: string; artist: string; duration: number },
) {
  if (normalize(local.title) !== normalize(deezerTrack.title)) return false
  // The library's artist tag may list several ("A, B", "A feat. B", "A & B"): one of them, or all of it.
  const artist = normalize(deezerTrack.artist)
  const artists = local.artistName.split(/\s*(?:,|;|\/|&|\bfeat\.?|\bft\.?|\bx\b)\s*/i).map(normalize)
  if (!artist || (!artists.includes(artist) && normalize(local.artistName) !== artist)) return false
  return local.durationSec === null || !deezerTrack.duration || Math.abs(local.durationSec - deezerTrack.duration) <= 3
}

/** The start of a title, before any bracket or dash: what the database can search for. */
const titleStem = (title: string) => title.split(/\s[([-]/)[0].trim()

// --- Starting, retrying, cancelling -------------------------------------------------

function toDownload(d: Download) {
  const { files: _, uuid: __, userId: ___, ...rest } = d
  return rest
}

/** Queues a Deezer link (track, album, or artist: their discography) for a user. */
export async function startDownload(userId: string, url: string, log: FastifyBaseLogger) {
  const link = parseDeezerLink(url)
  let items = await deemix.addToQueue(url)
  if (!items.length && link && (link.type === 'track' || link.type === 'album')) {
    // deemix already has it, waiting or finished earlier: follow it, or download it again.
    const { queue } = await deemix.getQueue()
    const existing = Object.values(queue).find((i) => i.type === link.type && String(i.id) === link.id)
    if (existing) {
      const finished = existing.status === 'completed' || existing.status === 'withErrors' || existing.status === 'failed'
      items = finished ? await deemix.retry(existing.uuid) : [existing]
    }
  }
  if (!items.length) {
    throw Object.assign(new Error(link?.type === 'artist' ? 'deemix a déjà tous ces albums dans sa file' : "deemix n'a rien ajouté à sa file"), {
      statusCode: 409,
    })
  }

  const rows: Download[] = []
  for (const item of items) {
    // Asked twice while it waits: the same download.
    const same = await prisma.download.findFirst({ where: { userId, uuid: item.uuid, status: { in: ACTIVE } } })
    rows.push(
      same ??
        (await prisma.download.create({
          data: {
            userId,
            uuid: item.uuid,
            type: item.type,
            deezerId: String(item.id),
            title: item.title,
            artist: item.artist,
            coverUrl: item.cover ?? null,
            size: item.size ?? 0,
          },
        })),
    )
  }
  track(log)
  return rows.map(toDownload)
}

async function retryDownload(d: Download, log: FastifyBaseLogger) {
  await deemix.retry(d.uuid)
  const row = await prisma.download.update({
    where: { id: d.id },
    data: { status: 'queued', progress: 0, downloaded: 0, failed: 0, error: null, files: [], ready: false, finishedAt: null },
  })
  track(log)
  return toDownload(row)
}

async function removeDownload(d: Download, log: FastifyBaseLogger) {
  await prisma.download.delete({ where: { id: d.id } })
  if (!ACTIVE.includes(d.status)) return
  // Stop it in deemix, unless someone else waits for it too.
  const others = await prisma.download.count({ where: { uuid: d.uuid, status: { in: ACTIVE } } })
  if (!others) await deemix.cancel(d.uuid).catch((err: Error) => log.warn({ err: err.message, uuid: d.uuid }, 'deemix cancel failed'))
}

// --- Following downloads ------------------------------------------------------------

let timer: NodeJS.Timeout | undefined
let trackerLog: FastifyBaseLogger | undefined
const missingPolls = new Map<string, number>()

/** Polls deemix while downloads are on their way (and resumes them after a restart). */
export function track(log: FastifyBaseLogger, delayMs = 0) {
  trackerLog = log
  if (timer) return
  timer = setTimeout(() => {
    timer = undefined
    void tick(log)
  }, delayMs)
  timer.unref()
}

async function tick(log: FastifyBaseLogger) {
  let more = true
  try {
    more = await poll(log)
  } catch (err) {
    // deemix unreachable: keep trying.
    log.warn({ err: (err as Error).message }, 'download tracking failed')
  }
  if (more) track(trackerLog ?? log, POLL_MS)
}

async function poll(log: FastifyBaseLogger) {
  const active = await prisma.download.findMany({ where: { status: { in: ACTIVE } } })
  if (active.length) {
    const { queue, current } = await deemix.getQueue()
    let finished = false
    for (const d of active) {
      const item = queue[d.uuid]
      if (!item) {
        const polls = (missingPolls.get(d.id) ?? 0) + 1
        missingPolls.set(d.id, polls)
        if (polls >= MISSING_POLLS) {
          missingPolls.delete(d.id)
          await finish(d, { status: 'failed', error: 'deemix a perdu ce téléchargement (redémarrage ?)' }, log)
        }
        continue
      }
      missingPolls.delete(d.id)
      const live = current?.uuid === d.uuid ? current : item
      const status = statusOf(item, current)
      const data = {
        status,
        progress: FINISHED.includes(status) ? 100 : Math.round(live.progress ?? 0),
        size: live.size ?? d.size,
        downloaded: live.downloaded ?? d.downloaded,
        failed: live.failed ?? d.failed,
      }
      if (FINISHED.includes(status)) {
        finished = true
        const files = (item.files ?? []).flatMap((f) => (f.path ? [f.path] : []))
        await finish(d, { ...data, error: errorText(item), files }, log)
      } else if (data.status !== d.status || data.progress !== d.progress || data.downloaded !== d.downloaded || data.size !== d.size) {
        await prisma.download.update({ where: { id: d.id }, data })
      }
    }
    if (finished) scheduleScan(log, SCAN_DELAY_MS)
  }

  for (const d of await prisma.download.findMany({ where: { status: { in: ['done', 'partial'] }, ready: false } })) {
    await findInLibrary(d, log)
  }

  // Keep going while something downloads or waits to be found in the library.
  const pending = await prisma.download.count({
    where: { OR: [{ status: { in: ACTIVE } }, { status: { in: ['done', 'partial'] }, ready: false }] },
  })
  return pending > 0
}

async function finish(d: Download, data: Partial<Download> & { status: DownloadStatus }, log: FastifyBaseLogger) {
  const failed = data.status === 'failed'
  const row = await prisma.download.update({ where: { id: d.id }, data: { ...data, finishedAt: new Date(), ready: failed } })
  if (failed) notify([d.userId], { title: 'Échec du téléchargement', body: `${d.title} — ${d.artist}`, link: 'downloads' }, log)
  return row
}

/** Looks for a finished download's tracks in the library; once found (or after a while), tells its owner. */
async function findInLibrary(d: Download, log: FastifyBaseLogger) {
  const suffixes = [...new Set(d.files.map(pathSuffix).filter(Boolean))]
  const tracks = suffixes.length
    ? await prisma.track.findMany({
        where: { OR: suffixes.flatMap((s) => [{ path: s }, { path: { endsWith: `/${s}` } }]) },
        select: { id: true, albumId: true },
      })
    : []
  const waited = Date.now() - (d.finishedAt?.getTime() ?? 0)
  if (tracks.length < suffixes.length && waited < FIND_TIMEOUT_MS) return

  const albumCounts = new Map<string, number>()
  for (const t of tracks) if (t.albumId) albumCounts.set(t.albumId, (albumCounts.get(t.albumId) ?? 0) + 1)
  const albumId = [...albumCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const trackId = d.type === 'track' ? (tracks[0]?.id ?? null) : null
  await prisma.download.update({ where: { id: d.id }, data: { ready: true, albumId, trackId } })

  const body =
    d.status === 'partial'
      ? `${d.title} — ${d.artist} : ${d.downloaded} titre${d.downloaded > 1 ? 's' : ''} sur ${d.size}`
      : `${d.title} — ${d.artist} est prêt à écouter`
  notify([d.userId], { title: 'Téléchargement terminé', body, link: albumId ? `album/${albumId}` : 'downloads' }, log)
}

// --- Search, with what is already in the library -----------------------------------

async function userDownloads(userId: string, type: string, deezerIds: string[]) {
  const rows = await prisma.download.findMany({
    where: { userId, type, deezerId: { in: deezerIds } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, deezerId: true, status: true, progress: true },
  })
  const latest = new Map<string, (typeof rows)[number]>()
  for (const r of rows) if (!latest.has(r.deezerId)) latest.set(r.deezerId, r)
  return (id: number) => {
    const r = latest.get(String(id))
    return r ? { id: r.id, status: r.status, progress: r.progress } : null
  }
}

async function searchTracks(userId: string, q: string) {
  return annotateTracks(userId, await deemix.search<deemix.DeezerTrack>(q, 'track', SEARCH_LIMIT))
}

/** Deezer tracks with the same track in the library, if any, and the user's latest download of each. */
export async function annotateTracks(userId: string, results: deemix.DeezerTrack[]) {
  const stems = [...new Set(results.map((r) => titleStem(r.title)).filter(Boolean))]
  const candidates = stems.length
    ? await prisma.track.findMany({
        where: { OR: stems.map((s) => ({ title: { contains: s, mode: 'insensitive' as const } })) },
        select: trackSelect,
        take: 500,
      })
    : []
  const download = await userDownloads(userId, 'track', results.map((r) => String(r.id)))
  return results.map((r) => {
    const local = candidates.find((t) => sameTrack(t, { title: r.title, artist: r.artist.name, duration: r.duration }))
    return { ...r, libraryTrack: local ? toTrack(local) : null, download: download(r.id) }
  })
}

async function searchAlbums(userId: string, q: string) {
  const results = await deemix.search<deemix.DeezerAlbum>(q, 'album', SEARCH_LIMIT)
  const stems = [...new Set(results.map((r) => titleStem(r.title)).filter(Boolean))]
  const candidates = await prisma.album.findMany({
    where: {
      OR: [
        { deezerId: { in: results.map((r) => r.id) } },
        ...stems.map((s) => ({ title: { contains: s, mode: 'insensitive' as const } })),
      ],
    },
    select: { id: true, title: true, deezerId: true, artist: { select: { name: true } } },
    take: 500,
  })
  const download = await userDownloads(userId, 'album', results.map((r) => String(r.id)))
  return results.map((r) => {
    const local =
      candidates.find((a) => a.deezerId === r.id) ??
      candidates.find((a) => normalize(a.title) === normalize(r.title) && normalize(a.artist.name) === normalize(r.artist.name))
    return { ...r, libraryAlbumId: local?.id ?? null, download: download(r.id) }
  })
}

async function searchArtists(q: string) {
  const results = await deemix.search<deemix.DeezerArtist>(q, 'artist', SEARCH_LIMIT)
  const candidates = await prisma.artist.findMany({
    where: {
      OR: [
        { deezerId: { in: results.map((r) => r.id) } },
        ...results.map((r) => ({ name: { equals: r.name, mode: 'insensitive' as const } })),
      ],
    },
    select: { id: true, name: true, deezerId: true },
  })
  return results.map((r) => {
    const local = candidates.find((a) => a.deezerId === r.id) ?? candidates.find((a) => normalize(a.name) === normalize(r.name))
    return { ...r, libraryArtistId: local?.id ?? null }
  })
}

// --- Routes ---------------------------------------------------------------------------

export async function downloadRoutes(app: FastifyInstance) {
  app.get('/deezer/search', async (req, reply) => {
    const { q, type } = z
      .object({ q: z.string().min(1), type: z.enum(['track', 'album', 'artist']).default('track') })
      .parse(req.query)
    const userId = req.user!.id
    try {
      if (type === 'album') return await searchAlbums(userId, q)
      if (type === 'artist') return await searchArtists(q)
      return await searchTracks(userId, q)
    } catch (err) {
      req.log.warn({ err }, 'deemix search failed')
      return reply.code(502).send({ error: 'deemix unreachable' })
    }
  })

  // A Deezer link: track, album, or artist (their whole discography, one download per album).
  app.post('/downloads', async (req, reply) => {
    const { url } = z.object({ url: z.string().url() }).parse(req.body)
    try {
      const downloads = await startDownload(req.user!.id, url, req.log)
      return reply.code(202).send({ queued: true, downloads })
    } catch (err) {
      const { statusCode, message } = err as { statusCode?: number; message: string }
      if (statusCode === 409) return reply.code(409).send({ error: message })
      req.log.warn({ err: message, url }, 'deemix download failed')
      return reply.code(502).send({ error: message })
    }
  })

  app.get('/me/downloads', async (req) => {
    const rows = await prisma.download.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 200 })
    return rows.map(toDownload)
  })

  const own = async (req: { user: { id: string } | null; params: unknown }) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    return prisma.download.findFirst({ where: { id, userId: req.user!.id } })
  }

  app.post('/me/downloads/:id/retry', async (req, reply) => {
    const d = await own(req)
    if (!d) return reply.code(404).send({ error: 'Téléchargement introuvable' })
    try {
      return await retryDownload(d, req.log)
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message })
    }
  })

  // Cancels it when it hasn't finished, and removes it from the list.
  app.delete('/me/downloads/:id', async (req, reply) => {
    const d = await own(req)
    if (d) await removeDownload(d, req.log)
    return reply.code(204).send()
  })

  // "Effacer les terminés"
  app.delete('/me/downloads', async (req, reply) => {
    await prisma.download.deleteMany({ where: { userId: req.user!.id, status: { in: FINISHED } } })
    return reply.code(204).send()
  })
}
