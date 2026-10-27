import { randomBytes, randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import type { AuthUser } from './auth.js'
import { prisma } from './db.js'
import { toTrack, trackSelect } from './library.js'

// A Jam, like Spotify's remote Jam: everyone listens on their own device to the same
// queue, in sync, and anyone can play, pause, skip and add tracks. The server holds
// the state and pushes every change to the participants over Server-Sent Events.
// Jams live in memory: restarting the API ends them.

// "Previous" restarts the track unless it is in its first seconds, like the player.
const RESTART_THRESHOLD_SEC = 3
// Ends a Jam nobody has been connected to for this long (closed tabs, lost phones).
const ABANDONED_MS = 10 * 60 * 1000
// Proxies close idle connections; a comment line every so often keeps the stream open.
const HEARTBEAT_MS = 25_000
const MAX_QUEUE = 1000

type Track = ReturnType<typeof toTrack<Awaited<ReturnType<typeof loadTracks>>[number]>>
type Person = { id: string; displayName: string }

interface Entry {
  id: string
  track: Track
  addedBy: Person
}

interface Jam {
  id: string
  host: Person
  participants: Map<string, Person>
  queue: Entry[]
  index: number
  playing: boolean
  /** Position (seconds) at `since`; advances with time while playing. */
  position: number
  since: number
  streams: Map<FastifyReply, string>
  abandonTimer?: NodeJS.Timeout
}

const jams = new Map<string, Jam>()
const jamOfUser = new Map<string, string>()

const person = (u: AuthUser): Person => ({ id: u.id, displayName: u.displayName })

async function loadTracks(ids: string[]) {
  return prisma.track.findMany({ where: { id: { in: ids } }, select: trackSelect })
}

/** Tracks in the order of `ids` (duplicates kept), unknown ids dropped. */
async function tracksById(ids: string[]) {
  const byId = new Map((await loadTracks(ids)).map((t) => [t.id, toTrack(t)]))
  return ids.map((id) => byId.get(id)).filter((t): t is Track => !!t)
}

function positionNow(jam: Jam) {
  return jam.playing ? jam.position + (Date.now() - jam.since) / 1000 : jam.position
}

function setPosition(jam: Jam, position: number, playing = jam.playing) {
  jam.position = Math.max(0, position)
  jam.since = Date.now()
  jam.playing = playing
}

function view(jam: Jam) {
  return {
    id: jam.id,
    host: jam.host,
    participants: [...jam.participants.values()],
    queue: jam.queue,
    index: jam.index,
    playing: jam.playing,
    // Position when this message is sent; clients count from when they receive it.
    position: positionNow(jam),
  }
}

function send(reply: FastifyReply, event: string, data: unknown) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function broadcast(jam: Jam) {
  const state = view(jam)
  for (const reply of jam.streams.keys()) send(reply, 'state', state)
}

/** Tells a user's open streams they are out (Jam ended, or removed by the host), and closes them. */
function dropUser(jam: Jam, userId: string, reason: 'ended' | 'removed') {
  for (const [reply, uid] of jam.streams) {
    if (uid !== userId) continue
    send(reply, 'end', { reason })
    reply.raw.end()
    jam.streams.delete(reply)
  }
  jam.participants.delete(userId)
  if (jamOfUser.get(userId) === jam.id) jamOfUser.delete(userId)
}

function endJam(jam: Jam) {
  clearTimeout(jam.abandonTimer)
  for (const userId of [...jam.participants.keys()]) dropUser(jam, userId, 'ended')
  jams.delete(jam.id)
}

function leave(jam: Jam, userId: string) {
  if (userId === jam.host.id) return endJam(jam)
  dropUser(jam, userId, 'removed')
  broadcast(jam)
}

/** Leaves the user's current Jam, if any, before starting or joining another one. */
function leaveCurrent(userId: string) {
  const jam = jams.get(jamOfUser.get(userId) ?? '')
  if (jam) leave(jam, userId)
}

function newCode() {
  // Short and unambiguous, as it ends up in a link people share.
  let code
  do code = randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 6).toUpperCase()
  while (!code || code.length < 6 || jams.has(code))
  return code
}

const entries = (tracks: Track[], by: Person): Entry[] => tracks.map((track) => ({ id: randomUUID(), track, addedBy: by }))

const startBody = z.object({
  trackIds: z.array(z.string()).max(MAX_QUEUE).default([]),
  index: z.number().int().min(0).default(0),
  position: z.number().min(0).default(0),
  playing: z.boolean().default(false),
})

const command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('play'), position: z.number().min(0).optional() }),
  z.object({ type: z.literal('pause'), position: z.number().min(0).optional() }),
  z.object({ type: z.literal('seek'), position: z.number().min(0) }),
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('prev') }),
  // A track finished on some device: advance once, whoever reports it first.
  z.object({ type: z.literal('ended'), entryId: z.string() }),
  z.object({ type: z.literal('jump'), entryId: z.string() }),
  z.object({ type: z.literal('add'), trackIds: z.array(z.string()).min(1).max(MAX_QUEUE) }),
  // Play these now: they replace what comes after the current track.
  z.object({ type: z.literal('playTracks'), trackIds: z.array(z.string()).min(1).max(MAX_QUEUE), index: z.number().int().min(0) }),
  z.object({ type: z.literal('remove'), entryId: z.string() }),
])

function advance(jam: Jam) {
  if (jam.index + 1 < jam.queue.length) {
    jam.index++
    setPosition(jam, 0)
  } else {
    // End of the queue: stop at the start of the last track, like the player.
    setPosition(jam, 0, false)
  }
}

