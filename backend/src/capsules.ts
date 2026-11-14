import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from './db.js'
import { toTrack, trackSelect } from './library.js'
import { notify } from './push.js'
import { friendIds } from './social.js'

// Time capsules: a track and a word sealed for a friend, or for oneself, that only opens
// on a chosen date ("dans un an"). Until then the recipient sees who sealed it and when it
// opens, never what is inside. On the day, a push announces it.

const CHECK_MS = 60_000
/** Long enough to be a surprise, short enough to try it out. */
export const MIN_DELAY_MS = 60 * 60 * 1000
const MAX_DELAY_MS = 25 * 365 * 24 * 3600 * 1000

const personSelect = { id: true, displayName: true, avatarUpdatedAt: true } as const

/** "14 novembre 2027", as people in the app read dates. */
export function frenchDate(date: Date) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' }).format(date)
}

/** What the recipient's phone says when a capsule opens. */
export function openingMessage(capsule: { fromId: string; toId: string; createdAt: Date }, fromName: string) {
  const sealed = frenchDate(capsule.createdAt)
  return capsule.fromId === capsule.toId
    ? { title: 'Ta capsule s’est ouverte', body: `Tu t’étais scellé un titre le ${sealed}. Il est temps de l’écouter.` }
    : { title: 'Une capsule s’est ouverte', body: `${fromName} te l’avait scellée le ${sealed}. Viens découvrir ce qu’il y a dedans.` }
}

/** Announces the capsules whose day has come, once each. */
async function deliver(log: FastifyBaseLogger) {
  const due = await prisma.capsule.findMany({
    where: { deliveredAt: null, openAt: { lte: new Date() } },
    select: { id: true, fromId: true, toId: true, createdAt: true, from: { select: { displayName: true } }, to: { select: { displayName: true } } },
    take: 500,
  })
  for (const c of due) {
    // Claimed first: several API replicas never announce the same capsule twice.
    const { count } = await prisma.capsule.updateMany({ where: { id: c.id, deliveredAt: null }, data: { deliveredAt: new Date() } })
    if (!count) continue
    notify([c.toId], { ...openingMessage(c, c.from.displayName), link: 'capsules', thread: 'capsules' }, log)
    if (c.fromId !== c.toId) {
      notify([c.fromId], { title: 'Capsule ouverte', body: `Ta capsule pour ${c.to.displayName} vient de s’ouvrir.`, link: 'capsules', thread: 'capsules' }, log)
    }
  }
}

export function startCapsuleDelivery(log: FastifyBaseLogger) {
  const run = () => void deliver(log).catch((err) => log.warn({ err }, 'capsule delivery failed'))
  setInterval(run, CHECK_MS).unref()
  run()
}

export async function capsuleRoutes(app: FastifyInstance) {
  app.post('/capsules', async (req, reply) => {
    const body = z
      .object({
        trackId: z.string(),
        // Oneself, or a friend.
        toId: z.string(),
        message: z.string().trim().max(500).optional(),
        openAt: z.coerce.date(),
      })
      .parse(req.body)
    const me = req.user!
    const delay = body.openAt.getTime() - Date.now()
    if (delay < MIN_DELAY_MS - 60_000) return reply.code(400).send({ error: 'Une capsule s’ouvre au plus tôt dans une heure' })
    if (delay > MAX_DELAY_MS) return reply.code(400).send({ error: 'Une capsule s’ouvre au plus tard dans 25 ans' })
    if (body.toId !== me.id && !(await friendIds(me.id)).includes(body.toId)) {
      return reply.code(403).send({ error: 'Tu ne peux sceller une capsule que pour toi ou tes amis' })
    }
    if (!(await prisma.track.findUnique({ where: { id: body.trackId }, select: { id: true } }))) {
      return reply.code(404).send({ error: 'Titre introuvable' })
    }
    const capsule = await prisma.capsule.create({
      data: { fromId: me.id, toId: body.toId, trackId: body.trackId, message: body.message || null, openAt: body.openAt },
      select: { id: true },
    })
    if (body.toId !== me.id) {
      notify(
        [body.toId],
        { title: 'Une capsule pour toi', body: `${me.displayName} t’a scellé un titre. Il s’ouvrira le ${frenchDate(body.openAt)}.`, link: 'capsules', thread: 'capsules' },
        req.log,
      )
    }
    return reply.code(201).send(capsule)
  })

  // Received capsules (sealed ones without their content) and sent ones.
  app.get('/me/capsules', async (req) => {
    const me = req.user!.id
    const now = new Date()
    const [received, sent] = await Promise.all([
      prisma.capsule.findMany({
        where: { toId: me },
        orderBy: { openAt: 'asc' },
        select: { id: true, openAt: true, createdAt: true, message: true, from: { select: personSelect }, track: { select: trackSelect } },
      }),
      prisma.capsule.findMany({
        // Sealed for oneself: already listed as received.
        where: { fromId: me, toId: { not: me } },
        orderBy: { openAt: 'asc' },
        select: { id: true, openAt: true, createdAt: true, message: true, to: { select: personSelect }, track: { select: trackSelect } },
      }),
    ])
    const isOpen = (c: { openAt: Date }) => c.openAt <= now
    return {
      sealed: received.filter((c) => !isOpen(c)).map(({ track: _track, message: _message, ...c }) => c),
      // Latest opened first.
      opened: received
        .filter(isOpen)
        .reverse()
        .map(({ track, ...c }) => ({ ...c, track: toTrack(track) })),
      sent: sent.map(({ track, ...c }) => ({ ...c, track: toTrack(track), open: isOpen(c) })),
    }
  })

  // The sender takes back a sealed capsule; the recipient clears an opened one.
  app.delete('/capsules/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const me = req.user!.id
    const capsule = await prisma.capsule.findUnique({ where: { id }, select: { fromId: true, toId: true, openAt: true } })
    if (!capsule) return reply.code(404).send({ error: 'Capsule introuvable' })
    const open = capsule.openAt <= new Date()
    const allowed = (capsule.fromId === me && !open) || (capsule.toId === me && open)
    if (!allowed) return reply.code(403).send({ error: open ? 'Seul le destinataire peut effacer une capsule ouverte' : 'Une capsule scellée ne s’efface pas avant son ouverture' })
    await prisma.capsule.delete({ where: { id } })
    return reply.code(204).send()
  })
}
