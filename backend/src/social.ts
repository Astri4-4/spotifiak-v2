import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from './db.js'
import { isInJam, jamRuns } from './jam.js'
import { mosaic, mosaicEntries, toTrack, trackSelect } from './library.js'

// The same track reported again within this delay is the same listen (a seek, a reload).
const SAME_PLAY_SEC = 30
// Without a known duration, a listen counts as "now" for this long.
const DEFAULT_TRACK_SEC = 240
const RECENT_PLAYS = 20
const NOTIFICATIONS = 50

/** Where `me` stands with another user, from their Friendship row (if any). */
export type Relation = 'friend' | 'sent' | 'received' | null

export function relationOf(friendship: { requesterId: string; status: 'pending' | 'accepted' } | null, me: string): Relation {
  if (!friendship) return null
  if (friendship.status === 'accepted') return 'friend'
  return friendship.requesterId === me ? 'sent' : 'received'
}

/** A listen is still going on until the track's length has passed. */
export function isListening(playedAt: Date, durationSec: number | null, now = new Date()) {
  return now.getTime() - playedAt.getTime() < (durationSec ?? DEFAULT_TRACK_SEC) * 1000
}

const personSelect = { id: true, username: true, displayName: true } as const
const userIdParams = z.object({ userId: z.string() })

function friendshipBetween(a: string, b: string) {
  return prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
  })
}

async function friendIds(userId: string) {
  const rows = await prisma.friendship.findMany({
    where: { status: 'accepted', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  })
  return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId))
}

/** Only friends receive shares and Jam invitations. */
async function requireFriends(me: string, userIds: string[], reply: FastifyReply) {
  const friends = new Set(await friendIds(me))
  if (userIds.every((id) => friends.has(id))) return true
  reply.code(403).send({ error: 'Vous ne pouvez envoyer qu’à vos amis' })
  return false
}

const playSelect = { playedAt: true, track: { select: trackSelect } } as const

function toPlay(play: { playedAt: Date; track: Parameters<typeof toTrack>[0] & { durationSec?: number | null } }) {
  const track = toTrack(play.track)
  return { track, playedAt: play.playedAt, listening: isListening(play.playedAt, track.durationSec ?? null) }
}

