import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from './db.js'
import { notify } from './push.js'

// What the server learns from how people listen, beyond plays:
// - skips: a track skipped in its first seconds, twice, leaves the user's mixes and radios;
// - milestones: a push when the user crosses a round number of plays or hours;
// - the weekly recap: a push on Sunday evening with the week in numbers.

/** Skipped this many times, a track stays out of mixes and radios (until the user takes it back). */
export const SKIP_LIMIT = 2
const SKIP_MEMORY_DAYS = 180
const DAY_MS = 24 * 3600_000

const PLAY_MILESTONES = [1, 100, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000]
const ARTIST_MILESTONES = [100, 250, 500, 1000, 2500, 5000]
const HOUR_MILESTONES = [10, 50, 100, 250, 500, 1000, 2000]

const RECAP_DAY = 0 // Sunday
const RECAP_HOUR = 19
const RECAP_CHECK_MS = 10 * 60_000

/** A ~500 m cell, as clients round positions: "48.855_2.350". */
export const placeCell = z.string().regex(/^-?\d{1,2}\.\d{3}_-?\d{1,3}\.\d{3}$/)

/** The tracks the user skipped often enough to leave out. */
export async function skippedIds(userId: string) {
  const rows = await prisma.skip.findMany({
    where: { userId, count: { gte: SKIP_LIMIT }, skippedAt: { gte: new Date(Date.now() - SKIP_MEMORY_DAYS * DAY_MS) } },
    select: { trackId: true },
  })
  return new Set(rows.map((r) => r.trackId))
}

/** The milestone crossed going from `before` to `after`, if any. */
export function crossed(before: number, after: number, steps: number[]) {
  return steps.find((step) => before < step && after >= step)
}

const fr = (n: number) => n.toLocaleString('fr-FR')

/** What to tell the user after a play, given their counts before and after it. */
export function milestoneMessages(p: {
  plays: number
  artistPlays: number
  artistName: string
  secondsBefore: number
  secondsAfter: number
}) {
  const messages: string[] = []
  const plays = crossed(p.plays - 1, p.plays, PLAY_MILESTONES)
  if (plays === 1) messages.push('Premier titre écouté sur Spotifiak. Bienvenue !')
  else if (plays) messages.push(`${fr(plays)} titres écoutés sur Spotifiak.`)
  const artist = crossed(p.artistPlays - 1, p.artistPlays, ARTIST_MILESTONES)
  if (artist) messages.push(`${fr(artist)} écoutes de ${p.artistName}.`)
  const hours = crossed(p.secondsBefore / 3600, p.secondsAfter / 3600, HOUR_MILESTONES)
  if (hours) messages.push(`${fr(hours)} heures d'écoute cette année.`)
  return messages
}

/** After a play: a push for each milestone it crosses. */
export async function checkMilestones(userId: string, trackId: string, log: FastifyBaseLogger) {
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: { artistId: true, durationSec: true, artist: { select: { name: true } } },
  })
  if (!track) return
  const yearStart = new Date(new Date().getFullYear(), 0, 1)
  const [plays, artistPlays, [year]] = await Promise.all([
    prisma.play.count({ where: { userId } }),
    prisma.play.count({ where: { userId, track: { artistId: track.artistId } } }),
    prisma.$queryRaw<{ seconds: bigint | number | null }[]>`
      SELECT SUM(t."durationSec") AS seconds FROM "Play" p JOIN "Track" t ON t.id = p."trackId"
      WHERE p."userId" = ${userId} AND p."playedAt" >= ${yearStart}`,
  ])
  const secondsAfter = Number(year?.seconds ?? 0)
  const messages = milestoneMessages({
    plays,
    artistPlays,
    artistName: track.artist.name,
    secondsBefore: secondsAfter - (track.durationSec ?? 0),
    secondsAfter,
  })
  for (const body of messages) notify([userId], { title: 'Cap franchi', body, link: 'wrapped' }, log)
}

/** "4 h 12", "35 min" */
export function listeningTime(minutes: number) {
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}

export function recapMessage(week: { minutes: number; topArtist: string | null; topTrack: string | null }) {
  const parts = [`${listeningTime(week.minutes)} d'écoute${week.topArtist ? `, surtout ${week.topArtist}` : ''}.`]
  if (week.topTrack) parts.push(`Ton titre de la semaine : ${week.topTrack}.`)
  return parts.join(' ')
}

/** The Monday 00:00 of this week, server time. */
function weekStart(now = new Date()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

const top = (ids: string[]) => {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

async function sendRecaps(log: FastifyBaseLogger) {
  const now = new Date()
  if (now.getDay() !== RECAP_DAY || now.getHours() < RECAP_HOUR) return
  const since = weekStart(now)
  const users = await prisma.user.findMany({
    where: { pushDevices: { some: {} }, OR: [{ weeklyRecapAt: null }, { weeklyRecapAt: { lt: since } }] },
    select: { id: true },
  })
  for (const { id } of users) {
    // Claimed first: a restart during the hour doesn't send it twice.
    await prisma.user.update({ where: { id }, data: { weeklyRecapAt: now } })
    const plays = await prisma.play.findMany({
      where: { userId: id, playedAt: { gte: since } },
      select: { trackId: true, track: { select: { title: true, durationSec: true, artist: { select: { name: true } } } } },
    })
    if (!plays.length) continue
    const minutes = Math.round(plays.reduce((sum, p) => sum + (p.track.durationSec ?? 0), 0) / 60)
    const topTrackId = top(plays.map((p) => p.trackId))
    notify(
      [id],
      {
        title: 'Ta semaine en musique',
        body: recapMessage({
          minutes,
          topArtist: top(plays.map((p) => p.track.artist.name)),
          topTrack: plays.find((p) => p.trackId === topTrackId)?.track.title ?? null,
        }),
        link: 'wrapped',
      },
      log,
    )
  }
}

export function startWeeklyRecap(log: FastifyBaseLogger) {
  const run = () => void sendRecaps(log).catch((err) => log.warn({ err }, 'weekly recap failed'))
  setInterval(run, RECAP_CHECK_MS).unref()
  run()
}

export async function habitRoutes(app: FastifyInstance) {
  // Clients report a track skipped in its first seconds.
  app.post('/me/skips', async (req, reply) => {
    const { trackId } = z.object({ trackId: z.string() }).parse(req.body)
    const userId = req.user!.id
    if (!(await prisma.track.findUnique({ where: { id: trackId }, select: { id: true } }))) {
      return reply.code(404).send({ error: 'Titre introuvable' })
    }
    await prisma.skip.upsert({
      where: { userId_trackId: { userId, trackId } },
      create: { userId, trackId },
      update: { count: { increment: 1 }, skippedAt: new Date() },
    })
    return reply.code(204).send()
  })

  // Takes a track back into mixes and radios.
  app.delete('/me/skips/:trackId', async (req, reply) => {
    const { trackId } = z.object({ trackId: z.string() }).parse(req.params)
    await prisma.skip.deleteMany({ where: { userId: req.user!.id, trackId } })
    return reply.code(204).send()
  })
}
