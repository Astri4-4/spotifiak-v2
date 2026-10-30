import assert from 'node:assert/strict'
import { test } from 'node:test'

// config.ts parses the environment on import: give it what it requires.
process.env.DATABASE_URL ??= 'postgresql://test@localhost/test'
process.env.DEEMIX_URL ??= 'http://localhost:6595'
process.env.MUSIC_DIR ??= '/music'
const { isListening, relationOf } = await import('../src/social.js')

test('relationOf tells who asked whom', () => {
  assert.equal(relationOf(null, 'me'), null)
  assert.equal(relationOf({ requesterId: 'me', status: 'pending' }, 'me'), 'sent')
  assert.equal(relationOf({ requesterId: 'them', status: 'pending' }, 'me'), 'received')
  assert.equal(relationOf({ requesterId: 'them', status: 'accepted' }, 'me'), 'friend')
})

test('isListening lasts as long as the track', () => {
  const now = new Date('2026-01-01T12:00:00Z')
  const ago = (sec: number) => new Date(now.getTime() - sec * 1000)
  assert.equal(isListening(ago(100), 180, now), true)
  assert.equal(isListening(ago(200), 180, now), false)
  // Unknown length: four minutes.
  assert.equal(isListening(ago(200), null, now), true)
  assert.equal(isListening(ago(300), null, now), false)
})