export async function socialRoutes(app: FastifyInstance) {
  // --- Finding people and friend requests ---

  app.get('/people', async (req) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(50) }).parse(req.query)
    const me = req.user!.id
    const people = await prisma.user.findMany({
      where: {
        id: { not: me },
        OR: [
          { username: { contains: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: personSelect,
      orderBy: { displayName: 'asc' },
      take: 20,
    })
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [
          { requesterId: me, addresseeId: { in: people.map((p) => p.id) } },
          { addresseeId: me, requesterId: { in: people.map((p) => p.id) } },
        ],
      },
    })
    return people.map((p) => ({
      ...p,
      relation: relationOf(friendships.find((f) => f.requesterId === p.id || f.addresseeId === p.id) ?? null, me),
    }))
  })

  app.get('/friends', async (req) => {
    const me = req.user!.id
    const rows = await prisma.friendship.findMany({
      where: { OR: [{ requesterId: me }, { addresseeId: me }] },
      orderBy: { createdAt: 'desc' },
      select: {
        requesterId: true,
        status: true,
        createdAt: true,
        acceptedAt: true,
        requester: { select: personSelect },
        addressee: { select: personSelect },
      },
    })
    const other = (r: (typeof rows)[number]) => (r.requesterId === me ? r.addressee : r.requester)
    return {
      friends: rows
        .filter((r) => r.status === 'accepted')
        .map((r) => ({ ...other(r), since: r.acceptedAt }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      incoming: rows.filter((r) => r.status === 'pending' && r.requesterId !== me).map((r) => ({ ...other(r), sentAt: r.createdAt })),
      outgoing: rows.filter((r) => r.status === 'pending' && r.requesterId === me).map((r) => ({ ...other(r), sentAt: r.createdAt })),
    }
  })

  // Sends a request, or accepts theirs when they asked first.
  app.post('/friends/:userId', async (req, reply) => {
    const { userId } = userIdParams.parse(req.params)
    const me = req.user!.id
    if (userId === me) return reply.code(400).send({ error: 'Vous ne pouvez pas vous ajouter vous-même' })
    if (!(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
      return reply.code(404).send({ error: 'Compte introuvable' })
    }
    const existing = await friendshipBetween(me, userId)
    if (existing?.status === 'accepted') return { relation: 'friend' }
    if (existing?.requesterId === userId) {
      await prisma.friendship.update({ where: { id: existing.id }, data: { status: 'accepted', acceptedAt: new Date() } })
      return { relation: 'friend' }
    }
    if (!existing) await prisma.friendship.create({ data: { requesterId: me, addresseeId: userId } })
    return { relation: 'sent' }
  })

  app.post('/friends/:userId/accept', async (req, reply) => {
    const { userId } = userIdParams.parse(req.params)
    const { count } = await prisma.friendship.updateMany({
      where: { requesterId: userId, addresseeId: req.user!.id, status: 'pending' },
      data: { status: 'accepted', acceptedAt: new Date() },
    })
    if (!count) return reply.code(404).send({ error: 'Demande introuvable' })
    return { relation: 'friend' }
  })

  // Declines a request, cancels one, or ends a friendship.
  app.delete('/friends/:userId', async (req, reply) => {
    const { userId } = userIdParams.parse(req.params)
    const me = req.user!.id
    await prisma.friendship.deleteMany({
      where: {
        OR: [
          { requesterId: me, addresseeId: userId },
          { requesterId: userId, addresseeId: me },
        ],
      },
    })
    return reply.code(204).send()
  })

  // --- Activity ---

  // Clients report each track they start playing (not podcast episodes).
  app.post('/me/plays', async (req, reply) => {
    const { trackId } = z.object({ trackId: z.string() }).parse(req.body)
    const me = req.user!.id
    if (!(await prisma.track.findUnique({ where: { id: trackId }, select: { id: true } }))) {
      return reply.code(404).send({ error: 'Titre introuvable' })
    }
    const last = await prisma.play.findFirst({ where: { userId: me }, orderBy: { playedAt: 'desc' } })
    if (last?.trackId === trackId && Date.now() - last.playedAt.getTime() < SAME_PLAY_SEC * 1000) {
      return reply.code(204).send()
    }
    await prisma.play.create({ data: { userId: me, trackId } })
    return reply.code(204).send()
  })

  // Each friend sharing their activity, with what they listen(ed) to last; most recent first.
  app.get('/friends/activity', async (req) => {
    const ids = await friendIds(req.user!.id)
    const friends = await prisma.user.findMany({
      where: { id: { in: ids }, shareActivity: true },
      select: { ...personSelect, plays: { orderBy: { playedAt: 'desc' }, take: 1, select: playSelect } },
    })
    return friends
      .filter((f) => f.plays.length)
      .map(({ plays, ...friend }) => ({ user: friend, ...toPlay(plays[0]) }))
      .sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime())
  })

  // A user's page: who they are, where you stand, and (for friends) what they listened to.
  app.get('/people/:userId', async (req, reply) => {
    const { userId } = userIdParams.parse(req.params)
    const me = req.user!.id
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { ...personSelect, shareActivity: true } })
    if (!user) return reply.code(404).send({ error: 'Compte introuvable' })
    const relation = userId === me ? 'friend' : relationOf(await friendshipBetween(me, userId), me)
    const showsActivity = relation === 'friend' && user.shareActivity
    const [plays, playlists] = await Promise.all([
      showsActivity
        ? prisma.play.findMany({ where: { userId }, orderBy: { playedAt: 'desc' }, take: RECENT_PLAYS, select: playSelect })
        : [],
      prisma.playlist.findMany({
        where: { ownerId: userId, public: true, tracks: { some: {} } },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          description: true,
          updatedAt: true,
          owner: { select: { displayName: true } },
          _count: { select: { tracks: true } },
          tracks: mosaicEntries,
        },
      }),
    ])
    const { shareActivity, ...person } = user
    return {
      user: person,
      relation: userId === me ? null : relation,
      activityHidden: relation === 'friend' && !shareActivity,
      recentPlays: plays.map(toPlay),
      playlists: playlists.map(({ _count, tracks, ...p }) => ({ ...p, trackCount: _count.tracks, covers: mosaic(tracks) })),
    }
  })

  // --- Shares and Jam invitations ---

  app.post('/shares', async (req, reply) => {
    const body = z
      .object({ trackId: z.string(), userIds: z.array(z.string()).min(1).max(50), message: z.string().trim().max(300).optional() })
      .parse(req.body)
    const me = req.user!.id
    if (!(await requireFriends(me, body.userIds, reply))) return
    if (!(await prisma.track.findUnique({ where: { id: body.trackId }, select: { id: true } }))) {
      return reply.code(404).send({ error: 'Titre introuvable' })
    }
    await prisma.notification.createMany({
      data: [...new Set(body.userIds)].map((userId) => ({
        userId,
        fromId: me,
        type: 'share' as const,
        trackId: body.trackId,
        message: body.message || null,
      })),
    })
    return reply.code(201).send({ sent: new Set(body.userIds).size })
  })

  app.post('/jam/:id/invite', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const { userIds } = z.object({ userIds: z.array(z.string()).min(1).max(50) }).parse(req.body)
    const me = req.user!.id
    if (!isInJam(id, me)) return reply.code(404).send({ error: 'Cette Jam est terminée' })
    if (!(await requireFriends(me, userIds, reply))) return
    await prisma.notification.createMany({
      data: [...new Set(userIds)].map((userId) => ({ userId, fromId: me, type: 'jam' as const, jamId: id })),
    })
    return reply.code(201).send({ sent: new Set(userIds).size })
  })

  // --- Notifications ---

  app.get('/me/notifications', async (req) => {
    const rows = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: NOTIFICATIONS,
      select: {
        id: true,
        type: true,
        jamId: true,
        message: true,
        createdAt: true,
        readAt: true,
        from: { select: personSelect },
        track: { select: trackSelect },
      },
    })
    return rows.map(({ track, readAt, jamId, ...n }) => ({
      ...n,
      track: track ? toTrack(track) : null,
      jamId,
      // Jams live in memory: an invitation is only good while its Jam runs.
      jamActive: jamId ? jamRuns(jamId) : false,
      read: !!readAt,
    }))
  })

  // What the badge shows: unread notifications and friend requests waiting for an answer.
  app.get('/me/notifications/count', async (req) => {
    const me = req.user!.id
    const [unread, friendRequests] = await Promise.all([
      prisma.notification.count({ where: { userId: me, readAt: null } }),
      prisma.friendship.count({ where: { addresseeId: me, status: 'pending' } }),
    ])
    return { unread, friendRequests }
  })

  app.post('/me/notifications/read', async (req, reply) => {
    await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } })
    return reply.code(204).send()
  })

  app.delete('/me/notifications/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    await prisma.notification.deleteMany({ where: { id, userId: req.user!.id } })
    return reply.code(204).send()
  })
}
