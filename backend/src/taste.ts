import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from './db.js'
import { toTrack } from './library.js'
import { artistScores, loadTracks, personSelect, seededRandom, tasteOf, weekOf } from './mixes.js'
import { notify } from './push.js'

// Friends' tastes side by side, for friends who share their activity (and only if the user does too):
// - the taste duel: each week, each friend picks for the other (well, the server does, from their
//   favourites) a track the other never played; each says whether they liked it, and the score adds up;
// - the taste map: how close everyone's tastes are, and the artists they share.

const DUEL_POOL = 20
const SHARED_ARTISTS = 3

type Person = { id: string; username: string; displayName: string; avatarUpdatedAt: Date | null }

/** The user's friends who share their activity; none when the user keeps theirs private. */
export async function sharingFriends(userId: string): Promise<Person[]> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { shareActivity: true } })
  if (!me?.shareActivity) return []
  const rows = await prisma.friendship.findMany({
    where: { status: 'accepted', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requester: { select: { ...personSelect, shareActivity: true } }, addressee: { select: { ...personSelect, shareActivity: true } } },
  })
  return rows
    .map((r) => (r.requester.id === userId ? r.addressee : r.requester))
    .filter((p) => p.shareActivity)
    .map(({ shareActivity: _, ...person }) => person)
}

/** A duel pick: one of the picker's favourites the recipient never heard. */
export function duelPick(pickerScores: Map<string, number>, heard: Set<string>, random: () => number) {
  const pool = [...pickerScores]
    .filter(([id]) => !heard.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, DUEL_POOL)
  return pool.length ? pool[Math.floor(random() * pool.length)][0] : null
}

/** Every track the user played or liked before `until`. */
async function heardBy(userId: string, until: Date) {
  const [plays, likes] = await Promise.all([
    prisma.play.findMany({ where: { userId, playedAt: { lt: until } }, distinct: ['trackId'], select: { trackId: true } }),
    prisma.like.findMany({ where: { userId, likedAt: { lt: until } }, select: { trackId: true } }),
  ])
  return new Set([...plays, ...likes].map((r) => r.trackId))
}

/** This week's pick from `picker` for `recipient`: from their tastes as of Monday, so it holds all week. */
async function pickFor(picker: string, recipient: string, week: string) {
  const monday = new Date(`${week}T00:00:00`)
  const [{ scores }, heard] = await Promise.all([tasteOf(picker, monday.getTime()), heardBy(recipient, monday)])
  return duelPick(scores, heard, seededRandom(`${week}:duel:${picker}:${recipient}`))
}

/** How alike two tastes are (cosine of their artist scores): 0 to 1. */
export function similarity(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0
  for (const [k, v] of a) dot += v * (b.get(k) ?? 0)
  const norm = (m: Map<string, number>) => Math.sqrt([...m.values()].reduce((sum, v) => sum + v * v, 0))
  const denominator = norm(a) * norm(b)
  return denominator ? dot / denominator : 0
}

/** The artists both like most (by the smaller of their two scores). */
export function sharedArtists(a: Map<string, number>, b: Map<string, number>, n = SHARED_ARTISTS) {
  return [...a]
    .filter(([k]) => b.has(k))
    .map(([k, v]): [string, number] => [k, Math.min(v, b.get(k)!)])
    .sort((x, y) => y[1] - x[1])
    .slice(0, n)
    .map(([k]) => k)
}

