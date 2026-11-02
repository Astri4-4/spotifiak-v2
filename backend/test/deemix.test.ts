import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, test } from 'node:test'

// Fake deemix: refuses downloads until /api/loginArl is called, like a freshly restarted deemix.
let loggedIn = false
let arlOk = true
const server = createServer((req, res) => {
  res.setHeader('content-type', 'application/json')
  if (req.url === '/api/loginArl') {
    loggedIn = arlOk
    return res.end(JSON.stringify({ status: arlOk ? 1 : 0 }))
  }
  if (req.url === '/api/addToQueue') {
    return res.end(JSON.stringify(loggedIn ? { result: true, data: {} } : { result: false, errid: 'NotLoggedIn' }))
  }
  res.statusCode = 404
  res.end('{}')
})
await new Promise<void>((resolve) => server.listen(0, resolve))
after(() => server.close())

process.env.DATABASE_URL ??= 'postgresql://test@localhost/test'
process.env.DEEMIX_URL = `http://localhost:${(server.address() as AddressInfo).port}`
process.env.DEEMIX_ARL = 'arl'
process.env.MUSIC_DIR ??= '/music'
const deemix = await import('../src/deemix.js')

test('addToQueue logs in again when deemix lost its session', async () => {
  loggedIn = false
  await deemix.addToQueue('https://www.deezer.com/track/1')
  assert.equal(loggedIn, true)
})

test('addToQueue fails loudly when the ARL is rejected', async () => {
  loggedIn = false
  arlOk = false
  await assert.rejects(deemix.addToQueue('https://www.deezer.com/track/1'), /login failed/)
  arlOk = true
})
