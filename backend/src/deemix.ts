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
  await post('/api/loginArl', { arl: config.DEEMIX_ARL })
}

export async function searchTracks(term: string, limit = 30): Promise<DeezerTrack[]> {
  const params = new URLSearchParams({ term, type: 'track', start: '0', nb: String(limit) })
  const res = await request(`/api/search?${params}`)
  const json = (await res.json()) as { data?: DeezerTrack[] }
  return json.data ?? []
}

export async function addToQueue(deezerUrl: string, bitrate?: number): Promise<void> {
  await post('/api/addToQueue', { url: deezerUrl, bitrate })
}
