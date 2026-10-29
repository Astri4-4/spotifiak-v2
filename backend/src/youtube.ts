import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { config } from './config.js'
import { prisma } from './db.js'
import { plainText } from './podcasts.js'
import { audioQuery, resolveWithin, streamAudio } from './stream.js'

// Podcasts created in Spotifiak: their episodes are YouTube videos, whose audio
// yt-dlp downloads into PODCAST_DIR/<podcast id>/<episode id>.<ext>, one at a time.

const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000
const MAX_FILE_SIZE = '1G'
// m4a plays everywhere (Safari included) and needs no conversion, hence no ffmpeg.
const AUDIO_FORMAT = 'bestaudio[ext=m4a]/bestaudio'
// Mixes (list=RD…) are endless: only their first videos are taken.
const MAX_PLAYLIST_VIDEOS = 500

const idParams = z.object({ id: z.string() })
const episodeParams = z.object({ id: z.string(), episodeId: z.string() })

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'])

/** The video id of a YouTube link (watch, youtu.be, shorts, live, embed), or null. */
export function youtubeVideoId(input: string) {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null
  const candidate =
    url.hostname.toLowerCase() === 'youtu.be'
      ? url.pathname.slice(1)
      : (url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1])
  return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null
}

/** The playlist id of a YouTube playlist link (playlist?list=…), or null. A watch link
 *  inside a playlist (watch?v=…&list=…) stays a single video. */
export function youtubePlaylistId(input: string) {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase()) || youtubeVideoId(input)) return null
  const list = url.searchParams.get('list')
  return list && /^[A-Za-z0-9_-]{2,64}$/.test(list) ? list : null
}

// --- Downloads -----------------------------------------------------------------

interface VideoInfo {
  id: string
  title?: string
  description?: string
  duration?: number
  thumbnail?: string
  channel?: string
  uploader?: string
}

const queue: string[] = []
let working = false
let log: FastifyBaseLogger | undefined

/** Runs yt-dlp; resolves with stdout, rejects with yt-dlp's own error message. */
function ytdlp(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(config.YTDLP_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)))
    const timer = setTimeout(() => child.kill('SIGKILL'), DOWNLOAD_TIMEOUT_MS)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`yt-dlp introuvable (${err.message})`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) return resolve(stdout)
      const message = stderr.split('\n').reverse().find((l) => l.startsWith('ERROR:')) ?? `yt-dlp a échoué (code ${code})`
      reject(new Error(message.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?(\w{11}:\s*)?/, '')))
    })
  })
}

interface PlaylistInfo {
  entries?: { id?: string; title?: string }[]
}

/** The video ids of a playlist, in its order; private and deleted videos are left out. */
async function playlistVideoIds(playlistId: string) {
  const stdout = await ytdlp([
    '--flat-playlist',
    '--dump-single-json',
    '--js-runtimes',
    'node',
    '--playlist-end',
    String(MAX_PLAYLIST_VIDEOS),
    `https://www.youtube.com/playlist?list=${playlistId}`,
  ])
  const info = JSON.parse(stdout) as PlaylistInfo
  return (info.entries ?? [])
    .filter((e) => !/^\[(private|deleted) video\]$/i.test(e.title ?? ''))
    .map((e) => e.id)
    .filter((id): id is string => !!id && /^[A-Za-z0-9_-]{11}$/.test(id))
}

async function removeFiles(dir: string, prefix: string) {
  const names = await readdir(dir).catch(() => [] as string[])
  await Promise.all(names.filter((n) => n.startsWith(prefix)).map((n) => rm(path.join(dir, n), { force: true })))
}

