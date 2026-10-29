import assert from 'node:assert/strict'
import { test } from 'node:test'

// config.ts parses the environment on import: give it what it requires.
process.env.DATABASE_URL ??= 'postgresql://test@localhost/test'
process.env.DEEMIX_URL ??= 'http://localhost:6595'
process.env.MUSIC_DIR ??= '/music'
const { toTrack } = await import('../src/library.js')

test('toTrack exposes format and hides path', () => {
  const t = toTrack({ id: 'a', path: 'Artist/Album/01 Song.FLAC', createdAt: new Date(0) })
  assert.equal(t.format, 'flac')
  assert.equal('path' in t, false)
  assert.equal(t.addedAt.getTime(), 0)
})
