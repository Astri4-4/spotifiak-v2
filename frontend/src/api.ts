const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export interface Ref {
  id: string
  title: string
}

export interface Track {
  id: string
  title: string
  artistName: string
  artistId: string
  album: Ref | null
  durationSec: number | null
  trackNumber: number | null
  discNumber: number | null
  addedAt: string
}

export interface Album {
  id: string
  title: string
  year: number | null
  createdAt: string
  artist: { id: string; name: string }
  coverTrackId: string | null
  trackCount: number
}

export interface AlbumDetail extends Album {
  tracks: Track[]
}

export interface Artist {
  id: string
  name: string
  coverTrackId: string | null
}

export interface ArtistDetail extends Artist {
  albums: Album[]
  tracks: Track[]
}

export interface SearchResults {
  tracks: Track[]
  albums: Album[]
  artists: Artist[]
}

export interface DeezerTrack {
  id: number
  title: string
  duration: number
  link: string
  artist: { id: number; name: string }
  album: { id: number; title: string; cover_medium: string }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init)
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`)
  return res.json() as Promise<T>
}

const query = (params: Record<string, string>) => new URLSearchParams(params).toString()

export const api = {
  tracks: () => request<{ items: Track[]; total: number }>('/tracks?limit=200'),
  albums: () => request<{ items: Album[] }>('/albums?limit=200'),
  album: (id: string) => request<AlbumDetail>(`/albums/${id}`),
  artists: () => request<{ items: Artist[] }>('/artists?limit=200'),
  artist: (id: string) => request<ArtistDetail>(`/artists/${id}`),
  search: (q: string) => request<SearchResults>(`/search?${query({ q })}`),
  deezerSearch: (q: string) => request<DeezerTrack[]>(`/deezer/search?${query({ q })}`),
  download: (url: string) =>
    request<{ queued: boolean }>('/downloads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }),
  rescan: () => request<{ started: boolean }>('/library/scan', { method: 'POST' }),
  streamUrl: (trackId: string) => `${API_URL}/tracks/${trackId}/stream`,
  coverUrl: (trackId: string | null) => (trackId ? `${API_URL}/tracks/${trackId}/cover` : null),
}