async function download(episodeId: string) {
  const episode = await prisma.podcastEpisode.findUnique({ where: { id: episodeId } })
  if (!episode?.sourceUrl || episode.status !== 'queued') return
  const dir = path.join(config.PODCAST_DIR!, episode.podcastId)
  await mkdir(dir, { recursive: true })
  await prisma.podcastEpisode.update({ where: { id: episodeId }, data: { status: 'downloading', error: null } })

  try {
    const stdout = await ytdlp([
      '--no-playlist',
      '--no-progress',
      // YouTube now needs a JavaScript runtime to unlock its formats: Node is at hand.
      '--js-runtimes',
      'node',
      '--match-filter',
      `!is_live & duration < ${Math.round(config.YOUTUBE_MAX_HOURS * 3600)}`,
      '--max-filesize',
      MAX_FILE_SIZE,
      '-f',
      AUDIO_FORMAT,
      '-o',
      path.join(dir, `${episodeId}.%(ext)s`),
      // Prints the video's metadata and still downloads it.
      '--dump-json',
      '--no-simulate',
      episode.sourceUrl,
    ])
    const info = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as VideoInfo
    const file = (await readdir(dir)).find((n) => n.startsWith(`${episodeId}.`) && !n.endsWith('.part'))
    // A filtered video (live, too long) exits fine without downloading anything.
    if (!file) throw new Error(`Vidéo refusée : direct en cours ou plus de ${config.YOUTUBE_MAX_HOURS} h`)

    const updated = await prisma.podcastEpisode
      .update({
        where: { id: episodeId },
        data: {
          title: info.title ?? episode.title,
          description: plainText(info.description),
          durationSec: info.duration ? Math.round(info.duration) : null,
          imageUrl: info.thumbnail ?? null,
          filePath: path.join(episode.podcastId, file),
          status: 'ready',
        },
      })
      .catch(() => null)
    // Deleted while downloading: drop the file.
    if (!updated) return removeFiles(dir, episodeId)
    // The first video's thumbnail becomes the podcast's artwork.
    if (info.thumbnail) {
      await prisma.podcast.updateMany({ where: { id: episode.podcastId, imageUrl: null }, data: { imageUrl: info.thumbnail } })
    }
  } catch (err) {
    await removeFiles(dir, episodeId)
    log?.warn({ episodeId, err: (err as Error).message }, 'youtube download failed')
    await prisma.podcastEpisode
      .update({ where: { id: episodeId }, data: { status: 'failed', error: (err as Error).message.slice(0, 300) } })
      .catch(() => {})
  }
}

async function work() {
  if (working) return
  working = true
  try {
    for (let id = queue.shift(); id; id = queue.shift()) await download(id)
  } finally {
    working = false
  }
}

function enqueue(episodeId: string) {
  queue.push(episodeId)
  void work()
}

/** After a restart: downloads that were waiting or cut short start again. */
export async function resumeDownloads(logger: FastifyBaseLogger) {
  log = logger
  if (!config.PODCAST_DIR) return
  await prisma.podcastEpisode.updateMany({ where: { status: 'downloading' }, data: { status: 'queued' } })
  const waiting = await prisma.podcastEpisode.findMany({
    where: { status: 'queued' },
    orderBy: { publishedAt: 'asc' },
    select: { id: true },
  })
  for (const { id } of waiting) enqueue(id)
}

// --- Routes --------------------------------------------------------------------

