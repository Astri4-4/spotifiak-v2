import assert from 'node:assert/strict'
import { test } from 'node:test'

// config.ts parses the environment on import: give it what it requires.
process.env.DATABASE_URL ??= 'postgresql://test@localhost/test'
process.env.DEEMIX_URL ??= 'http://localhost:6595'
process.env.MUSIC_DIR ??= '/music'
const { pickAttraction, recentReleases, toConcert } = await import('../src/calendar.js')

test('recentReleases keeps the last months and announced releases', () => {
  const today = new Date('2026-10-30T12:00:00Z')
  const releases = recentReleases(
    [
      { id: 1, title: 'Old', release_date: '2025-01-01' },
      { id: 2, title: 'Recent', release_date: '2026-09-01', record_type: 'single', cover_medium: 'https://c/2.jpg' },
      { id: 3, title: 'Announced', release_date: '2026-12-05' },
      { id: 4, title: 'Undated' },
    ],
    today,
  )
  assert.deepEqual(
    releases.map((r) => [r.id, r.type]),
    [
      [2, 'single'],
      [3, 'album'],
    ],
  )
  assert.equal(releases[1].link, 'https://www.deezer.com/album/3')
})

test('pickAttraction wants the exact artist, not a namesake', () => {
  const found = [
    { id: 'a', name: 'Daft Punk Tribute' },
    { id: 'b', name: 'DAFT PUNK' },
  ]
  assert.equal(pickAttraction('Daft Punk', found)?.id, 'b')
  assert.equal(pickAttraction('Beyonce', [{ id: 'c', name: 'Beyoncé' }])?.id, 'c')
  assert.equal(pickAttraction('Nobody', found), null)
})

test('toConcert reads the venue and the local date', () => {
  const concert = toConcert({
    id: 'e1',
    name: 'Tour',
    url: 'https://t/e1',
    dates: { start: { localDate: '2026-11-20', localTime: '20:30:00' }, status: { code: 'onsale' } },
    _embedded: { venues: [{ name: 'Zénith', city: { name: 'Paris' }, country: { name: 'France', countryCode: 'FR' } }] },
  })
  assert.deepEqual(concert, {
    id: 'e1',
    name: 'Tour',
    date: '2026-11-20',
    time: '20:30',
    venue: 'Zénith',
    city: 'Paris',
    country: 'France',
    url: 'https://t/e1',
    cancelled: false,
  })
  assert.equal(toConcert({ id: 'e2', name: 'TBA' }), null)
})
