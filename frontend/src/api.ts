const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export interface Track {
  id: string
  title: string
  artistName: string
  artistId: string
  album: { id: string; title: string; coverUrl: string | null } | null
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
  /** From Deezer; null when not matched (then the file art is used). */
  coverUrl: string | null
  artist: { id: string; name: string; pictureUrl: string | null }
  coverTrackId: string | null
  trackCount: number
}

export interface AlbumDetail extends Album {
  tracks: Track[]
}

export interface Artist {
  id: string
  name: string
  /** From Deezer (or one of the artist's album covers); null when not matched. */
  pictureUrl: string | null
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

export type ScanMode = 'quick' | 'full'

export interface ScanStatus {
  running: boolean
  mode: ScanMode | null
  phase: 'listing' | 'indexing' | 'cleanup' | null
  dirsListed: number
  progress: { done: number; total: number; startedAt: string } | null
  lastStartedAt: string | null
  lastFinishedAt: string | null
  lastDurationMs: number | null
  lastMode: ScanMode | null
  lastResult: { added: number; updated: number; removed: number; failed: number; files: number; checked: number } | null
  lastError: string | null
  enrichment: {
    enabled: boolean
    running: boolean
    albums: { done: number; total: number; matched: number }
    artists: { done: number; total: number; matched: number }
    lastFinishedAt: string | null
    lastFailed: number
  }
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
  scanStatus: () => request<ScanStatus>('/library/scan'),
  startScan: (mode: ScanMode) =>
    request<{ started: boolean }>(`/library/scan?full=${mode === 'full'}`, { method: 'POST' }),
  streamUrl: (trackId: string) => `${API_URL}/tracks/${trackId}/stream`,
}

const fileCover = (trackId: string | null) => (trackId ? `${API_URL}/tracks/${trackId}/cover` : null)

/** Deezer images when matched, otherwise the art from the audio files. */
export const images = {
  track: (t: Track) => t.album?.coverUrl ?? fileCover(t.id),
  album: (a: Album) => a.coverUrl ?? fileCover(a.coverTrackId),
  artist: (a: Artist) => a.pictureUrl ?? fileCover(a.coverTrackId),
}
