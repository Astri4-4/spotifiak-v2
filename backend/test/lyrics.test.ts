import assert from 'node:assert/strict'
import { test } from 'node:test'

// config.ts parses the environment on import: give it what it requires.
process.env.DATABASE_URL ??= 'postgresql://test@localhost/test'
process.env.DEEMIX_URL ??= 'http://localhost:6595'
process.env.MUSIC_DIR ??= '/music'
const { parseLrc, pickRecord, plainLines } = await import('../src/lyrics.js')

test('parseLrc reads times, skips metadata and sorts', () => {
  const lrc = ['[ar:Artiste]', '[ti:Titre]', '[00:12.50]Deuxième', '[00:01.00]Première', '[01:02.345] Troisième ', '[00:20.00]'].join('\n')
  assert.deepEqual(parseLrc(lrc), [
    { time: 1, text: 'Première' },
    { time: 12.5, text: 'Deuxième' },
    { time: 20, text: '' },
    { time: 62.345, text: 'Troisième' },
  ])
})

test('parseLrc handles repeated lines, word times and offsets', () => {
  assert.deepEqual(parseLrc('[00:05.00][00:30.00]Refrain'), [
    { time: 5, text: 'Refrain' },
    { time: 30, text: 'Refrain' },
  ])
  assert.deepEqual(parseLrc('[00:05.00]<00:05.00>Un <00:05.50>mot'), [{ time: 5, text: 'Un mot' }])
  // A positive offset shows the lyrics sooner.
  assert.deepEqual(parseLrc('[offset:+500]\n[00:05.00]Ligne'), [{ time: 4.5, text: 'Ligne' }])
  assert.deepEqual(parseLrc('Pas de temps ici'), [])
})

test('plainLines keeps inner blank lines, not outer ones', () => {
  assert.deepEqual(plainLines('\n\nCouplet\n\nRefrain\n\n'), [
    { time: null, text: 'Couplet' },
    { time: null, text: '' },
    { time: null, text: 'Refrain' },
  ])
})

test('pickRecord prefers synced lyrics of the right length', () => {
  const plain = { duration: 200, plainLyrics: 'a' }
  const synced = { duration: 201, syncedLyrics: '[00:01.00]a', plainLyrics: 'a' }
  const wrongLength = { duration: 260, syncedLyrics: '[00:01.00]b' }
  assert.equal(pickRecord([wrongLength, plain, synced], 200), synced)
  assert.equal(pickRecord([wrongLength, plain], 200), plain)
  assert.equal(pickRecord([wrongLength], 200), null)
  assert.equal(pickRecord([wrongLength, plain], null), wrongLength)
  assert.equal(pickRecord([{ duration: 200 }], 200), null)
})
