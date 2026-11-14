import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.DATABASE_URL ??= 'postgresql://test@localhost/test'
process.env.DEEMIX_URL ??= 'http://localhost:6595'
process.env.MUSIC_DIR ??= '/music'
const { frenchDate, openingMessage } = await import('../src/capsules.js')

test('dates read the French way, in Paris time', () => {
  assert.equal(frenchDate(new Date('2027-11-14T12:00:00Z')), '14 novembre 2027')
  // 23:30 UTC on Dec 31 is already New Year's Day in Paris.
  assert.equal(frenchDate(new Date('2026-12-31T23:30:00Z')), '1 janvier 2027')
})

test('a capsule to oneself and one from a friend open with different words', () => {
  const createdAt = new Date('2026-11-14T12:00:00Z')
  const self = openingMessage({ fromId: 'u1', toId: 'u1', createdAt }, 'Sacha')
  assert.equal(self.title, 'Ta capsule s’est ouverte')
  assert.match(self.body, /Tu t’étais scellé un titre le 14 novembre 2026/)
  const friend = openingMessage({ fromId: 'u2', toId: 'u1', createdAt }, 'Léa')
  assert.match(friend.body, /^Léa te l’avait scellée le 14 novembre 2026/)
})
