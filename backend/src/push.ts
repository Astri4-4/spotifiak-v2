import { createPrivateKey, sign, type KeyObject } from 'node:crypto'
import { connect, constants, type ClientHttp2Session } from 'node:http2'
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sessionIdOf } from './auth.js'
import { config } from './config.js'
import { prisma } from './db.js'

// Push notifications to the iOS app through Apple's push service (APNs), authenticated with
// a key (.p8) of the Apple Developer account that signs the app. Without that key, push is
// off: the app still shows everything when opened.

const HOSTS = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' }
// Apple rejects provider tokens older than an hour and throttles renewing them more often than
// every 20 minutes.
const TOKEN_TTL_MS = 50 * 60_000
const REQUEST_TIMEOUT_MS = 10_000

export interface PushMessage {
  title: string
  body: string
  /** Groups notifications in Notification Center, e.g. one podcast's episodes. */
  thread?: string
  /** What the app opens when the notification is tapped: "inbox", "friends", "person/<id>", "podcast/<id>". */
  link: string
}

export const pushEnabled = () => !!(config.APNS_KEY && config.APNS_KEY_ID && config.APNS_TEAM_ID)

/** The JWT that authenticates the server to APNs (ES256, signed with the .p8 key). */
export function providerToken(teamId: string, keyId: string, key: KeyObject, now = Date.now()) {
  const part = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const input = `${part({ alg: 'ES256', kid: keyId })}.${part({ iss: teamId, iat: Math.floor(now / 1000) })}`
  const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
  return `${input}.${signature.toString('base64url')}`
}

export function apnsPayload(message: PushMessage, badge?: number) {
  return {
    aps: {
      alert: { title: message.title, body: message.body },
      sound: 'default',
      ...(badge === undefined ? {} : { badge }),
      ...(message.thread ? { 'thread-id': message.thread } : {}),
    },
    link: message.link,
  }
}

/** APNs answers for tokens that will never work again: forget the device. */
export function isDeadToken(status: number, reason?: string) {
  return status === 410 || (status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic'))
}

/** What the app's badge shows: unread notifications and friend requests waiting for an answer. */
export async function unreadCounts(userId: string) {
  const [unread, friendRequests] = await Promise.all([
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.friendship.count({ where: { addresseeId: userId, status: 'pending' } }),
  ])
  return { unread, friendRequests }
}

// --- APNs connection ---------------------------------------------------------

let key: KeyObject | undefined
let cachedToken: { value: string; at: number } | undefined

function bearer() {
  // Kubernetes secrets and .env files often hold the key on one line with literal \n.
  key ??= createPrivateKey(config.APNS_KEY!.replace(/\\n/g, '\n'))
  const now = Date.now()
  if (!cachedToken || now - cachedToken.at > TOKEN_TTL_MS) {
    cachedToken = { value: providerToken(config.APNS_TEAM_ID!, config.APNS_KEY_ID!, key, now), at: now }
  }
  return cachedToken.value
}

// One HTTP/2 connection per APNs host, reopened when Apple closes it.
const connections = new Map<string, ClientHttp2Session>()

function connection(host: string) {
  const existing = connections.get(host)
  if (existing && !existing.closed && !existing.destroyed) return existing
  const session = connect(host)
  const forget = () => {
    if (connections.get(host) === session) connections.delete(host)
  }
  session.on('error', forget)
  session.on('close', forget)
  session.on('goaway', forget)
  session.unref()
  connections.set(host, session)
  return session
}

interface Device {
  token: string
  topic: string
  sandbox: boolean
}

function post(device: Device, payload: string) {
  return new Promise<{ status: number; reason?: string }>((resolve, reject) => {
    const req = connection(device.sandbox ? HOSTS.sandbox : HOSTS.production).request({
      ':method': 'POST',
      ':path': `/3/device/${device.token}`,
      authorization: `bearer ${bearer()}`,
      'apns-topic': device.topic,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    })
    let status = 0
    let body = ''
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.close(constants.NGHTTP2_CANCEL))
    req.on('response', (headers) => {
      status = Number(headers[':status'])
    })
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      body += chunk
    })
    req.on('error', reject)
    req.on('close', () => {
      if (!status) return reject(new Error('APNs request closed without an answer'))
      let reason: string | undefined
      try {
        reason = body ? (JSON.parse(body) as { reason?: string }).reason : undefined
      } catch {
        reason = body
      }
      resolve({ status, reason })
    })
    req.end(payload)
  })
}

async function deliver(userIds: string[], message: PushMessage, log: FastifyBaseLogger) {
  const devices = await prisma.pushDevice.findMany({
    where: { userId: { in: userIds }, session: { expiresAt: { gt: new Date() } } },
  })
  if (!devices.length) return
  const badges = new Map(
    await Promise.all(
      [...new Set(devices.map((d) => d.userId))].map(async (id) => {
        const counts = await unreadCounts(id)
        return [id, counts.unread + counts.friendRequests] as const
      }),
    ),
  )
  const results = await Promise.allSettled(
    devices.map(async (device) => {
      const { status, reason } = await post(device, JSON.stringify(apnsPayload(message, badges.get(device.userId))))
      if (status === 200) return
      if (isDeadToken(status, reason)) {
        await prisma.pushDevice.deleteMany({ where: { token: device.token } })
      } else {
        log.warn({ status, reason, topic: device.topic, sandbox: device.sandbox }, 'APNs refused a notification')
      }
    }),
  )
  for (const r of results) if (r.status === 'rejected') log.warn({ err: r.reason }, 'push notification failed')
}

/** Sends to every registered iPhone of these users, in the background; never throws. */
export function notify(userIds: string[], message: PushMessage, log: FastifyBaseLogger) {
  if (!pushEnabled() || !userIds.length) return
  void deliver([...new Set(userIds)], message, log).catch((err) => log.warn({ err }, 'push notification failed'))
}

// --- Routes ------------------------------------------------------------------

export async function pushRoutes(app: FastifyInstance) {
  // The app registers its APNs token after login and at each launch. The device hangs on the
  // session: logging out, or the session expiring, stops its notifications.
  app.put('/me/push-device', async (req, reply) => {
    const body = z
      .object({
        token: z.string().regex(/^[0-9a-fA-F]{32,400}$/),
        // The app's bundle id as installed: SideStore appends the signing team's ID to it.
        topic: z.string().regex(/^[A-Za-z0-9.-]{1,200}$/),
        // Development-signed builds (SideStore) get their tokens from APNs' sandbox.
        sandbox: z.boolean(),
      })
      .parse(req.body)
    const sessionId = sessionIdOf(req)
    if (!sessionId) return reply.code(401).send({ error: 'Session requise' })
    const token = body.token.toLowerCase()
    const data = { userId: req.user!.id, sessionId, topic: body.topic, sandbox: body.sandbox }
    await prisma.pushDevice.upsert({ where: { token }, create: { token, ...data }, update: data })
    return { enabled: pushEnabled() }
  })

  app.delete('/me/push-device/:token', async (req, reply) => {
    const { token } = z.object({ token: z.string() }).parse(req.params)
    await prisma.pushDevice.deleteMany({ where: { token: token.toLowerCase(), userId: req.user!.id } })
    return reply.code(204).send()
  })
}
