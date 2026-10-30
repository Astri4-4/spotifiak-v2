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

test('imageType trusts the bytes, not the name', async () => {
  const { imageType } = await import('../src/social.js')
  assert.equal(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'image/jpeg')
  assert.equal(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png')
  assert.equal(imageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])), 'image/webp')
  assert.equal(imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null)
  assert.equal(imageType(Buffer.alloc(0)), null)
})
