import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.DATABASE_URL ??= 'postgresql://test@localhost/test'
process.env.DEEMIX_URL ??= 'http://localhost:6595'
process.env.MUSIC_DIR ??= '/music'
const { summarizePlays } = await import('../src/discover.js')

test('summarizePlays counts minutes and ranks tracks, artists and genres', () => {
  const play = (trackId: string, artistId: string, genre: string | null) => ({ trackId, artistId, genre, durationSec: 180 })
  const summary = summarizePlays([play('t1', 'a', 'Rock'), play('t1', 'a', 'Rock'), play('t2', 'b', null), play('t3', 'b', 'Pop')])
  assert.equal(summary.plays, 4)
  assert.equal(summary.minutes, 12)
  assert.deepEqual(summary.tracks[0], { id: 't1', plays: 2 })
  assert.deepEqual(
    summary.artists.map((a) => a.id),
    ['a', 'b'],
  )
  assert.deepEqual(summary.genres, [
    { id: 'Rock', plays: 2 },
    { id: 'Pop', plays: 1 },
  ])
  assert.deepEqual(summarizePlays([]), { plays: 0, minutes: 0, tracks: [], artists: [], genres: [] })
})