export async function jamRoutes(app: FastifyInstance) {
  /** The user's Jam, or a 404 when they aren't part of this one. */
  function joined(id: string, user: AuthUser, reply: FastifyReply) {
    const jam = jams.get(id)
    if (!jam || !jam.participants.has(user.id)) {
      reply.code(404).send({ error: 'Jam introuvable ou terminée' })
      return null
    }
    return jam
  }

  app.get('/jam/current', async (req) => {
    const jam = jams.get(jamOfUser.get(req.user!.id) ?? '')
    return jam ? view(jam) : null
  })

  app.post('/jam', async (req) => {
    const body = startBody.parse(req.body ?? {})
    const user = person(req.user!)
    leaveCurrent(user.id)
    const tracks = await tracksById(body.trackIds)
    const jam: Jam = {
      id: newCode(),
      host: user,
      participants: new Map([[user.id, user]]),
      queue: entries(tracks, user),
      index: Math.min(body.index, Math.max(0, tracks.length - 1)),
      playing: body.playing && tracks.length > 0,
      position: body.position,
      since: Date.now(),
      streams: new Map(),
    }
    jams.set(jam.id, jam)
    jamOfUser.set(user.id, jam.id)
    req.log.info({ jam: jam.id, host: user.id }, 'Jam started')
    return view(jam)
  })

  // What the invitation page shows before joining.
  app.get('/jam/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const jam = jams.get(id.toUpperCase())
    if (!jam) return reply.code(404).send({ error: 'Cette Jam est terminée ou le lien est invalide' })
    return {
      id: jam.id,
      host: jam.host,
      participants: [...jam.participants.values()],
      joined: jam.participants.has(req.user!.id),
    }
  })

  app.post('/jam/:id/join', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const jam = jams.get(id.toUpperCase())
    if (!jam) return reply.code(404).send({ error: 'Cette Jam est terminée ou le lien est invalide' })
    if (!jam.participants.has(req.user!.id)) {
      leaveCurrent(req.user!.id)
      jam.participants.set(req.user!.id, person(req.user!))
      jamOfUser.set(req.user!.id, jam.id)
      broadcast(jam)
    }
    return view(jam)
  })

  app.post('/jam/:id/leave', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const jam = joined(id, req.user!, reply)
    if (!jam) return
    leave(jam, req.user!.id)
    return reply.code(204).send()
  })

  app.delete('/jam/:id/participants/:userId', async (req, reply) => {
    const { id, userId } = z.object({ id: z.string(), userId: z.string() }).parse(req.params)
    const jam = joined(id, req.user!, reply)
    if (!jam) return
    if (jam.host.id !== req.user!.id) return reply.code(403).send({ error: "Seul l'hôte peut retirer quelqu'un" })
    if (userId !== jam.host.id && jam.participants.has(userId)) leave(jam, userId)
    return reply.code(204).send()
  })

  app.post('/jam/:id/commands', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const jam = joined(id, req.user!, reply)
    if (!jam) return
    const cmd = command.parse(req.body)
    const current = jam.queue[jam.index]

    switch (cmd.type) {
      case 'play':
        if (current) setPosition(jam, cmd.position ?? positionNow(jam), true)
        break
      case 'pause':
        setPosition(jam, cmd.position ?? positionNow(jam), false)
        break
      case 'seek':
        setPosition(jam, cmd.position)
        break
      case 'next':
        advance(jam)
        break
      case 'ended':
        if (current?.id !== cmd.entryId) return reply.code(204).send()
        advance(jam)
        break
      case 'prev':
        if (positionNow(jam) > RESTART_THRESHOLD_SEC || jam.index === 0) setPosition(jam, 0)
        else {
          jam.index--
          setPosition(jam, 0)
        }
        break
      case 'jump': {
        const index = jam.queue.findIndex((e) => e.id === cmd.entryId)
        if (index < 0) return reply.code(404).send({ error: "Ce titre n'est plus dans la file" })
        jam.index = index
        setPosition(jam, 0, true)
        break
      }
      case 'add': {
        const added = entries(await tracksById(cmd.trackIds), person(req.user!))
        jam.queue = [...jam.queue, ...added].slice(0, MAX_QUEUE)
        break
      }
      case 'playTracks': {
        const tracks = await tracksById(cmd.trackIds)
        if (!tracks.length) return reply.code(404).send({ error: 'Titres introuvables' })
        const kept = current ? jam.queue.slice(0, jam.index + 1) : []
        jam.queue = [...kept, ...entries(tracks, person(req.user!))].slice(0, MAX_QUEUE)
        jam.index = Math.min(kept.length + cmd.index, jam.queue.length - 1)
        setPosition(jam, 0, true)
        break
      }
      case 'remove': {
        const index = jam.queue.findIndex((e) => e.id === cmd.entryId)
        // The current track can't be removed; skip it instead.
        if (index < 0 || index === jam.index) break
        jam.queue.splice(index, 1)
        if (index < jam.index) jam.index--
        break
      }
    }
    broadcast(jam)
    return reply.code(204).send()
  })

  app.get('/jam/:id/events', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const jam = joined(id, req.user!, reply)
    if (!jam) return

    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      // nginx would otherwise buffer the stream.
      'x-accel-buffering': 'no',
    })
    clearTimeout(jam.abandonTimer)
    jam.streams.set(reply, req.user!.id)
    send(reply, 'state', view(jam))

    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), HEARTBEAT_MS)
    req.raw.on('close', () => {
      clearInterval(heartbeat)
      jam.streams.delete(reply)
      if (!jam.streams.size && jams.has(jam.id)) {
        jam.abandonTimer = setTimeout(() => endJam(jam), ABANDONED_MS)
      }
    })
  })
}
