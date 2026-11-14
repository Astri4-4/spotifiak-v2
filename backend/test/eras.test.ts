import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.DATABASE_URL ??= 'postgresql://test@localhost/test'
process.env.DEEMIX_URL ??= 'http://localhost:6595'
process.env.MUSIC_DIR ??= '/music'
const { cosine, eraTitle, findEras, weekStart } = await import('../src/eras.js')

const DAY = 24 * 3600 * 1000
const start = Date.UTC(2026, 2, 2) // a Monday

/** `perWeek` plays a week for `weeks` weeks from week `from`, spread over the artists. */
function listen(from: number, weeks: number, artists: string[], perWeek = 20) {
  const out = []
  for (let w = from; w < from + weeks; w++) {
    for (let i = 0; i < perWeek; i++) {
      const artistId = artists[i % artists.length]
      out.push({ trackId: `${artistId}-t${i % 4}`, artistId, playedAt: new Date(start + w * 7 * DAY + (i % 7) * DAY) })
    }
  }
  return out
}

test('weekStart is Monday 00:00 UTC', () => {
  assert.equal(weekStart(new Date('2026-03-04T15:00:00Z')), Date.UTC(2026, 2, 2))
  assert.equal(weekStart(new Date('2026-03-08T23:00:00Z')), Date.UTC(2026, 2, 2))
  assert.equal(weekStart(new Date('2026-03-09T00:00:00Z')), Date.UTC(2026, 2, 9))
})

test('cosine compares what was played', () => {
  assert.equal(cosine(new Map([['a', 2]]), new Map([['a', 5]])), 1)
  assert.equal(cosine(new Map([['a', 2]]), new Map([['b', 5]])), 0)
})

test('a change of artists starts a new era named after them', () => {
  const eras = findEras([
    ...listen(0, 6, ['daft', 'justice']),
    ...listen(6, 5, ['angele', 'stromae']),
  ])
  assert.equal(eras.length, 2)
  assert.deepEqual(new Set(eras[0].signature), new Set(['daft', 'justice']))
  assert.deepEqual(new Set(eras[1].signature), new Set(['angele', 'stromae']))
  assert.equal(eras[0].plays, 120)
  assert.ok(eras[0].end < eras[1].start)
})

test('a short detour and quiet weeks stay inside the era', () => {
  const eras = findEras([
    ...listen(0, 4, ['daft']),
    // One week of something else, too small for an era.
    ...listen(4, 1, ['jazz'], 8),
    // Quiet week: a couple of plays.
    ...listen(5, 1, ['jazz2'], 2),
    ...listen(6, 4, ['daft']),
  ])
  assert.equal(eras.length, 1)
  assert.deepEqual(eras[0].signature, ['daft'])
})

test('no plays, no eras; titles name one or two artists', () => {
  assert.deepEqual(findEras([]), [])
  assert.equal(eraTitle(['Daft Punk']), 'L’ère Daft Punk')
  assert.equal(eraTitle(['Angèle', 'Stromae']), 'L’ère Angèle & Stromae')
})
