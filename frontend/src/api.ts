const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export interface DeezerTrack {
  id: number
  title: string
  duration: number
  link: string
  artist: { id: number; name: string }
  album: { id: number; title: string; cover_medium: string }
}

export interface Track {
  id: string
  title: string
  artist: string
  album: string | null
  albumArtist: string | null
  year: number | null
  durationSec: number | null
  trackNumber: number | null
  discNumber: number | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init)
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`)
  return res.json() as Promise<T>
}

export const api = {
  search: (q: string) => request<DeezerTrack[]>(`/search?${new URLSearchParams({ q })}`),
  download: (url: string) =>
    request<{ queued: boolean }>('/downloads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }),
  tracks: (q?: string) =>
    request<{ items: Track[]; total: number }>(
      `/tracks${q ? `?${new URLSearchParams({ q })}` : ''}`,
    ),
  rescan: () => request<{ started: boolean }>('/library/scan', { method: 'POST' }),
  streamUrl: (trackId: string) => `${API_URL}/tracks/${trackId}/stream`,
  coverUrl: (trackId: string) => `${API_URL}/tracks/${trackId}/cover`,
}
