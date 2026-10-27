import { unlink } from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from './auth.js'
import { prisma } from './db.js'
import { normalize } from './enrich.js'
import { scanStatus } from './scanner.js'
import { resolveMusicPath } from './stream.js'

// Same recording encoded twice differs by a second or two; a live or extended
// version with the same title is much further apart.
const DURATION_TOLERANCE_SEC = 3
const LOSSLESS = new Set(['.flac'])

const copySelect = {
  id: true,
  title: true,
  artistName: true,
  album: { select: { id: true, title: true } },
  durationSec: true,
  path: true,
  fileSize: true,
  createdAt: true,
} as const

type Copy = Awaited<ReturnType<typeof loadTracks>>[number]

const loadTracks = () => prisma.track.findMany({ select: copySelect })

const kbps = (t: Copy) => (t.durationSec ? Math.round((t.fileSize * 8) / t.durationSec / 1000) : null)

/** Lossless first, then the highest bitrate, then a file with an album, then the oldest. */
function better(a: Copy, b: Copy) {
  const lossless = (t: Copy) => (LOSSLESS.has(path.extname(t.path).toLowerCase()) ? 1 : 0)
  return (
    lossless(b) - lossless(a) ||
    (kbps(b) ?? 0) - (kbps(a) ?? 0) ||
    (b.album ? 1 : 0) - (a.album ? 1 : 0) ||
    a.createdAt.getTime() - b.createdAt.getTime()
  )
}

/** Groups of tracks with the same artist and title and about the same duration, best copy first. */
async function findDuplicates() {
  const byName = new Map<string, Copy[]>()
  for (const t of await loadTracks()) {
    const key = `${normalize(t.artistName)}|${normalize(t.title)}`
    byName.set(key, [...(byName.get(key) ?? []), t])
  }

  const groups: Copy[][] = []
  for (const tracks of byName.values()) {
    if (tracks.length < 2) continue
    // Unknown durations can't be told apart: they join the first cluster.
    tracks.sort((a, b) => (a.durationSec ?? -1) - (b.durationSec ?? -1))
    let cluster: Copy[] = []
    for (const t of tracks) {
      const last = cluster.at(-1)
      if (last?.durationSec != null && t.durationSec != null && t.durationSec - last.durationSec > DURATION_TOLERANCE_SEC) {
        if (cluster.length > 1) groups.push(cluster)
        cluster = []
      }
      cluster.push(t)
    }
    if (cluster.length > 1) groups.push(cluster)
  }
  return groups.map((g) => g.sort(better))
}

/** Moves likes, playlist entries and history to the kept copy, then deletes the file and the track. */
async function removeCopy(removeId: string, keepId: string, file: string) {
  await prisma.$transaction(async (tx) => {
    const likes = await tx.like.findMany({ where: { trackId: removeId } })
    await tx.like.createMany({ data: likes.map((l) => ({ ...l, trackId: keepId })), skipDuplicates: true })
    await tx.playlistTrack.updateMany({ where: { trackId: removeId }, data: { trackId: keepId } })
    await tx.play.updateMany({ where: { trackId: removeId }, data: { trackId: keepId } })
    await tx.spotifyImportTrack.updateMany({ where: { trackId: removeId }, data: { trackId: keepId } })
  })
  try {
    await unlink(file)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  await prisma.track.delete({ where: { id: removeId } })
}

export async function duplicateRoutes(app: FastifyInstance) {
  app.get('/library/duplicates', { preHandler: requireAdmin }, async () => {
    const groups = await findDuplicates()
    return groups.map((tracks) => ({
      tracks: tracks.map((t) => ({
        id: t.id,
        title: t.title,
        artistName: t.artistName,
        album: t.album,
        durationSec: t.durationSec,
        path: t.path,
        fileSize: t.fileSize,
        format: path.extname(t.path).slice(1).toUpperCase(),
        bitrateKbps: kbps(t),
      })),
    }))
  })

  app.post('/library/duplicates/resolve', { preHandler: requireAdmin }, async (req, reply) => {
    const { groups } = z
      .object({ groups: z.array(z.object({ keepId: z.string(), removeIds: z.array(z.string()).min(1) })).min(1) })
      .parse(req.body)
    if (scanStatus.running) return reply.code(409).send({ error: 'Un scan est en cours, réessayez après' })

    // Only delete tracks that are still duplicates of the kept one.
    const groupOf = new Map<string, Copy[]>()
    for (const g of await findDuplicates()) for (const t of g) groupOf.set(t.id, g)

    let removed = 0
    const failed: { path: string; error: string }[] = []
    for (const { keepId, removeIds } of groups) {
      const group = groupOf.get(keepId)
      for (const id of removeIds) {
        const copy = group?.find((t) => t.id === id && id !== keepId)
        if (!copy) {
          failed.push({ path: id, error: "N'est plus un doublon" })
          continue
        }
        const file = resolveMusicPath(copy.path)
        try {
          if (!file) throw new Error('Chemin invalide')
          await removeCopy(id, keepId, file)
          removed++
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code
          const error =
            code === 'EROFS' || code === 'EACCES' || code === 'EPERM'
              ? 'Fichier non supprimable (bibliothèque montée en lecture seule ?)'
              : (err as Error).message
          req.log.warn({ err, path: copy.path }, 'duplicate removal failed')
          failed.push({ path: copy.path, error })
        }
      }
    }

    if (removed) {
      await prisma.album.deleteMany({ where: { tracks: { none: {} } } })
      await prisma.artist.deleteMany({ where: { tracks: { none: {} }, albums: { none: {} } } })
    }
    return { removed, failed }
  })
}
