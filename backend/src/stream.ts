import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { config } from './config.js'

export const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.opus': 'audio/ogg',
}

// Resolves a path relative to a folder, refusing anything that escapes it.
export function resolveWithin(folder: string, relative: string): string | null {
  const root = path.resolve(folder)
  const full = path.resolve(root, relative)
  return full.startsWith(root + path.sep) ? full : null
}

export const resolveMusicPath = (relative: string) => resolveWithin(config.MUSIC_DIR, relative)

export async function streamFile(req: FastifyRequest, reply: FastifyReply, file: string) {
  const { size } = await stat(file)
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  reply.header('accept-ranges', 'bytes').type(type)

  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/)
  if (!range) {
    reply.header('content-length', size)
    return reply.send(createReadStream(file))
  }

  const start = range[1] ? Number(range[1]) : size - Number(range[2])
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
  if (start < 0 || start > end || start >= size) {
    return reply.code(416).header('content-range', `bytes */${size}`).send()
  }

  return reply
    .code(206)
    .header('content-range', `bytes ${start}-${end}/${size}`)
    .header('content-length', end - start + 1)
    .send(createReadStream(file, { start, end }))
}
