import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.DATABASE_URL ??= 'postgresql://test@localhost/test'
process.env.DEEMIX_URL ??= 'http://localhost:6595'
process.env.MUSIC_DIR ??= '/music'
const { buildRounds, clipStart, points, ROUND_MS } = await import('../src/quiz.js')

const t = (id: string, title = `Titre ${id}`, durationSec: number | null = 200) => ({ id, title, artistName: `Artiste ${id}`, durationSec })

test('points reward fast right answers only', () => {
  assert.equal(points(0, true), 1000)
  assert.equal(points(ROUND_MS, true), 500)
  assert.equal(points(ROUND_MS / 2, true), 750)
  assert.equal(points(ROUND_MS * 3, true), 500)
  assert.equal(points(100, false), 0)
})

test('clipStart skips the intro and leaves a full round of music', () => {
  assert.equal(clipStart(null), 0)
  assert.equal(clipStart(30), 0)
  assert.equal(clipStart(200, () => 0), 40)
  assert.ok(clipStart(60, () => 0.99) <= 60 - ROUND_MS / 1000 - 5)
})

test('buildRounds asks distinct tracks with four distinct choices, the right one included', () => {
  const pool = Array.from({ length: 12 }, (_, i) => t(`p${i}`))
  // Same title as p0: never two identical choices in a round.
  const extra = [t('dup', 'Titre p0'), ...Array.from({ length: 6 }, (_, i) => t(`e${i}`))]
  const rounds = buildRounds(pool, extra, 10)
  assert.equal(rounds.length, 10)
  assert.equal(new Set(rounds.map((r) => r.trackId)).size, 10)
  for (const r of rounds) {
    assert.equal(r.choices.length, 4)
    assert.equal(new Set(r.choices.map((c) => c.title.toLowerCase())).size, 4)
    assert.equal(r.choices[r.answer].title, `Titre ${r.trackId}`)
  }
})

test('buildRounds plays fewer rounds with a tiny library', () => {
  const rounds = buildRounds([t('a'), t('b'), t('a2', 'Titre a')], [], 10)
  assert.equal(rounds.length, 2)
  assert.equal(rounds[0].choices.length, 2)
})