export async function youtubeRoutes(app: FastifyInstance) {
  const enabled = () => !!config.PODCAST_DIR

  // Only the creator edits a created podcast; for others it's missing (or read-only).
  async function ownedPodcast(id: string, userId: string, reply: FastifyReply) {
    const podcast = await prisma.podcast.findFirst({ where: { id, ownerId: userId } })
    if (!podcast) reply.code(404).send({ error: 'Podcast introuvable' })
    return podcast
  }

  app.get('/podcasts/creation', async () => ({ enabled: enabled() }))

  app.post('/podcasts/created', async (req, reply) => {
    if (!enabled()) return reply.code(503).send({ error: "La création de podcasts n'est pas activée (PODCAST_DIR)" })
    const user = req.user!
    const count = await prisma.podcast.count({ where: { ownerId: user.id } })
    const id = randomUUID()
    const podcast = await prisma.podcast.create({
      data: {
        feedUrl: `local:${id}`,
        title: `Mon podcast n°${count + 1}`,
        author: user.displayName,
        ownerId: user.id,
        fetchedAt: new Date(),
        // The creator finds it in their library.
        subscribers: { create: { userId: user.id } },
      },
      select: { id: true, title: true },
    })
    return reply.code(201).send(podcast)
  })

  app.patch('/podcasts/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params)
    const body = z
      .object({
        title: z.string().trim().min(1, 'Le nom ne peut pas être vide').max(100).optional(),
        description: z.string().trim().max(1000).optional(),
      })
      .parse(req.body)
    if (!(await ownedPodcast(id, req.user!.id, reply))) return
    await prisma.podcast.update({ where: { id }, data: { ...body, description: body.description || null } })
    return reply.code(204).send()
  })

  app.delete('/podcasts/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params)
    if (!(await ownedPodcast(id, req.user!.id, reply))) return
    await prisma.podcast.delete({ where: { id } })
    if (config.PODCAST_DIR) await rm(path.join(config.PODCAST_DIR, id), { recursive: true, force: true })
    return reply.code(204).send()
  })

  app.post('/podcasts/:id/episodes', async (req, reply) => {
    const { id } = idParams.parse(req.params)
    const { url } = z.object({ url: z.string().max(500) }).parse(req.body)
    if (!enabled()) return reply.code(503).send({ error: "La création de podcasts n'est pas activée (PODCAST_DIR)" })
    if (!(await ownedPodcast(id, req.user!.id, reply))) return
    const playlistId = youtubePlaylistId(url)
    const videoId = youtubeVideoId(url)
    if (!videoId && !playlistId) return reply.code(400).send({ error: "Ce n'est pas un lien de vidéo ou de playlist YouTube" })

    let videoIds: string[]
    if (videoId) {
      videoIds = [videoId]
    } else {
      try {
        videoIds = await playlistVideoIds(playlistId!)
      } catch (err) {
        return reply.code(400).send({ error: `Playlist illisible : ${(err as Error).message}` })
      }
      if (!videoIds.length) return reply.code(400).send({ error: 'Cette playlist ne contient aucune vidéo disponible' })
    }

    const existing = await prisma.podcastEpisode.findMany({
      where: { podcastId: id, guid: { in: videoIds.map((v) => `youtube:${v}`) } },
      select: { guid: true },
    })
    const known = new Set(existing.map((e) => e.guid))
    const fresh = [...new Set(videoIds)].filter((v) => !known.has(`youtube:${v}`))
    if (!fresh.length) {
      return reply.code(409).send({ error: videoId ? 'Cette vidéo est déjà dans le podcast' : 'Ces vidéos sont déjà dans le podcast' })
    }

    // Episodes list newest first: a playlist's first video gets the latest date to keep its order.
    const now = Date.now()
    const created = await prisma.$transaction(
      fresh.map((v, i) => {
        // Only the canonical address reaches yt-dlp, whatever was pasted.
        const sourceUrl = `https://www.youtube.com/watch?v=${v}`
        return prisma.podcastEpisode.create({
          data: {
            podcastId: id,
            guid: `youtube:${v}`,
            title: 'Vidéo YouTube',
            audioUrl: sourceUrl,
            sourceUrl,
            status: 'queued',
            publishedAt: new Date(now - i),
          },
          select: { id: true },
        })
      }),
    )
    for (const episode of created) enqueue(episode.id)
    return reply.code(201).send({ added: created.length, skipped: videoIds.length - created.length })
  })

  app.post('/podcasts/:id/episodes/:episodeId/retry', async (req, reply) => {
    const { id, episodeId } = episodeParams.parse(req.params)
    if (!(await ownedPodcast(id, req.user!.id, reply))) return
    const { count } = await prisma.podcastEpisode.updateMany({
      where: { id: episodeId, podcastId: id, status: 'failed' },
      data: { status: 'queued', error: null },
    })
    if (!count) return reply.code(404).send({ error: 'Épisode introuvable' })
    enqueue(episodeId)
    return reply.code(202).send()
  })

  app.delete('/podcasts/:id/episodes/:episodeId', async (req, reply) => {
    const { id, episodeId } = episodeParams.parse(req.params)
    if (!(await ownedPodcast(id, req.user!.id, reply))) return
    const episode = await prisma.podcastEpisode.findFirst({ where: { id: episodeId, podcastId: id } })
    if (!episode) return reply.code(404).send({ error: 'Épisode introuvable' })
    await prisma.podcastEpisode.delete({ where: { id: episodeId } })
    if (config.PODCAST_DIR) await removeFiles(path.join(config.PODCAST_DIR, id), episodeId)
    return reply.code(204).send()
  })

  app.get('/episodes/:id/audio', async (req, reply) => {
    const { id } = idParams.parse(req.params)
    const { compat } = audioQuery.parse(req.query)
    const episode = await prisma.podcastEpisode.findUnique({ where: { id }, select: { filePath: true } })
    const file = config.PODCAST_DIR && episode?.filePath && resolveWithin(config.PODCAST_DIR, episode.filePath)
    if (!file) return reply.code(404).send({ error: 'Épisode introuvable' })
    return streamAudio(req, reply, file, id, compat)
  })
}
