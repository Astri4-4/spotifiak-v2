import assert from 'node:assert/strict'
import { test } from 'node:test'

// config.ts parses the environment on import: give it what it requires.
process.env.DATABASE_URL ??= 'postgresql://test@localhost/test'
process.env.DEEMIX_URL ??= 'http://localhost:6595'
process.env.MUSIC_DIR ??= '/music'
const { errorText, normalize, parseDeezerLink, pathSuffix, sameTrack, statusOf } = await import('../src/downloads.js')

test('parseDeezerLink reads the type and id, with or without a language', () => {
  assert.deepEqual(parseDeezerLink('https://www.deezer.com/track/3135556'), { type: 'track', id: '3135556' })
  assert.deepEqual(parseDeezerLink('https://www.deezer.com/fr/album/302127'), { type: 'album', id: '302127' })
  assert.deepEqual(parseDeezerLink('https://deezer.com/en-gb/artist/27'), { type: 'artist', id: '27' })
  assert.equal(parseDeezerLink('https://example.com/track/1'), null)
})

test('statusOf follows deemix: the current item downloads, finished ones end', () => {
  const item = { uuid: 'track_1_3', type: 'track', id: 1, title: 'T', artist: 'A', size: 1 }
  assert.equal(statusOf({ ...item, status: 'inQueue' }), 'queued')
  assert.equal(statusOf({ ...item, status: 'inQueue' }, item), 'downloading')
  assert.equal(statusOf({ ...item, status: 'completed' }), 'done')
  assert.equal(statusOf({ ...item, status: 'withErrors' }), 'partial')
  assert.equal(statusOf({ ...item, status: 'failed' }), 'failed')
  assert.equal(statusOf(item), 'queued')
})

test('pathSuffix keeps the folder and file deemix wrote', () => {
  assert.equal(pathSuffix('/downloads/Daft Punk - Discovery/01 - One More Time.mp3'), 'Daft Punk - Discovery/01 - One More Time.mp3')
  assert.equal(pathSuffix('C:\\music\\Album\\02.flac'), 'Album/02.flac')
})

test('errorText summarises what failed', () => {
  const item = { uuid: 'u', type: 'album', id: 1, title: 'T', artist: 'A', size: 3 }
  assert.equal(errorText({ ...item, status: 'completed' }), null)
  assert.equal(errorText({ ...item, status: 'failed' }), 'Échec du téléchargement')
  assert.equal(
    errorText({ ...item, status: 'withErrors', errors: [{ message: 'Not available', data: { title: 'Intro' } }, { message: 'x' }, { message: 'y' }] }),
    'Intro : Not available (+2 autres)',
  )
})

test('normalize ignores accents, case, features and remasters, not versions', () => {
  assert.equal(normalize('Énorme (feat. Quelqu’un)'), 'enorme')
  assert.equal(normalize('Bohemian Rhapsody - Remastered 2011'), 'bohemian rhapsody')
  assert.equal(normalize('Song [Remastered]'), 'song')
  assert.equal(normalize('Simon & Garfunkel'), 'simon and garfunkel')
  assert.notEqual(normalize('Song (Live)'), normalize('Song'))
  assert.notEqual(normalize('Song (Remix)'), normalize('Song'))
})

test('sameTrack matches title, an artist among several, and the length', () => {
  const local = { title: 'One More Time', artistName: 'Daft Punk, Romanthony', durationSec: 320 }
  assert.ok(sameTrack(local, { title: 'One More Time', artist: 'Daft Punk', duration: 321 }))
  assert.ok(sameTrack(local, { title: 'One More Time (feat. Romanthony)', artist: 'Romanthony', duration: 320 }))
  assert.ok(!sameTrack(local, { title: 'One More Time', artist: 'Daft', duration: 320 }))
  assert.ok(!sameTrack(local, { title: 'One More Time', artist: 'Daft Punk', duration: 300 }))
  assert.ok(sameTrack({ ...local, durationSec: null }, { title: 'one more time', artist: 'DAFT PUNK', duration: 300 }))
})

test('sameTrack takes a whole artist name, or the whole tag', () => {
  const duo = { title: 'The Boxer', artistName: 'Simon & Garfunkel', durationSec: 308 }
  assert.ok(sameTrack(duo, { title: 'The Boxer', artist: 'Simon & Garfunkel', duration: 308 }))
  assert.ok(sameTrack({ ...duo, artistName: 'A feat. B' }, { title: 'The Boxer', artist: 'B', duration: 308 }))
})
