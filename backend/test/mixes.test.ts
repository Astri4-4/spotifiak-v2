import assert from 'node:assert/strict'
import { test } from 'node:test'

// config.ts parses the environment on import: give it what it requires.
process.env.DATABASE_URL ??= 'postgresql://test@localhost/test'
process.env.DEEMIX_URL ??= 'http://localhost:6595'
process.env.MUSIC_DIR ??= '/music'
const {
  buildBlend,
  buildDailyMix,
  buildDiscovery,
  buildRadio,
  clusterArtists,
  coListening,
  genreSlug,
  listNames,
  relatedArtists,
  seededRandom,
  sessions,
  spreadArtists,
  trackScores,
  weekOf,
} = await import('../src/mixes.js')

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

const links = new Map([
  ['A|B', 3],
  ['A|C', 1],
  ['B|C', 5],
])
const lib = (artist: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${artist}${i}`, artistId: artist, albumId: null }))

test('relatedArtists ranks the artists played alongside one, strongest first', () => {
  assert.deepEqual(relatedArtists('A', links), [
    ['B', 3],
    ['C', 1],
  ])
  assert.deepEqual(relatedArtists('Z', links), [])
})

test('a radio mixes the seed artist with related ones, and a track radio starts with its track', () => {
  const library = [...lib('A', 40), ...lib('B', 40), ...lib('C', 40)]
  const radio = buildRadio('A', relatedArtists('A', links), library, seededRandom('x'), 'A7')
  assert.equal(radio.length, 50)
  assert.equal(radio[0].id, 'A7')
  assert.equal(new Set(radio.map((t) => t.id)).size, 50)
  const count = (artist: string) => radio.filter((t) => t.artistId === artist).length
  assert.ok(count('B') > count('C'), 'the more linked artist gets more tracks')
  assert.ok(count('A') >= 15)
  // Without related artists, a radio is the seed artist alone.
  assert.ok(buildRadio('A', [], library, seededRandom('x')).every((t) => t.artistId === 'A'))
})

test('Discover Weekly only has unheard tracks, mostly from related artists', () => {
  const library = [...lib('A', 10), ...lib('B', 10), ...lib('C', 10), ...lib('Z', 10)]
  const heard = new Set(['A0', 'A1', 'B0'])
  const picks = buildDiscovery(new Map([['A', 5]]), links, library, heard, seededRandom('w'))
  assert.ok(picks.length > 0)
  assert.ok(picks.every((t) => !heard.has(t.id)))
  assert.ok(picks.every((t) => t.artistId !== 'Z'), 'unrelated artists stay out')
  assert.ok(picks.filter((t) => t.artistId === 'B').length <= 3)
})

test('genreSlug makes URL ids of genre names', () => {
  assert.equal(genreSlug('Hip-Hop/Rap'), 'hip-hop-rap')
  assert.equal(genreSlug('Électronique'), 'electronique')
  assert.equal(genreSlug('!!!'), '')
})

test('weekOf is the Monday of the week', () => {
  assert.equal(weekOf(new Date(2026, 10, 12, 15).getTime()), '2026-11-09') // a Thursday
  assert.equal(weekOf(new Date(2026, 10, 15, 23).getTime()), '2026-11-09') // the Sunday after
  assert.equal(weekOf(new Date(2026, 10, 16, 0).getTime()), '2026-11-16')
})
