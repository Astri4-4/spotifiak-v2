import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import { test } from 'node:test'

// config.ts parses the environment on import: give it what it requires.
process.env.DATABASE_URL ??= 'postgresql://test@localhost/test'
process.env.DEEMIX_URL ??= 'http://localhost:6595'
process.env.MUSIC_DIR ??= '/music'
const { apnsPayload, isDeadToken, providerToken } = await import('../src/push.js')
const { newEpisodesMessage } = await import('../src/podcasts.js')

test('providerToken is an ES256 JWT APNs can verify', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwt = providerToken('TEAM123456', 'KEY1234567', privateKey, Date.UTC(2026, 0, 1))
  const [header, claims, signature] = jwt.split('.')
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'ES256', kid: 'KEY1234567' })
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url').toString()), { iss: 'TEAM123456', iat: 1767225600 })
  const signed = Buffer.from(`${header}.${claims}`)
  assert.ok(verify('sha256', signed, { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')))
})

test('apnsPayload carries the alert, badge, thread and link', () => {
  assert.deepEqual(apnsPayload({ title: 'T', body: 'B', link: 'inbox' }, 3), {
    aps: { alert: { title: 'T', body: 'B' }, sound: 'default', badge: 3 },
    link: 'inbox',
  })
  assert.deepEqual(apnsPayload({ title: 'T', body: 'B', thread: 'podcast-1', link: 'podcast/1' }), {
    aps: { alert: { title: 'T', body: 'B' }, sound: 'default', 'thread-id': 'podcast-1' },
    link: 'podcast/1',
  })
})

test('isDeadToken forgets only devices that will never work again', () => {
  assert.equal(isDeadToken(410, 'Unregistered'), true)
  assert.equal(isDeadToken(400, 'BadDeviceToken'), true)
  assert.equal(isDeadToken(400, 'DeviceTokenNotForTopic'), true)
  assert.equal(isDeadToken(403, 'InvalidProviderToken'), false)
  assert.equal(isDeadToken(429, 'TooManyRequests'), false)
})

test('newEpisodesMessage announces recent episodes, not a back catalogue', () => {
  const now = Date.UTC(2026, 5, 10)
  const podcast = { id: 'p1', title: 'Le Podcast' }
  const recent = { title: 'Épisode 12', publishedAt: new Date(now - 3600_000) }
  const old = { title: 'Épisode 1', publishedAt: new Date(now - 30 * 24 * 3600_000) }

  assert.equal(newEpisodesMessage(podcast, [recent, old], true, now), null)
  assert.equal(newEpisodesMessage(podcast, [old], false, now), null)
  assert.deepEqual(newEpisodesMessage(podcast, [recent, old], false, now), {
    title: 'Le Podcast',
    body: 'Nouvel épisode : Épisode 12',
    thread: 'podcast-p1',
    link: 'podcast/p1',
  })
  assert.equal(newEpisodesMessage(podcast, [recent, { ...recent, title: 'Épisode 13' }], false, now)?.body, '2 nouveaux épisodes')
})
