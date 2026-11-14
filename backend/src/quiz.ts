import { randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import type { AuthUser } from './auth.js'
import { prisma } from './db.js'
import { toTrack, trackSelect } from './library.js'
import { notify } from './push.js'
import { friendIds } from './social.js'
import { audioQuery, resolveMusicPath, streamAudio } from './stream.js'

// Blind test between friends: everyone hears the same clip of a track the players
// listen to, and picks its title among four. Fast and right scores the most.
// Games live in memory, like Jams: restarting the API ends them.
//
// The clip comes from /quiz/:id/clip, never from /tracks/:id/stream, so the round's
// track id stays secret until the answer is revealed.

export const ROUNDS = 10
export const ROUND_MS = 20_000
const REVEAL_MS = 6_000
/** Between "Lancer" and the first clip: time for every device to load it. */
const COUNTDOWN_MS = 4_000
const CHOICES = 4
const MAX_POINTS = 1000
const ABANDONED_MS = 10 * 60 * 1000
const HEARTBEAT_MS = 25_000
const MAX_PLAYERS = 20

type Track = ReturnType<typeof toTrack<Awaited<ReturnType<typeof loadTracks>>[number]>>
type Person = { id: string; displayName: string; avatarUpdatedAt: Date | null }
type Candidate = { id: string; title: string; artistName: string; durationSec: number | null }

export interface Round {
  trackId: string
  /** Index of the right one in `choices`. */
  answer: number
  choices: { title: string; artist: string }[]
  /** Where the clip starts in the track, in seconds. */
  clipStart: number
}

interface Answer {
  choice: number
  ms: number
  points: number
}

interface Game {
  id: string
  host: Person
  players: Map<string, Person>
  scores: Map<string, number>
  phase: 'lobby' | 'countdown' | 'question' | 'reveal' | 'over'
  rounds: Round[]
  /** Loaded with the rounds: shown once each is revealed. */
  tracks: Map<string, Track>
  index: number
  /** When the current phase started (Date.now()). */
  since: number
  answers: Map<string, Answer>[]
  timer?: NodeJS.Timeout
  streams: Map<FastifyReply, string>
  abandonTimer?: NodeJS.Timeout
}

const games = new Map<string, Game>()

const person = (u: AuthUser): Person => ({ id: u.id, displayName: u.displayName, avatarUpdatedAt: u.avatarUpdatedAt })

async function loadTracks(ids: string[]) {
  return prisma.track.findMany({ where: { id: { in: ids } }, select: trackSelect })
}

/** Fast and right earns the most: from 1000 points right away down to 500 at the buzzer. */
export function points(ms: number, correct: boolean) {
  if (!correct) return 0
  const left = 1 - Math.min(Math.max(ms, 0), ROUND_MS) / ROUND_MS
  return Math.round(MAX_POINTS / 2 + (MAX_POINTS / 2) * left)
}

/** Starts the clip past the intro, where the track is recognizable but not at its very start. */
export function clipStart(durationSec: number | null, random = Math.random) {
  if (!durationSec || durationSec < 45) return 0
  const latest = durationSec - ROUND_MS / 1000 - 5
  return Math.floor(Math.min(latest, durationSec * (0.2 + random() * 0.3)))
}

function shuffle<T>(items: T[], random = Math.random) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const key = (t: { title: string }) => t.title.trim().toLowerCase()

/**
 * Picks `count` tracks to guess from `pool` (what the players listen to), and for each
 * three wrong titles from `pool` then `extra` (the rest of the library). Titles are never
 * repeated within a round, so no two choices read the same.
 */
export function buildRounds(pool: Candidate[], extra: Candidate[], count: number, random = Math.random): Round[] {
  const seen = new Set<string>()
  const picks: Candidate[] = []
  for (const t of shuffle(pool, random)) {
    if (picks.length >= count) break
    if (seen.has(key(t))) continue
    seen.add(key(t))
    picks.push(t)
  }
  return picks.map((track) => {
    const titles = new Set([key(track)])
    const wrong: Candidate[] = []
    // Drawn again for each round, else every round would offer the same wrong titles.
    for (const d of [...shuffle(pool, random), ...shuffle(extra, random)]) {
      if (wrong.length >= CHOICES - 1) break
      if (titles.has(key(d))) continue
      titles.add(key(d))
      wrong.push(d)
    }
    const choices = shuffle([track, ...wrong], random)
    return {
      trackId: track.id,
      answer: choices.indexOf(track),
      choices: choices.map((c) => ({ title: c.title, artist: c.artistName })),
      clipStart: clipStart(track.durationSec, random),
    }
  })
}

const candidate = { id: true, title: true, artistName: true, durationSec: true } as const

/** The players' most played and liked tracks, topped up with the library. */
async function roundsFor(playerIds: string[]) {
  const [played, liked] = await Promise.all([
    prisma.play.groupBy({
      by: ['trackId'],
      where: { userId: { in: playerIds } },
      _count: { trackId: true },
      orderBy: { _count: { trackId: 'desc' } },
      take: 150,
    }),
    prisma.like.findMany({ where: { userId: { in: playerIds } }, select: { trackId: true }, take: 300 }),
  ])
  const ids = [...new Set([...played.map((p) => p.trackId), ...liked.map((l) => l.trackId)])]
  const pool = await prisma.track.findMany({ where: { id: { in: ids } }, select: candidate })
  // The rest of the library: decoys, and the questions too when the players have little history.
  const total = await prisma.track.count()
  const skip = Math.max(0, Math.floor(Math.random() * (total - 400)))
  const extra = await prisma.track.findMany({ select: candidate, skip, take: 400 })
  const questions = pool.length >= ROUNDS ? pool : [...pool, ...extra]
  return buildRounds(questions, extra, ROUNDS)
}

// --- State sent to the players --------------------------------------------------

function view(game: Game, userId: string) {
  const round = game.rounds[game.index]
  const answers = game.answers[game.index]
  const revealed = game.phase === 'reveal' || game.phase === 'over'
  const elapsed = Date.now() - game.since
  return {
    id: game.id,
    host: game.host,
    players: [...game.players.values()].map((p) => ({ ...p, score: game.scores.get(p.id) ?? 0 })),
    phase: game.phase,
    roundCount: game.rounds.length || ROUNDS,
    index: game.index,
    // Milliseconds left in this phase, counted by clients from when they receive the message.
    remainingMs:
      game.phase === 'countdown'
        ? Math.max(0, COUNTDOWN_MS - elapsed)
        : game.phase === 'question'
          ? Math.max(0, ROUND_MS - elapsed)
          : game.phase === 'reveal'
            ? Math.max(0, REVEAL_MS - elapsed)
            : 0,
    round:
      round && game.phase !== 'lobby'
        ? {
            choices: round.choices,
            clipStart: round.clipStart,
            // The file's extension, for players that need a converted stream (compat=1).
            format: game.tracks.get(round.trackId)?.format ?? null,
            // Who answered, never what, until the reveal.
            answered: [...(answers?.keys() ?? [])],
            mine: answers?.get(userId)?.choice ?? null,
            answer: revealed ? round.answer : null,
            track: revealed ? (game.tracks.get(round.trackId) ?? null) : null,
            results: revealed
              ? [...(answers?.entries() ?? [])].map(([id, a]) => ({ userId: id, choice: a.choice, ms: a.ms, points: a.points }))
              : [],
          }
        : null,
  }
}

function send(reply: FastifyReply, event: string, data: unknown) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function broadcast(game: Game) {
  for (const [reply, userId] of game.streams) send(reply, 'state', view(game, userId))
}

function endGame(game: Game) {
  clearTimeout(game.timer)
  clearTimeout(game.abandonTimer)
  for (const reply of game.streams.keys()) {
    send(reply, 'end', { reason: 'ended' })
    reply.raw.end()
  }
  games.delete(game.id)
}

function enter(game: Game, phase: Game['phase'], ms: number, then?: () => void) {
  clearTimeout(game.timer)
  game.phase = phase
  game.since = Date.now()
  if (then) game.timer = setTimeout(then, ms)
  broadcast(game)
}

function ask(game: Game) {
  game.answers[game.index] = new Map()
  enter(game, 'question', ROUND_MS, () => reveal(game))
}

function reveal(game: Game) {
  const last = game.index >= game.rounds.length - 1
  enter(game, last ? 'over' : 'reveal', REVEAL_MS, last ? undefined : () => {
    game.index++
    ask(game)
  })
}

function newCode() {
  let code
  do code = randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 6).toUpperCase()
  while (!code || code.length < 6 || games.has(code))
  return code
}

