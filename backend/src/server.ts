import cors from '@fastify/cors'
import Fastify from 'fastify'
import { z } from 'zod'
import { config } from './config.js'
import { prisma } from './db.js'
import * as deemix from './deemix.js'
import { resolveMusicPath, streamFile } from './stream.js'

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
  return reply.code(202).send({ queued: true })
})

app.get('/tracks/:id/stream', async (req, reply) => {
  const { id } = z.object({ id: z.string() }).parse(req.params)
  const track = await prisma.track.findUnique({ where: { id } })
  const file = track && resolveMusicPath(track.path)
  if (!file) return reply.code(404).send({ error: 'Track not found' })
  return streamFile(req, reply, file)
})

try {
  await deemix.login()
} catch (err) {
  app.log.warn({ err }, 'deemix login failed; search and downloads may not work')
}

await app.listen({ port: config.PORT, host: '0.0.0.0' })
