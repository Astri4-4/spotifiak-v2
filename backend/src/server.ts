import { createReadStream } from 'node:fs'
import path from 'node:path'
import cors from '@fastify/cors'
import Fastify from 'fastify'
import { parseFile, selectCover } from 'music-metadata'
import { z, ZodError } from 'zod'
import { requireAdmin, setupAuth } from './auth.js'
import { collectionRoutes } from './collection.js'
import { duplicateRoutes } from './duplicates.js'
import { jamRoutes } from './jam.js'
import { spotifyRoutes } from './spotify/routes.js'
import { config } from './config.js'
import { prisma } from './db.js'
import * as deemix from './deemix.js'
import { enrichStatus } from './enrich.js'
import { libraryRoutes } from './library.js'
import { scanLibrary, scanStatus, scheduleScan, startPeriodicScan } from './scanner.js'
import { resolveMusicPath, streamFile } from './stream.js'

// Wait for deemix to finish downloading before rescanning.
const RESCAN_AFTER_DOWNLOAD_MS = 30_000

// trustProxy: the web container's nginx forwards requests; use the client's IP for login rate limiting.
// forceCloseConnections: Jam event streams stay open; don't wait for them on shutdown.
const app = Fastify({ logger: true, trustProxy: true, forceCloseConnections: true })
// The frontend normally calls the API through its own origin (/api); CORS only matters
// for a frontend served elsewhere, e.g. during development without the Vite proxy.
await app.register(cors, { origin: config.CORS_ORIGIN, credentials: true })

app.setErrorHandler((err, req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: err.issues.map((i) => i.message).join(', '), issues: err.issues })
  }
  const { statusCode, message } = err as { statusCode?: number; message?: string }
  // Fastify's own errors (400 bad JSON, 413...) carry a status; anything else is a bug.
  if (statusCode && statusCode < 500) return reply.code(statusCode).send({ error: message })
  req.log.error({ err }, 'request failed')
  return reply.code(500).send({ error: 'Erreur interne' })
})

app.get('/health', async () => ({ ok: true }))

await setupAuth(app)

await app.register(libraryRoutes)
await app.register(collectionRoutes)
await app.register(spotifyRoutes)
await app.register(duplicateRoutes)
await app.register(jamRoutes)

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

app.post('/library/scan', { preHandler: requireAdmin }, async (req, reply) => {
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

// docker stop / Kubernetes send SIGTERM: stop right away instead of being killed after the grace period.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down')
    void app.close().finally(() => process.exit(0))
  })
}
