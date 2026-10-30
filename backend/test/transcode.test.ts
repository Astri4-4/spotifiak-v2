import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, test } from 'node:test'

// config.ts parses the environment on import: give it what it requires.
process.env.DATABASE_URL ??= 'postgresql://test@localhost/test'
process.env.DEEMIX_URL ??= 'http://localhost:6595'
process.env.MUSIC_DIR ??= '/music'
const { compatFile, conversionCount, pruneTranscodes } = await import('../src/transcode.js')

let fixtures: string
let ogg: string
let mp3: string
let dir: string
let startCount: number

const sine = (out: string, ...codec: string[]) =>
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', ...codec, out])

const probeCodec = (file: string) =>
  execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file]).toString().trim()

before(async () => {
  fixtures = await mkdtemp(path.join(tmpdir(), 'transcode-fixtures-'))
  ogg = path.join(fixtures, 'song.ogg')
  mp3 = path.join(fixtures, 'song.mp3')
  sine(ogg, '-c:a', 'libvorbis')
  sine(mp3)
})

after(() => rm(fixtures, { recursive: true, force: true }))

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'transcode-'))
  startCount = conversionCount()
})

test('serves compatible files untouched', async () => {
  assert.equal(await compatFile(mp3, 't1', dir), mp3)
  assert.equal(conversionCount(), startCount)
})

test('converts ogg to AAC m4a once', async () => {
  const out = await compatFile(ogg, 't2', dir)
  assert.equal(out, path.join(dir, 't2.m4a'))
  assert.equal(probeCodec(out), 'aac')
  await compatFile(ogg, 't2', dir)
  assert.equal(conversionCount(), startCount + 1)
})

test('concurrent requests share one conversion', async () => {
  const [a, b] = await Promise.all([compatFile(ogg, 't3', dir), compatFile(ogg, 't3', dir)])
  assert.equal(a, b)
  assert.equal(conversionCount(), startCount + 1)
})

test('reconverts when the source is newer than the cache', async () => {
  await compatFile(ogg, 't4', dir)
  await utimes(ogg, new Date(), new Date(Date.now() + 60_000))
  await compatFile(ogg, 't4', dir)
  assert.equal(conversionCount(), startCount + 2)
})

test('rejects on a corrupt file, leaves no .part, retries next time', async () => {
  const bad = path.join(dir, 'bad.ogg')
  await writeFile(bad, 'not audio')
  await assert.rejects(compatFile(bad, 't5', dir))
  assert.deepEqual((await readdir(dir)).filter((f) => f.startsWith('t5')), [])
  await assert.rejects(compatFile(bad, 't5', dir))
  assert.equal(conversionCount(), startCount + 2)
})

test('prunes unknown ids and leftover parts', async () => {
  await Promise.all(['keep.m4a', 'gone.m4a', 'x.m4a.part'].map((f) => writeFile(path.join(dir, f), '')))
  assert.equal(await pruneTranscodes(new Set(['keep']), dir), 2)
  assert.deepEqual(await readdir(dir), ['keep.m4a'])
})
