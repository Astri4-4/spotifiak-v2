import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { FastifyBaseLogger } from 'fastify'
import { parseFile } from 'music-metadata'
import { config } from './config.js'
import { prisma } from './db.js'
import { MIME } from './stream.js'

const COVER_NAMES = ['cover.jpg', 'cover.png', 'folder.jpg']

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
      (await prisma.track.findMany({ select: { path: true, fileSize: true, fileMtime: true } })).map(
        (t) => [t.path, t],
      ),
    )
    const seen = new Set<string>()
    const coverCache = new Map<string, string | null>()

    for await (const file of walk(root)) {
      const rel = path.relative(root, file)
      seen.add(rel)
      try {
        const { size, mtime } = await stat(file)
        const existing = known.get(rel)
        if (existing && existing.fileSize === size && existing.fileMtime.getTime() === mtime.getTime()) {
          continue
        }

        const dir = path.dirname(file)
        if (!coverCache.has(dir)) coverCache.set(dir, await findFolderCover(dir, root))

        const { common, format } = await parseFile(file, { skipCovers: true })
        const data = {
          fileSize: size,
          fileMtime: mtime,
          title: common.title ?? fallbackTitle(file),
          artist: common.artist ?? common.albumartist ?? 'Unknown artist',
          album: common.album ?? null,
          albumArtist: common.albumartist ?? null,
          year: common.year ?? null,
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

    scanStatus.lastResult = result
    log.info(result, 'library scan finished')
  } catch (err) {
    log.error({ err }, 'library scan failed')
  } finally {
    scanStatus.running = false
    scanStatus.lastFinishedAt = new Date()
  }
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
