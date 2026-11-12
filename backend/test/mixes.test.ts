import assert from 'node:assert/strict'
import { test } from 'node:test'

// config.ts parses the environment on import: give it what it requires.
process.env.DATABASE_URL ??= 'postgresql://test@localhost/test'
process.env.DEEMIX_URL ??= 'http://localhost:6595'
process.env.MUSIC_DIR ??= '/music'
const { buildBlend, buildDailyMix, clusterArtists, coListening, listNames, seededRandom, sessions, spreadArtists, trackScores } =
  await import('../src/mixes.js')

const NOW = Date.UTC(2026, 10, 12, 12)
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000)
const play = (trackId: string, artistId: string, minutesAgo: number) => ({ trackId, artistId, playedAt: at(minutesAgo) })

test('trackScores fade plays with age and count likes', () => {
  const scores = trackScores([play('t1', 'a', 0), play('t1', 'a', 30 * 24 * 60), play('t2', 'b', 0)], ['t3'], NOW)
  assert.equal(scores.get('t1'), 1.5) // a play now + a play at the half-life
  assert.equal(scores.get('t2'), 1)
  assert.equal(scores.get('t3'), 2)
})

test('sessions split after 30 minutes without playing', () => {
  const split = sessions([play('t1', 'a', 100), play('t2', 'b', 95), play('t3', 'c', 10), play('t4', 'd', 0)])
  assert.deepEqual(
    split.map((s) => s.map((p) => p.trackId)),
    [['t1', 't2'], ['t3', 't4']],
  )
})

test('artists played together end up in the same Daily Mix group', () => {
  const plays = [
    // Rock evenings: A, B and C together, several times
    ...[0, 1, 2].flatMap((day) => [play(`a${day}`, 'A', day * 1440 + 20), play(`b${day}`, 'B', day * 1440 + 15), play(`c${day}`, 'C', day * 1440 + 10)]),
    // Rap mornings: X and Y together
    ...[0, 1].flatMap((day) => [play(`x${day}`, 'X', day * 1440 + 600), play(`y${day}`, 'Y', day * 1440 + 595)]),
  ]
  const affinity = new Map([
    ['A', 10],
    ['X', 8],
    ['B', 6],
    ['C', 5],
    ['Y', 4],
  ])
  const clusters = clusterArtists(affinity, coListening(sessions(plays)))
  assert.deepEqual(
    clusters.map((c) => [...c].sort()),
    [['A', 'B', 'C'], ['X', 'Y']],
  )
})

test('buildDailyMix keeps to its artists, mixes favourites with others, and changes with the seed', () => {
  const library = [
    ...Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, artistId: 'A', albumId: null })),
    ...Array.from({ length: 40 }, (_, i) => ({ id: `b${i}`, artistId: 'B', albumId: null })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `z${i}`, artistId: 'Z', albumId: null })),
  ]
  const scores = new Map(Array.from({ length: 20 }, (_, i) => [`a${i}`, 20 - i] as const))
  const mix = buildDailyMix(['A', 'B'], scores, library, seededRandom('day1'))
  assert.equal(mix.length, 50)
  assert.ok(mix.every((t) => t.artistId !== 'Z'))
  assert.equal(new Set(mix.map((t) => t.id)).size, 50)
  // All 20 played tracks are among the favourites considered; others fill up the rest.
  assert.ok(mix.filter((t) => scores.has(t.id)).length >= 15)
  const again = buildDailyMix(['A', 'B'], scores, library, seededRandom('day1'))
  assert.deepEqual(again, mix)
  assert.notDeepEqual(buildDailyMix(['A', 'B'], scores, library, seededRandom('day2')), mix)
})

test('spreadArtists avoids the same artist twice in a row when it can', () => {
  const spread = spreadArtists([
    { id: 1, artistId: 'A' },
    { id: 2, artistId: 'A' },
    { id: 3, artistId: 'B' },
    { id: 4, artistId: 'A' },
    { id: 5, artistId: 'B' },
  ])
  assert.deepEqual(
    spread.map((t) => t.artistId),
    ['A', 'B', 'A', 'B', 'A'],
  )
})

test('buildBlend puts shared tracks first, then alternates between both people', () => {
  const mine = new Map([
    ['shared', 3],
    ['m1', 5],
    ['m2', 4],
  ])
  const theirs = new Map([
    ['shared', 2],
    ['f1', 5],
    ['f2', 1],
  ])
  const blend = buildBlend(mine, theirs, seededRandom('x'))
  assert.deepEqual(blend[0], { trackId: 'shared', from: 'both' })
  assert.deepEqual(
    blend.slice(1).map((p) => p.from),
    ['me', 'friend', 'me', 'friend'],
  )
  assert.equal(new Set(blend.map((p) => p.trackId)).size, blend.length)
})

test('buildBlend stops when both people run out', () => {
  const same = new Map([['t', 1]])
  assert.deepEqual(buildBlend(same, new Map(same), seededRandom('x')), [{ trackId: 't', from: 'both' }])
  assert.deepEqual(buildBlend(new Map(), new Map(), seededRandom('x')), [])
})

test('listNames joins names the French way', () => {
  assert.equal(listNames(['A']), 'A')
  assert.equal(listNames(['A', 'B']), 'A et B')
  assert.equal(listNames(['A', 'B', 'C']), 'A, B et C')
})
