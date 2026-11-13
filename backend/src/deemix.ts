import { config } from './config.js'

// Client for the deemix web UI's internal HTTP API. These endpoints are not
// officially documented and may change between deemix versions.

export interface DeezerTrack {
  id: number
  title: string
  duration: number
  link: string
  artist: { id: number; name: string }
  album: { id: number; title: string; cover_medium: string }
  /** A 30 s MP3 extract on Deezer's CDN; empty for some tracks. */
  preview?: string
}

let sessionCookie: string | undefined

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (sessionCookie) headers.set('cookie', sessionCookie)

  const res = await fetch(new URL(path, config.DEEMIX_URL), { ...init, headers })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) sessionCookie = setCookie.split(';')[0]
  if (!res.ok) throw new Error(`deemix ${path} failed: ${res.status}`)
  return res
}

async function post(path: string, body: unknown): Promise<Response> {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function login(): Promise<void> {
  if (!config.DEEMIX_ARL) return
  const res = await post('/api/loginArl', { arl: config.DEEMIX_ARL })
  const { status } = (await res.json()) as { status?: number }
  // deemix LoginStatus: 1 success, 2 already logged in, 3 forced; 0 failed (bad or expired ARL), -1 Deezer unavailable
  if (status !== 1 && status !== 2 && status !== 3) throw new Error(`deemix login failed (status ${status}), check DEEMIX_ARL`)
}

export async function searchTracks(term: string, limit = 30): Promise<DeezerTrack[]> {
  return search<DeezerTrack>(term, 'track', limit)
}

export interface DeezerAlbum {
  id: number
  title: string
  link: string
  cover_medium: string
  nb_tracks: number
  record_type?: string
  artist: { id: number; name: string }
}

export interface DeezerArtist {
  id: number
  name: string
  link: string
  picture_medium: string
  nb_album: number
}

export async function search<T>(term: string, type: 'track' | 'album' | 'artist', limit = 30): Promise<T[]> {
  const params = new URLSearchParams({ term, type, start: '0', nb: String(limit) })
  const res = await request(`/api/search?${params}`)
  const json = (await res.json()) as { data?: T[] }
  return json.data ?? []
}

/** An item of deemix's download queue: one track, or one album (an artist link makes one per album). */
export interface QueueItem {
  /** "<type>_<deezer id>_<bitrate>" */
  uuid: string
  type: string
  id: string | number
  title: string
  artist: string
  cover?: string
  /** Tracks in the item */
  size: number
  downloaded?: number
  failed?: number
  progress?: number
  /** Missing while being added; deemix sets it in its queue. */
  status?: 'inQueue' | 'downloading' | 'completed' | 'withErrors' | 'failed'
  errors?: { message?: string; data?: { title?: string; artist?: string } }[]
  /** Files written, once finished */
  files?: { path?: string }[]
}

export interface Queue {
  queue: Record<string, QueueItem>
  queueOrder: string[]
  /** The item downloading now, with its progress */
  current?: QueueItem
}

export async function getQueue(): Promise<Queue> {
  return (await request('/api/getQueue')).json() as Promise<Queue>
}

interface QueueAnswer {
  result?: boolean
  errid?: string
  data?: { obj?: QueueItem[] }
}

/** Sends a request that queues items, logging in again once if deemix restarted and forgot it. */
async function queueRequest(path: string, body: unknown, what: string): Promise<QueueItem[]> {
  const send = async () => (await post(path, body)).json() as Promise<QueueAnswer>
  let res = await send()
  if (res.errid === 'NotLoggedIn') {
    await login()
    res = await send()
  }
  // deemix answers 200 even when it refuses, so the body says whether the download was queued.
  if (!res.result) throw new Error(`deemix refused ${what}: ${res.errid ?? 'unknown error'}`)
  return res.data?.obj ?? []
}

/**
 * Queues a Deezer link; returns the items deemix added. Items it already has (in its queue or
 * finished) are skipped silently: none is returned for them.
 */
export async function addToQueue(deezerUrl: string, bitrate?: number): Promise<QueueItem[]> {
  return queueRequest('/api/addToQueue', { url: deezerUrl, bitrate }, deezerUrl)
}

/** Downloads a queue item again, finished or failed. */
export async function retry(uuid: string): Promise<QueueItem[]> {
  return queueRequest('/api/retryDownload', { uuid }, uuid)
}

/** Removes an item from deemix's queue (stops it if it is downloading). */
export async function cancel(uuid: string): Promise<void> {
  await request(`/api/removeFromQueue?${new URLSearchParams({ uuid })}`, { method: 'POST' })
}
