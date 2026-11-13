import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.DATABASE_URL ??= 'postgresql://test@localhost/test'
process.env.DEEMIX_URL ??= 'http://localhost:6595'
process.env.MUSIC_DIR ??= '/music'
const { crossed, listeningTime, milestoneMessages, placeCell, recapMessage } = await import('../src/habits.js')
const { hourWeight, momentScores, momentTitle } = await import('../src/mixes.js')
const { duelPick, sharedArtists, similarity } = await import('../src/taste.js')
const { albumsWithMost } = await import('../src/suggestions.js')

test('crossed finds the milestone passed between two counts', () => {
  assert.equal(crossed(99, 100, [1, 100, 500]), 100)
  assert.equal(crossed(100, 101, [1, 100, 500]), undefined)
  assert.equal(crossed(0, 1, [1, 100]), 1)
})

test('milestone messages: first play, round numbers of plays, artist plays and hours', () => {
  const base = { plays: 2, artistPlays: 3, artistName: 'Daft Punk', secondsBefore: 0, secondsAfter: 200 }
  assert.deepEqual(milestoneMessages(base), [])
  assert.deepEqual(milestoneMessages({ ...base, plays: 1 }), ['Premier titre écouté sur Spotifiak. Bienvenue !'])
  assert.deepEqual(milestoneMessages({ ...base, artistPlays: 100 }), ['100 écoutes de Daft Punk.'])
  assert.deepEqual(milestoneMessages({ ...base, secondsBefore: 10 * 3600 - 100, secondsAfter: 10 * 3600 + 100 }), ["10 heures d'écoute cette année."])
})

test('the weekly recap reads well', () => {
  assert.equal(listeningTime(35), '35 min')
  assert.equal(listeningTime(252), '4 h 12')
  assert.equal(
    recapMessage({ minutes: 252, topArtist: 'Daft Punk', topTrack: 'One More Time' }),
    "4 h 12 d'écoute, surtout Daft Punk. Ton titre de la semaine : One More Time.",
  )
  assert.equal(recapMessage({ minutes: 5, topArtist: null, topTrack: null }), "5 min d'écoute.")
})

test('place cells are rounded positions only', () => {
  assert.ok(placeCell.safeParse('48.855_2.350').success)
  assert.ok(placeCell.safeParse('-33.870_-151.210').success)
  assert.ok(!placeCell.safeParse('48.85566_2.35222').success, 'no precise positions')
  assert.ok(!placeCell.safeParse('../etc').success)
})

test('"Ce moment" weighs plays by their time of day', () => {
  const at = (h: number) => new Date(2026, 10, 10, h, 0)
  assert.equal(hourWeight(at(8), 8), 1)
  assert.ok(Math.abs(hourWeight(at(23), 1) - 1 / 3) < 1e-9) // around midnight
  assert.equal(hourWeight(at(14), 8), 0)
  const now = new Date(2026, 10, 10, 9).getTime()
  const scores = momentScores(
    [
      { trackId: 'morning', artistId: 'a', playedAt: at(8) },
      { trackId: 'night', artistId: 'b', playedAt: at(23) },
    ],
    8,
    now,
  )
  assert.ok(scores.get('morning')! > 0.9)
  assert.equal(scores.has('night'), false)
  assert.equal(momentTitle(8), 'Ton matin')
  assert.equal(momentTitle(23), 'Ta nuit')
})

test('a duel pick is a favourite the other never heard', () => {
  const scores = new Map([
    ['heard', 10],
    ['new', 5],
  ])
  assert.equal(duelPick(scores, new Set(['heard']), () => 0), 'new')
  assert.equal(duelPick(scores, new Set(['heard', 'new']), () => 0), null)
})

test('taste similarity and shared artists', () => {
  const a = new Map([
    ['x', 4],
    ['y', 1],
  ])
  assert.equal(similarity(a, a), 1)
  assert.equal(similarity(a, new Map([['z', 3]])), 0)
  assert.deepEqual(sharedArtists(a, new Map([['y', 9], ['x', 2], ['z', 1]])), ['x', 'y'])
})

test('albums to finish need several played tracks', () => {
  assert.deepEqual(albumsWithMost(['a', 'b', 'a', null, 'a', 'b', 'b', 'c']), ['a', 'b'])
})

test('new artists: related ones not in the library, a few per seed, each once', async () => {
  const { newArtists } = await import('../src/suggestions.js')
  const picks = newArtists(
    [
      { seed: 'Daft Punk', artists: [{ id: 1, name: 'Justice' }, { id: 2, name: 'Air' }, { id: 3, name: 'Cassius' }] },
      { seed: 'Air', artists: [{ id: 1, name: 'Justice' }, { id: 4, name: 'Phoenix' }] },
    ],
    new Set(['air']),
    2,
  )
  assert.deepEqual(
    picks.map((p) => [p.artist.name, p.because]),
    [
      ['Justice', 'Daft Punk'],
      ['Cassius', 'Daft Punk'],
      ['Phoenix', 'Air'],
    ],
  )
})