export async function tasteRoutes(app: FastifyInstance) {
  // This week's duel with each friend: their pick for me, mine for them, the votes and the scores.
  app.get('/me/duels', async (req) => {
    const me = req.user!.id
    const week = weekOf(Date.now())
    const friends = await sharingFriends(me)
    return Promise.all(
      friends.map(async (friend) => {
        const [forMe, fromMe, votes] = await Promise.all([
          pickFor(friend.id, me, week),
          pickFor(me, friend.id, week),
          prisma.duelVote.findMany({
            where: { OR: [{ userId: me, friendId: friend.id }, { userId: friend.id, friendId: me }] },
            select: { userId: true, week: true, trackId: true, liked: true },
          }),
        ])
        const mine = votes.find((v) => v.userId === me && v.week === week)
        const theirs = votes.find((v) => v.userId === friend.id && v.week === week)
        // A vote keeps the track it was about, whatever the pick would be now.
        const forMeId = mine?.trackId ?? forMe
        const fromMeId = theirs?.trackId ?? fromMe
        const rows = await loadTracks([forMeId, fromMeId].flatMap((id) => id ?? []))
        const track = (id: string | null) => {
          const row = rows.find((r) => r.id === id)
          if (!row) return null
          const { albumId: _, ...t } = row
          return toTrack(t)
        }
        const forMeTrack = track(forMeId)
        const fromMeTrack = track(fromMeId)
        return {
          friend,
          week,
          forMe: forMeTrack ? { track: forMeTrack, myVote: mine?.liked ?? null } : null,
          fromMe: fromMeTrack ? { track: fromMeTrack, theirVote: theirs?.liked ?? null } : null,
          // Points: picks the other liked, all weeks.
          score: {
            me: votes.filter((v) => v.userId === friend.id && v.liked).length,
            friend: votes.filter((v) => v.userId === me && v.liked).length,
          },
        }
      }),
    )
  })

  // My verdict on this week's pick from a friend.
  app.put('/me/duels/:friendId', async (req, reply) => {
    const { friendId } = z.object({ friendId: z.string() }).parse(req.params)
    const { liked } = z.object({ liked: z.boolean() }).parse(req.body)
    const me = req.user!.id
    const friend = (await sharingFriends(me)).find((f) => f.id === friendId)
    if (!friend) return reply.code(404).send({ error: 'Pas de duel avec cette personne' })
    const week = weekOf(Date.now())
    const existing = await prisma.duelVote.findUnique({ where: { userId_friendId_week: { userId: me, friendId, week } } })
    const trackId = existing?.trackId ?? (await pickFor(friendId, me, week))
    if (!trackId) return reply.code(404).send({ error: 'Pas de choix cette semaine' })
    await prisma.duelVote.upsert({
      where: { userId_friendId_week: { userId: me, friendId, week } },
      create: { userId: me, friendId, week, trackId, liked },
      update: { liked, votedAt: new Date() },
    })
    if (liked && !existing?.liked) {
      const user = await prisma.user.findUnique({ where: { id: me }, select: { displayName: true } })
      notify([friendId], { title: 'Duel des goûts', body: `${user?.displayName} a aimé ton choix de la semaine. Un point pour toi !`, link: 'friends' }, req.log)
    }
    return reply.code(204).send()
  })

  // Me and my friends: how close each pair's tastes are, and the artists they share.
  app.get('/me/taste-map', async (req) => {
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: personSelect })
    const friends = await sharingFriends(req.user!.id)
    if (!me || !friends.length) return { people: me ? [me] : [], links: [] }
    const people = [me, ...friends]
    const now = Date.now()
    const tastes = await Promise.all(
      people.map(async (p) => {
        const { scores, artistOf } = await tasteOf(p.id, now)
        return artistScores(scores, artistOf)
      }),
    )
    const links: { a: string; b: string; similarity: number; artists: string[] }[] = []
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        links.push({ a: people[i].id, b: people[j].id, similarity: similarity(tastes[i], tastes[j]), artists: sharedArtists(tastes[i], tastes[j]) })
      }
    }
    const artistIds = [...new Set(links.flatMap((l) => l.artists))]
    const artists = await prisma.artist.findMany({ where: { id: { in: artistIds } }, select: { id: true, name: true } })
    const names = new Map(artists.map((a) => [a.id, a.name]))
    return {
      people,
      links: links.map((l) => ({ ...l, similarity: Math.round(l.similarity * 100) / 100, artists: l.artists.flatMap((id) => names.get(id) ?? []) })),
    }
  })
}
