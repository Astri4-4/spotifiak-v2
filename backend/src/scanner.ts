import { open, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { FastifyBaseLogger } from 'fastify'
import { parseBuffer, parseFile, type IAudioMetadata } from 'music-metadata'
import { config } from './config.js'
import { prisma } from './db.js'
import { enrichLibrary } from './enrich.js'
import { resolvePendingImports } from './spotify/importer.js'
import { MIME } from './stream.js'
import { pruneTranscodes } from './transcode.js'

const COVER_NAMES = ['cover.jpg', 'cover.png', 'folder.jpg']

// Bump when indexing logic changes so existing tracks are re-read.
// 2: read ISRC.
const INDEX_VERSION = 2

// Libraries usually live on network shares (SMB/NFS), where every file operation
// is a round trip. Measured on SMB over VPN: throughput stops improving past ~16
// concurrent files, and listing directories is cheap compared to stat-ing files.
const FILE_CONCURRENCY = 16
const DIR_CONCURRENCY = 8
// Tags sit at the start of the file; one read usually covers them (embedded covers
// make ID3 tags ~120 KB). Larger tags get a second read, see readTags().
const PREFIX_BYTES = 160 * 1024
// Bytes of audio after the tag, enough for the MPEG frame and Xing/VBRI headers.
const AUDIO_HEADER_BYTES = 16 * 1024
// A file this recent may still be being written by deemix: re-check it on quick scans.
const SETTLE_MS = 10 * 60 * 1000

export type ScanMode = 'quick' | 'full'

interface ScanResult {
  added: number
  updated: number
  removed: number
  failed: number
  /** Audio files found, and how many of them had to be checked. */
  files: number
  checked: number
}

export interface ScanStatus {
  running: boolean
  mode: ScanMode | null
  phase: 'listing' | 'indexing' | 'cleanup' | null
  dirsListed: number
  /** Files to (re)index in the current scan, and how many are done. */
  progress: { done: number; total: number; startedAt: Date } | null
  lastStartedAt: Date | null
  lastFinishedAt: Date | null
  lastDurationMs: number | null
  lastMode: ScanMode | null
  lastResult: ScanResult | null
  lastError: string | null
}

export const scanStatus: ScanStatus = {
  running: false,
  mode: null,
  phase: null,
  dirsListed: 0,
  progress: null,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastDurationMs: null,
  lastMode: null,
  lastResult: null,
  lastError: null,
}

/** Runs `fn` over `items` with at most `limit` calls in flight. */
async function forEachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

interface DirListing {
  rel: string
  audio: string[]
  cover: string | null
}

/**
 * Lists every directory under root. Directories that can't be read are reported
 * separately so their tracks aren't mistaken for deleted files.
 */
async function listLibrary(root: string, log: FastifyBaseLogger) {
  const listings: DirListing[] = []
  const unreadable: string[] = []
  let queue = ['']

  // The root must be readable: if the share is gone, abort instead of deleting everything.
  await readdir(root)

  while (queue.length) {
    const level = queue
    queue = []
    await forEachLimit(level, DIR_CONCURRENCY, async (rel) => {
      try {
        const entries = await readdir(path.join(root, rel), { withFileTypes: true })
        scanStatus.dirsListed++
        const names = new Set(entries.map((e) => e.name))
        const cover = COVER_NAMES.find((n) => names.has(n))
        listings.push({
          rel,
          audio: entries
            .filter((e) => e.isFile() && !e.name.startsWith('.') && path.extname(e.name).toLowerCase() in MIME)
            .map((e) => e.name),
          cover: cover ? path.join(rel, cover) : null,
        })
        for (const e of entries) {
          if (e.isDirectory() && !e.name.startsWith('.')) queue.push(path.join(rel, e.name))
        }
      } catch (err) {
        unreadable.push(rel)
        log.warn({ err, dir: rel }, 'cannot read directory, keeping its tracks')
      }
    })
  }
  return { listings, unreadable }
}

function syncsafe(buf: Buffer, offset: number) {
  return ((buf[offset] & 0x7f) << 21) | ((buf[offset + 1] & 0x7f) << 14) | ((buf[offset + 2] & 0x7f) << 7) | (buf[offset + 3] & 0x7f)
}

/**
 * Reads tags and duration with as few reads as possible: the file's start in one
 * read, parsed in memory. Falls back to music-metadata's own file reader when the
 * prefix isn't enough (unusual containers, tags without a duration).
 */
async function readTags(file: string, size: number): Promise<IAudioMetadata> {
  const options = { skipCovers: true, duration: false, skipPostHeaders: true }
  const fh = await open(file)
  try {
    let buf = Buffer.alloc(Math.min(size, PREFIX_BYTES))
    let length = (await fh.read(buf, 0, buf.length, 0)).bytesRead

    // ID3v2 tag larger than the prefix (big embedded cover): read the rest of it.
    if (length >= 10 && buf.toString('latin1', 0, 3) === 'ID3') {
      const needed = Math.min(size, 10 + syncsafe(buf, 6) + AUDIO_HEADER_BYTES)
      if (needed > length) {
        const bigger = Buffer.alloc(needed)
        buf.copy(bigger, 0, 0, length)
        length += (await fh.read(bigger, length, needed - length, length)).bytesRead
        buf = bigger
      }
    }

    const mimeType = MIME[path.extname(file).toLowerCase()]
    const metadata = await parseBuffer(buf.subarray(0, length), { mimeType, size }, options)
    if (metadata.format.duration) return metadata
  } catch {
    // Truncated structures in the prefix; the full reader below handles them.
  } finally {
    await fh.close()
  }
  return parseFile(file, { skipCovers: true })
}

function fallbackTitle(file: string) {
  return path.basename(file, path.extname(file))
}

/**
 * Name -> id lookups for one scan. Promises are cached (not ids) so concurrent
 * files of the same album share one upsert instead of racing on the unique key.
 */
function createCatalog() {
  const artists = new Map<string, Promise<string>>()
  const albums = new Map<string, Promise<string>>()

  const memo = (cache: Map<string, Promise<string>>, key: string, load: () => Promise<string>) => {
    let id = cache.get(key)
    if (!id) {
      id = load()
      cache.set(key, id)
      id.catch(() => cache.delete(key))
    }
    return id
  }

  return {
    artistId: (name: string) =>
      memo(artists, name, async () => (await prisma.artist.upsert({ where: { name }, create: { name }, update: {} })).id),
    albumId: (title: string, artistId: string, year: number | null) =>
      memo(
        albums,
        `${artistId}\u0000${title}`,
        async () =>
          (
            await prisma.album.upsert({
              where: { artistId_title: { artistId, title } },
              create: { title, artistId, year },
              update: year ? { year } : {},
            })
          ).id,
      ),
  }
}

interface Known {
  fileSize: number
  fileMtime: Date
  indexVersion: number
}

/**
 * Indexes MUSIC_DIR into the Track table.
 *
 * quick: lists directories and compares file names with the database; only new
 *   files, recently written files and files indexed by an older scanner are read.
 *   This catches deemix downloads and deletions without touching every file.
 * full: also stats every known file to catch files modified in place.
 */
export async function scanLibrary(log: FastifyBaseLogger, mode: ScanMode = 'quick'): Promise<void> {
  if (scanStatus.running) {
    // Files may have appeared after this scan listed their directory: look again when it ends.
    rerunRequested = true
    return
  }
  const startedAt = Date.now()
  Object.assign(scanStatus, {
    running: true,
    mode,
    phase: 'listing',
    dirsListed: 0,
    progress: null,
    lastStartedAt: new Date(startedAt),
  })
  const result: ScanResult = { added: 0, updated: 0, removed: 0, failed: 0, files: 0, checked: 0 }

  try {
    const root = path.resolve(config.MUSIC_DIR)
    const known = new Map<string, Known>(
      (
        await prisma.track.findMany({
          select: { path: true, fileSize: true, fileMtime: true, indexVersion: true },
        })
      ).map((t) => [t.path, t]),
    )

    const { listings, unreadable } = await listLibrary(root, log)

    const seen = new Set<string>()
    const candidates: { rel: string; existing: Known | undefined; cover: string | null }[] = []
    for (const dir of listings) {
      for (const name of dir.audio) {
        const rel = path.join(dir.rel, name)
        seen.add(rel)
        const existing = known.get(rel)
        const mustCheck =
          !existing ||
          mode === 'full' ||
          existing.indexVersion < INDEX_VERSION ||
          startedAt - existing.fileMtime.getTime() < SETTLE_MS
        if (mustCheck) candidates.push({ rel, existing, cover: dir.cover })
      }
    }

    result.files = seen.size
    result.checked = candidates.length
    scanStatus.phase = 'indexing'
    scanStatus.progress = { done: 0, total: candidates.length, startedAt: new Date() }
    const catalog = createCatalog()

    await forEachLimit(candidates, FILE_CONCURRENCY, async ({ rel, existing, cover }) => {
      const file = path.join(root, rel)
      try {
        const { size, mtime } = await stat(file)
        if (
          existing &&
          existing.fileSize === size &&
          existing.fileMtime.getTime() === mtime.getTime() &&
          existing.indexVersion >= INDEX_VERSION
        ) {
          return
        }

        const { common, format } = await readTags(file, size)
        // deemix writes one tag value per artist, so artists[0] is the main one.
        const primaryArtist = common.artists?.[0] ?? common.artist ?? common.albumartist ?? 'Artiste inconnu'
        const artistId = await catalog.artistId(primaryArtist)
        const albumId = common.album
          ? await catalog.albumId(
              common.album,
              common.albumartist ? await catalog.artistId(common.albumartist) : artistId,
              common.year ?? null,
            )
          : null

        const data = {
          fileSize: size,
          fileMtime: mtime,
          indexVersion: INDEX_VERSION,
          title: common.title ?? fallbackTitle(file),
          isrc: common.isrc?.[0]?.trim().toUpperCase() || null,
          artistName: common.artists?.join(', ') ?? common.artist ?? primaryArtist,
          artistId,
          albumId,
          durationSec: format.duration ? Math.round(format.duration) : null,
          trackNumber: common.track.no,
          discNumber: common.disk.no,
          coverPath: cover,
        }

        await prisma.track.upsert({ where: { path: rel }, create: { path: rel, ...data }, update: data })
        if (existing) result.updated++
        else result.added++
      } catch (err) {
        result.failed++
        log.warn({ err, file: rel }, 'failed to index file')
      } finally {
        scanStatus.progress!.done++
      }
    })

    scanStatus.phase = 'cleanup'
    // Never treat files under an unreadable directory as deleted.
    const isUnderUnreadable = (rel: string) =>
      unreadable.some((dir) => dir === '' || rel === dir || rel.startsWith(dir + path.sep))
    const removed = [...known.keys()].filter((p) => !seen.has(p) && !isUnderUnreadable(p))

    // An empty listing while the database has tracks means the share isn't mounted.
    if (removed.length && seen.size === 0) {
      log.error({ known: known.size }, 'music directory looks empty, not removing any track')
    } else if (removed.length) {
      result.removed = (await prisma.track.deleteMany({ where: { path: { in: removed } } })).count
    }

    // Drop albums and artists left without tracks (e.g. after retagging or deleting files).
    await prisma.album.deleteMany({ where: { tracks: { none: {} } } })
    await prisma.artist.deleteMany({ where: { tracks: { none: {} }, albums: { none: {} } } })

    // Converted copies of tracks and episodes that no longer exist.
    const [trackIds, episodeIds] = await Promise.all([
      prisma.track.findMany({ select: { id: true } }),
      prisma.podcastEpisode.findMany({ where: { filePath: { not: null } }, select: { id: true } }),
    ])
    await pruneTranscodes(new Set([...trackIds, ...episodeIds].map((r) => r.id)))

    scanStatus.lastResult = result
    scanStatus.lastError = null
    log.info({ ...result, mode, durationMs: Date.now() - startedAt }, 'library scan finished')
  } catch (err) {
    scanStatus.lastError = (err as Error).message
    log.error({ err }, 'library scan failed')
  } finally {
    Object.assign(scanStatus, {
      running: false,
      phase: null,
      lastMode: mode,
      lastDurationMs: Date.now() - startedAt,
      lastFinishedAt: new Date(),
    })
  }

  if (rerunRequested) {
    rerunRequested = false
    void scanLibrary(log)
  }

  // Spotify imports waiting for deemix downloads: link the files that just arrived.
  await resolvePendingImports(log).catch((err) => log.error({ err }, 'resolving Spotify imports failed'))

  // Covers and pictures for new albums/artists; runs after the scan so the library is usable first.
  await enrichLibrary(log).catch((err) => log.error({ err }, 'Deezer enrichment failed'))
}

let rerunRequested = false
let pending: NodeJS.Timeout | undefined

// Debounced scan, used after queuing a download so new files show up
// without waiting for the next periodic scan.
export function scheduleScan(log: FastifyBaseLogger, delayMs: number) {
  clearTimeout(pending)
  pending = setTimeout(() => void scanLibrary(log), delayMs)
}

export function startPeriodicScan(log: FastifyBaseLogger) {
  void scanLibrary(log)
  if (config.SCAN_INTERVAL_SEC > 0) {
    setInterval(() => void scanLibrary(log), config.SCAN_INTERVAL_SEC * 1000).unref()
  }
  if (config.FULL_SCAN_INTERVAL_HOURS > 0) {
    setInterval(() => void scanLibrary(log, 'full'), config.FULL_SCAN_INTERVAL_HOURS * 3600 * 1000).unref()
  }
}
