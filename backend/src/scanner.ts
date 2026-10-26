import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { FastifyBaseLogger } from 'fastify'
import { parseFile } from 'music-metadata'
import { config } from './config.js'
import { prisma } from './db.js'
import { enrichLibrary } from './enrich.js'
import { MIME } from './stream.js'

const COVER_NAMES = ['cover.jpg', 'cover.png', 'folder.jpg']

// Bump when indexing logic changes so existing tracks are re-read.
// 2: read ISRC.
const INDEX_VERSION = 2

export interface ScanStatus {
  running: boolean
  lastStartedAt: Date | null
  lastFinishedAt: Date | null
  lastResult: { added: number; updated: number; removed: number; failed: number } | null
}

export const scanStatus: ScanStatus = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastResult: null,
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile() && path.extname(entry.name).toLowerCase() in MIME) yield full
  }
}

async function findFolderCover(dir: string, root: string): Promise<string | null> {
  const names = new Set(await readdir(dir))
  const name = COVER_NAMES.find((n) => names.has(n))
  return name ? path.relative(root, path.join(dir, name)) : null
}

function fallbackTitle(file: string) {
  return path.basename(file, path.extname(file))
}

// Caches name -> id lookups for the duration of one scan.
function createCatalog() {
  const artists = new Map<string, string>()
  const albums = new Map<string, string>()

  return {
    async artistId(name: string) {
      let id = artists.get(name)
      if (!id) {
        ;({ id } = await prisma.artist.upsert({ where: { name }, create: { name }, update: {} }))
        artists.set(name, id)
      }
      return id
    },
    async albumId(title: string, artistId: string, year: number | null) {
      const key = `${artistId}\u0000${title}`
      let id = albums.get(key)
      if (!id) {
        ;({ id } = await prisma.album.upsert({
          where: { artistId_title: { artistId, title } },
          create: { title, artistId, year },
          update: year ? { year } : {},
        }))
        albums.set(key, id)
      }
      return id
    },
  }
}

// Indexes MUSIC_DIR into the Track table. Unchanged files (same size and
// mtime) are skipped; tracks whose file disappeared are removed.
export async function scanLibrary(log: FastifyBaseLogger): Promise<void> {
  if (scanStatus.running) return
  scanStatus.running = true
  scanStatus.lastStartedAt = new Date()
  const result = { added: 0, updated: 0, removed: 0, failed: 0 }

  try {
    const root = path.resolve(config.MUSIC_DIR)
    const known = new Map(
      (
        await prisma.track.findMany({
          select: { path: true, fileSize: true, fileMtime: true, indexVersion: true },
        })
      ).map((t) => [t.path, t]),
    )
    const seen = new Set<string>()
    const coverCache = new Map<string, string | null>()
    const catalog = createCatalog()

    for await (const file of walk(root)) {
      const rel = path.relative(root, file)
      seen.add(rel)
      try {
        const { size, mtime } = await stat(file)
        const existing = known.get(rel)
        if (
          existing &&
          existing.fileSize === size &&
          existing.fileMtime.getTime() === mtime.getTime() &&
          existing.indexVersion >= INDEX_VERSION
        ) {
          continue
        }

        const dir = path.dirname(file)
        if (!coverCache.has(dir)) coverCache.set(dir, await findFolderCover(dir, root))

        const { common, format } = await parseFile(file, { skipCovers: true })
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
          coverPath: coverCache.get(dir) ?? null,
        }

        await prisma.track.upsert({ where: { path: rel }, create: { path: rel, ...data }, update: data })
        if (existing) result.updated++
        else result.added++
      } catch (err) {
        result.failed++
        log.warn({ err, file: rel }, 'failed to index file')
      }
    }

    const removed = [...known.keys()].filter((p) => !seen.has(p))
    if (removed.length) {
      result.removed = (await prisma.track.deleteMany({ where: { path: { in: removed } } })).count
    }

    // Drop albums and artists left without tracks (e.g. after retagging or deleting files).
    await prisma.album.deleteMany({ where: { tracks: { none: {} } } })
    await prisma.artist.deleteMany({ where: { tracks: { none: {} }, albums: { none: {} } } })

    scanStatus.lastResult = result
    log.info(result, 'library scan finished')
  } catch (err) {
    log.error({ err }, 'library scan failed')
  } finally {
    scanStatus.running = false
    scanStatus.lastFinishedAt = new Date()
  }

  // Covers and pictures for new albums/artists; runs after the scan so the library is usable first.
  await enrichLibrary(log).catch((err) => log.error({ err }, 'Deezer enrichment failed'))
}

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
}
