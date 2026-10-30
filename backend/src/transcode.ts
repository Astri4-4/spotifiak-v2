import { spawn } from 'node:child_process'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'

// Formats every player we serve reads (iOS included); anything else (ogg, opus, webm)
// is converted once to AAC and kept in TRANSCODE_DIR, then served like any file.
export const COMPATIBLE_EXTENSIONS: ReadonlySet<string> = new Set(['.mp3', '.m4a', '.aac', '.flac'])

// Requests arriving while a file converts wait for the same conversion.
const inFlight = new Map<string, Promise<string>>()
let conversions = 0

/** ffmpeg runs started since the process started (for tests). */
export const conversionCount = () => conversions

const mtime = (file: string) => stat(file).then((s) => s.mtimeMs, () => null)

/** A path to a playable version of `source`: itself when compatible, else its cached AAC copy. */
export async function compatFile(source: string, id: string, dir = config.TRANSCODE_DIR): Promise<string> {
  if (COMPATIBLE_EXTENSIONS.has(path.extname(source).toLowerCase())) return source

  const target = path.join(dir, `${id}.m4a`)
  const [sourceTime, targetTime] = await Promise.all([mtime(source), mtime(target)])
  // Converted after the source last changed (a full scan picks up files re-encoded in place).
  if (targetTime !== null && sourceTime !== null && targetTime >= sourceTime) return target

  let pending = inFlight.get(id)
  if (!pending) {
    pending = convert(source, target).finally(() => inFlight.delete(id))
    inFlight.set(id, pending)
  }
  return pending
}

async function convert(source: string, target: string) {
  await mkdir(path.dirname(target), { recursive: true })
  // Written aside and renamed: a half-written file is never served.
  const part = `${target}.part`
  conversions++
  try {
    await run(config.FFMPEG_PATH, [
      ...['-v', 'error', '-y', '-i', source, '-vn', '-map', '0:a:0'],
      ...['-c:a', 'aac', '-b:a', '256k', '-f', 'mp4', '-movflags', '+faststart', part],
    ])
    await rename(part, target)
    return target
  } catch (err) {
    await rm(part, { force: true })
    throw err
  }
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (err) => reject(new Error(`ffmpeg introuvable (${err.message})`)))
    child.on('close', (code) => {
      if (code === 0) return resolve()
      const last = stderr.trim().split('\n').pop()
      reject(new Error(last || `ffmpeg a échoué (code ${code})`))
    })
  })
}

/** Deletes converted files whose track or episode is gone, and leftovers of interrupted conversions. */
export async function pruneTranscodes(keep: Set<string>, dir = config.TRANSCODE_DIR): Promise<number> {
  const files = await readdir(dir).catch(() => [] as string[])
  const stale = files.filter((f) => !f.endsWith('.m4a') || !keep.has(path.basename(f, '.m4a')))
  // A conversion running right now has its .part open: leave those alone.
  const running = new Set([...inFlight.keys()].map((id) => `${id}.m4a.part`))
  const removed = stale.filter((f) => !running.has(f))
  await Promise.all(removed.map((f) => rm(path.join(dir, f), { force: true })))
  return removed.length
}
