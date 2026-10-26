import { createReadStream } from 'node:fs'
import path from 'node:path'
import cors from '@fastify/cors'
import Fastify from 'fastify'
import { parseFile, selectCover } from 'music-metadata'
import { z } from 'zod'
import { config } from './config.js'
import { prisma } from './db.js'
import * as deemix from './deemix.js'
import { enrichStatus } from './enrich.js'
import { libraryRoutes } from './library.js'
import { scanLibrary, scanStatus, scheduleScan, startPeriodicScan } from './scanner.js'
import { resolveMusicPath, streamFile } from './stream.js'

// Wait for deemix to finish downloading before rescanning.
const RESCAN_AFTER_DOWNLOAD_MS = 30_000

const app = Fastify({ logger: true })
await app.register(cors, { origin: config.CORS_ORIGIN })

app.get('/health', async () => ({ ok: true }))

await app.register(libraryRoutes)

app.get('/deezer/search', async (req, reply) => {
  const { q } = z.object({ q: z.string().min(1) }).parse(req.query)
  try {
    return await deemix.searchTracks(q)
  } catch (err) {
    req.log.warn({ err }, 'deemix search failed')
    return reply.code(502).send({ error: 'deemix unreachable' })
  }
})

app.post('/downloads', async (req, reply) => {
  const { url } = z.object({ url: z.string().url() }).parse(req.body)
  await deemix.addToQueue(url)
  scheduleScan(app.log, RESCAN_AFTER_DOWNLOAD_MS)
  return reply.code(202).send({ queued: true })
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

  // Embedded art first: it belongs to this file, whereas a folder cover.jpg may be
  // shared by unrelated albums when downloads land in the same directory.
  const file = resolveMusicPath(track.path)
  const embedded = file && selectCover((await parseFile(file)).common.picture)
  if (embedded) return reply.type(embedded.format).send(Buffer.from(embedded.data))

  const folderCover = track.coverPath && resolveMusicPath(track.coverPath)
  if (!folderCover) return reply.code(404).send({ error: 'No cover' })
  const type = path.extname(folderCover) === '.png' ? 'image/png' : 'image/jpeg'
  return reply.type(type).send(createReadStream(folderCover))
})

app.get('/library/scan', async () => ({ ...scanStatus, enrichment: enrichStatus }))

app.post('/library/scan', async (req, reply) => {
  const { full } = z.object({ full: z.enum(['true', 'false']).optional() }).parse(req.query)
  if (scanStatus.running) return reply.code(409).send({ error: 'A scan is already running' })
  void scanLibrary(app.log, full === 'true' ? 'full' : 'quick')
  return reply.code(202).send({ started: true })
})

try {
  await deemix.login()
} catch (err) {
  app.log.warn({ err }, 'deemix login failed; search and downloads may not work')
}

await app.listen({ port: config.PORT, host: '0.0.0.0' })
startPeriodicScan(app.log)
