import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import Fastify from 'fastify'

const work = await mkdtemp(path.join(tmpdir(), 'stream-'))
// config.ts parses the environment on import: give it what it requires.
process.env.DATABASE_URL ??= 'postgresql://test@localhost/test'
process.env.DEEMIX_URL ??= 'http://localhost:6595'
process.env.MUSIC_DIR ??= '/music'
process.env.TRANSCODE_DIR = path.join(work, 'cache')
const { audioQuery, streamAudio } = await import('../src/stream.js')

const ogg = path.join(work, 'song.ogg')
const app = Fastify()
app.get('/audio', (req, reply) => streamAudio(req, reply, ogg, 'song', audioQuery.parse(req.query).compat))

before(() => {
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libvorbis', ogg])
})
after(async () => {
  await app.close()
  await rm(work, { recursive: true, force: true })
})

test('compat=1 serves AAC with range support', async () => {
  const res = await app.inject({ url: '/audio?compat=1', headers: { range: 'bytes=0-99' } })
  assert.equal(res.statusCode, 206)
  assert.equal(res.headers['content-type'], 'audio/mp4')
  assert.equal(res.rawPayload.length, 100)
})

test('without compat the original file is served', async () => {
  const res = await app.inject({ url: '/audio' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'audio/ogg')
})

test('compat=0 is not compat', async () => {
  const res = await app.inject({ url: '/audio?compat=0' })
  assert.equal(res.headers['content-type'], 'audio/ogg')
})
