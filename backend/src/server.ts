import { createReadStream } from 'node:fs'
import path from 'node:path'
import cors from '@fastify/cors'
import Fastify from 'fastify'
import { parseFile, selectCover } from 'music-metadata'
import { z } from 'zod'
import { config } from './config.js'
import { prisma } from './db.js'
import * as deemix from './deemix.js'
import { scanLibrary, scanStatus, scheduleScan, startPeriodicScan } from './scanner.js'
import { resolveMusicPath, streamFile } from './stream.js'

// Wait for deemix to finish downloading before rescanning.
const RESCAN_AFTER_DOWNLOAD_MS = 30_000

const app = Fastify({ logger: true })
await app.register(cors, { origin: config.CORS_ORIGIN })

app.get('/health', async () => ({ ok: true }))

app.get('/search', async (req) => {
  const { q } = z.object({ q: z.string().min(1) }).parse(req.query)
  return deemix.searchTracks(q)
})

app.post('/downloads', async (req, reply) => {
  const { url } = z.object({ url: z.string().url() }).parse(req.body)
  await deemix.addToQueue(url)
  scheduleScan(app.log, RESCAN_AFTER_DOWNLOAD_MS)
  return reply.code(202).send({ queued: true })
})

const trackSelect = {
  id: true,
  title: true,
  artist: true,
  album: true,
  albumArtist: true,
  year: true,
  durationSec: true,
  trackNumber: true,
  discNumber: true,
} as const

app.get('/tracks', async (req) => {
  const { q, limit, offset } = z
    .object({
      q: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .parse(req.query)

  const where = q
    ? {
        OR: (['title', 'artist', 'album'] as const).map((field) => ({
          [field]: { contains: q, mode: 'insensitive' as const },
        })),
      }
    : {}

  const [items, total] = await Promise.all([
    prisma.track.findMany({
      where,
      select: trackSelect,
      orderBy: [{ artist: 'asc' }, { album: 'asc' }, { discNumber: 'asc' }, { trackNumber: 'asc' }],
      take: limit,
      skip: offset,
    }),
    prisma.track.count({ where }),
  ])
  return { items, total }
})

app.get('/tracks/:id', async (req, reply) => {
  const { id } = z.object({ id: z.string() }).parse(req.params)
  const track = await prisma.track.findUnique({ where: { id }, select: trackSelect })
  return track ?? reply.code(404).send({ error: 'Track not found' })
})

app.get('/tracks/:id/stream', async (req, reply) => {
  const { id } = z.object({ id: z.string() }).parse(req.params)
  const track = await prisma.track.findUnique({ where: { id } })
  const file = track && resolveMusicPath(track.path)
  if (!file) return reply.code(404).send({ error: 'Track not found' })
  return streamFile(req, reply, file)
})

app.get('/tracks/:id/cover', async (req, reply) => {
  const { id } = z.object({ id: z.string() }).parse(req.params)
  const track = await prisma.track.findUnique({ where: { id } })
  if (!track) return reply.code(404).send({ error: 'Track not found' })
  reply.header('cache-control', 'public, max-age=86400')

  const folderCover = track.coverPath && resolveMusicPath(track.coverPath)
  if (folderCover) {
    const type = path.extname(folderCover) === '.png' ? 'image/png' : 'image/jpeg'
    return reply.type(type).send(createReadStream(folderCover))
  }

  const file = resolveMusicPath(track.path)
  const cover = file && selectCover((await parseFile(file)).common.picture)
  if (!cover) return reply.code(404).send({ error: 'No cover' })
  return reply.type(cover.format).send(Buffer.from(cover.data))
})

app.get('/library/scan', async () => scanStatus)

app.post('/library/scan', async (_req, reply) => {
  void scanLibrary(app.log)
  return reply.code(202).send({ started: true })
})

try {
  await deemix.login()
} catch (err) {
  app.log.warn({ err }, 'deemix login failed; search and downloads may not work')
}

await app.listen({ port: config.PORT, host: '0.0.0.0' })
startPeriodicScan(app.log)