export async function quizRoutes(app: FastifyInstance) {
  function joined(id: string, user: AuthUser, reply: FastifyReply) {
    const game = games.get(id.toUpperCase())
    if (!game || !game.players.has(user.id)) {
      reply.code(404).send({ error: 'Partie introuvable ou terminée' })
      return null
    }
    return game
  }

  app.post('/quiz', async (req) => {
    const me = person(req.user!)
    const game: Game = {
      id: newCode(),
      host: me,
      players: new Map([[me.id, me]]),
      scores: new Map(),
      phase: 'lobby',
      rounds: [],
      tracks: new Map(),
      index: 0,
      since: Date.now(),
      answers: [],
      streams: new Map(),
    }
    games.set(game.id, game)
    game.abandonTimer = setTimeout(() => endGame(game), ABANDONED_MS)
    return view(game, me.id)
  })

  app.post('/quiz/:id/join', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const game = games.get(id.toUpperCase())
    if (!game) return reply.code(404).send({ error: 'Cette partie est terminée ou le code est faux' })
    if (!game.players.has(req.user!.id)) {
      if (game.players.size >= MAX_PLAYERS) return reply.code(409).send({ error: 'La partie est complète' })
      game.players.set(req.user!.id, person(req.user!))
      broadcast(game)
    }
    return view(game, req.user!.id)
  })

  app.post('/quiz/:id/invite', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const { userIds } = z.object({ userIds: z.array(z.string()).min(1).max(50) }).parse(req.body)
    const game = joined(id, req.user!, reply)
    if (!game) return
    const friends = new Set(await friendIds(req.user!.id))
    const to = [...new Set(userIds)].filter((u) => friends.has(u))
    notify(to, { title: 'Blind test', body: `${req.user!.displayName} te défie au blind test (code ${game.id})`, link: `quiz/${game.id}` }, req.log)
    return reply.code(201).send({ sent: to.length })
  })

  // Starts the game, or a rematch once it's over: same players, new tracks, scores back to zero.
  app.post('/quiz/:id/start', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const game = joined(id, req.user!, reply)
    if (!game) return
    if (game.host.id !== req.user!.id) return reply.code(403).send({ error: "Seul l'hôte lance la partie" })
    if (game.phase !== 'lobby' && game.phase !== 'over') return reply.code(409).send({ error: 'La partie est déjà lancée' })
    const rounds = await roundsFor([...game.players.keys()])
    if (rounds.length < 3) return reply.code(409).send({ error: 'Pas assez de titres dans la bibliothèque pour jouer' })
    game.rounds = rounds
    game.tracks = new Map((await loadTracks(rounds.map((r) => r.trackId))).map((t) => [t.id, toTrack(t)]))
    game.index = 0
    game.answers = []
    game.scores = new Map()
    enter(game, 'countdown', COUNTDOWN_MS, () => ask(game))
    return reply.code(204).send()
  })

  app.post('/quiz/:id/answer', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const body = z.object({ index: z.number().int(), choice: z.number().int().min(0).max(CHOICES - 1) }).parse(req.body)
    const game = joined(id, req.user!, reply)
    if (!game) return
    const answers = game.answers[game.index]
    // Late (the round moved on) or twice: the first answer counts.
    if (game.phase !== 'question' || body.index !== game.index || !answers || answers.has(req.user!.id)) {
      return reply.code(204).send()
    }
    const ms = Date.now() - game.since
    const gained = points(ms, body.choice === game.rounds[game.index].answer)
    answers.set(req.user!.id, { choice: body.choice, ms, points: gained })
    game.scores.set(req.user!.id, (game.scores.get(req.user!.id) ?? 0) + gained)
    // Everyone answered: no need to wait for the buzzer.
    if ([...game.players.keys()].every((p) => answers.has(p))) reveal(game)
    else broadcast(game)
    return reply.code(204).send()
  })

  app.post('/quiz/:id/leave', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const game = joined(id, req.user!, reply)
    if (!game) return
    if (game.host.id === req.user!.id) endGame(game)
    else {
      game.players.delete(req.user!.id)
      for (const [r, uid] of game.streams) {
        if (uid === req.user!.id) {
          r.raw.end()
          game.streams.delete(r)
        }
      }
      broadcast(game)
    }
    return reply.code(204).send()
  })

  // The current round's clip. The client seeks to `clipStart`; range requests work as for any track.
  app.get('/quiz/:id/clip/:index', async (req, reply) => {
    const { id, index } = z.object({ id: z.string(), index: z.coerce.number().int().min(0) }).parse(req.params)
    const { compat } = audioQuery.parse(req.query)
    const game = joined(id, req.user!, reply)
    if (!game) return
    const round = game.phase !== 'lobby' && index <= game.index ? game.rounds[index] : undefined
    const track = round && (await prisma.track.findUnique({ where: { id: round.trackId } }))
    const file = track && resolveMusicPath(track.path)
    if (!file) return reply.code(404).send({ error: 'Extrait introuvable' })
    reply.header('cache-control', 'no-store')
    return streamAudio(req, reply, file, track.id, compat)
  })

  app.get('/quiz/:id/events', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const game = joined(id, req.user!, reply)
    if (!game) return
    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    clearTimeout(game.abandonTimer)
    game.streams.set(reply, req.user!.id)
    send(reply, 'state', view(game, req.user!.id))
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), HEARTBEAT_MS)
    req.raw.on('close', () => {
      clearInterval(heartbeat)
      game.streams.delete(reply)
      if (!game.streams.size && games.has(game.id)) game.abandonTimer = setTimeout(() => endGame(game), ABANDONED_MS)
    })
  })
}
