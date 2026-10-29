// Same origin by default: nginx (production) and Vite (development) proxy /api to the
// API, so the session cookie also reaches <audio> and <img> requests.
const API_URL = import.meta.env.VITE_API_URL ?? '/api'

export type Role = 'admin' | 'user'

export interface User {
  id: string
  username: string
  displayName: string
  role: Role
}

export interface ManagedUser extends User {
  createdAt: string
  lastSeenAt: string | null
}

export interface AuthStatus {
  user: User | null
  needsSetup: boolean
  signupOpen: boolean
}

/** Fired when the API answers 401: the session expired or was revoked. */
export const UNAUTHORIZED_EVENT = 'spotifiak:unauthorized'

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

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
  /** File extension ("flac"); absent on podcast episodes. */
  format?: string
  /** Set when this is a podcast episode played through the player (see podcasts.ts). */
  episode?: { podcastId: string; audioUrl: string; startAt: number }
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

/** An album in the user's library; savedAt orders the library. */
export interface SavedAlbum extends Album {
  savedAt: string
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

export interface FollowedArtist extends Artist {
  followedAt: string
}

export interface ArtistDetail extends Artist {
  albums: Album[]
  tracks: Track[]
}

export interface MosaicCover {
  trackId: string
  coverUrl: string | null
}

export interface PlaylistSummary {
  id: string
  name: string
  description: string | null
  /** Listed for, and playable by, every account. */
  public: boolean
  updatedAt: string
  trackCount: number
  covers: MosaicCover[]
}

/** Another account's public playlist. */
export interface PublicPlaylist extends Omit<PlaylistSummary, 'public'> {
  owner: { displayName: string }
}

export interface PlaylistEntry {
  id: string
  /** addedAt is when the entry was added to the playlist. */
  track: Track
}

export interface PlaylistDetail {
  id: string
  name: string
  description: string | null
  public: boolean
  /** Only the owner edits it; others see it once it is public. */
  owned: boolean
  updatedAt: string
  owner: { displayName: string }
  covers: MosaicCover[]
  entries: PlaylistEntry[]
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

export interface DuplicateCopy {
  id: string
  title: string
  artistName: string
  album: { id: string; title: string } | null
  durationSec: number | null
  path: string
  fileSize: number
  format: string
  bitrateKbps: number | null
}

/** Copies of the same track, best one first. */
export interface DuplicateGroup {
  tracks: DuplicateCopy[]
}

export interface JamPerson {
  id: string
  displayName: string
}

export interface JamEntry {
  id: string
  track: Track
  addedBy: JamPerson
}

/** A shared listening session; position is in seconds when the server sent it. */
export interface JamState {
  id: string
  host: JamPerson
  participants: JamPerson[]
  /** Played tracks, the current one (at index), then the tracks added to the queue. */
  queue: JamEntry[]
  index: number
  /** The rest of what was launched (a playlist...): plays once the queue is empty. */
  fallback: JamEntry[]
  fallbackName: string | null
  playing: boolean
  position: number
}

/** What a Jam starts with: the tracks after `index` become its fallback. */
export interface JamStart {
  trackIds: string[]
  index: number
  position: number
  playing: boolean
  source?: string
}

export interface JamInvite {
  id: string
  host: JamPerson
  participants: JamPerson[]
  joined: boolean
}

export type JamCommand =
  | { type: 'play' | 'pause'; position?: number }
  | { type: 'seek'; position: number }
  | { type: 'next' | 'prev' }
  | { type: 'ended' | 'jump' | 'remove'; entryId: string }
  | { type: 'add'; trackIds: string[] }
  | { type: 'playTracks'; trackIds: string[]; index: number; source?: string }
  /** Within the queue or within the fallback: before another entry, or at the end (null). */
  | { type: 'move'; entryId: string; beforeEntryId: string | null }

export interface PodcastSummary {
  id: string
  title: string
  author: string | null
  hasImage: boolean
}

export interface SubscribedPodcast extends PodcastSummary {
  subscribedAt: string
}

export interface EpisodeProgress {
  positionSec: number
  completed: boolean
}

export interface Episode {
  id: string
  title: string
  /** Plain text, shortened. */
  description: string | null
  durationSec: number | null
  publishedAt: string
  /** null for a YouTube video of a created podcast: the API serves its audio. */
  audioUrl: string | null
  sourceUrl: string | null
  /** Videos of created podcasts are downloaded first; feed episodes are always ready. */
  status: 'ready' | 'queued' | 'downloading' | 'failed'
  error: string | null
  hasImage: boolean
  podcast: { id: string; title: string }
  progress: EpisodeProgress | null
}

export interface PodcastDetail extends PodcastSummary {
  description: string | null
  link: string | null
  /** null for podcasts created in Spotifiak. */
  feedUrl: string | null
  /** Created by this account: it adds videos, edits and deletes it. */
  owned: boolean
  subscribed: boolean
  episodeCount: number
  /** Most recent first, at most 300. */
  episodes: Episode[]
}

/** From the podcast directory; podcastId is set when Spotifiak already knows the feed. */
export interface PodcastSearchResult {
  feedUrl: string
  title: string
  author: string | null
  imageUrl: string | null
  podcastId: string | null
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
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include', ...init })
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(body?.error ?? `${init?.method ?? 'GET'} ${path} failed: ${res.status}`, res.status)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export const auth = {
  status: () => request<AuthStatus>('/auth/status'),
  login: (username: string, password: string) => send<{ user: User }>('POST', '/auth/login', { username, password }),
  register: (username: string, password: string, displayName?: string) =>
    send<{ user: User }>('POST', '/auth/register', { username, password, displayName }),
  logout: () => send<{ ok: true }>('POST', '/auth/logout'),
  updateProfile: (displayName: string) => send<{ user: User }>('PATCH', '/me', { displayName }),
  changePassword: (currentPassword: string, newPassword: string) =>
    send<{ ok: true }>('POST', '/me/password', { currentPassword, newPassword }),
}

export const collection = {
  likedIds: () => request<string[]>('/me/likes/ids'),
  /** addedAt is when each track was liked. */
  liked: () => request<Track[]>('/me/likes'),
  like: (trackId: string) => send<void>('PUT', `/me/likes/${trackId}`),
  unlike: (trackId: string) => send<void>('DELETE', `/me/likes/${trackId}`),
  savedAlbums: () => request<SavedAlbum[]>('/me/albums'),
  saveAlbum: (id: string) => send<void>('PUT', `/me/albums/${id}`),
  unsaveAlbum: (id: string) => send<void>('DELETE', `/me/albums/${id}`),
  followedArtists: () => request<FollowedArtist[]>('/me/artists'),
  followArtist: (id: string) => send<void>('PUT', `/me/artists/${id}`),
  unfollowArtist: (id: string) => send<void>('DELETE', `/me/artists/${id}`),
  playlists: () => request<PlaylistSummary[]>('/playlists'),
  publicPlaylists: () => request<PublicPlaylist[]>('/playlists/public'),
  playlist: (id: string) => request<PlaylistDetail>(`/playlists/${id}`),
  createPlaylist: (name?: string) => send<{ id: string; name: string }>('POST', '/playlists', { name }),
  updatePlaylist: (id: string, data: { name?: string; description?: string; public?: boolean }) =>
    send<{ id: string; name: string; description: string | null; public: boolean }>('PATCH', `/playlists/${id}`, data),
  deletePlaylist: (id: string) => send<void>('DELETE', `/playlists/${id}`),
  addToPlaylist: (id: string, trackIds: string[]) =>
    send<{ added: number }>('POST', `/playlists/${id}/tracks`, { trackIds }),
  removeFromPlaylist: (id: string, entryId: string) => send<void>('DELETE', `/playlists/${id}/tracks/${entryId}`),
  /** Moves an entry before `beforeEntryId`, or to the end when null. */
  moveInPlaylist: (id: string, entryId: string, beforeEntryId: string | null) =>
    send<void>('PATCH', `/playlists/${id}/tracks/${entryId}`, { beforeEntryId }),
}

export interface SpotifyStatus {
  configured: boolean
  /** Only sent to admins, to register it in the Spotify app. */
  redirectUri: string | null
  account: { displayName: string | null; spotifyUserId: string; connectedAt: string } | null
}

export interface SpotifyPlaylist {
  id: string
  name: string
  owner: string
  total: number
  image: string | null
  importable: boolean
  importedPlaylistId: string | null
}

export type ImportStatus = 'running' | 'waiting' | 'done' | 'failed'

export interface SpotifyImport {
  id: string
  name: string
  liked: boolean
  status: ImportStatus
  error: string | null
  playlistId: string | null
  createdAt: string
  total: number
  counts: { pending: number; matched: number; queued: number; not_found: number }
}

export interface MissingTrack {
  id: string
  title: string
  artist: string
  album: string | null
  status: 'queued' | 'not_found'
}

export const spotify = {
  status: () => request<SpotifyStatus>('/spotify/status'),
  authorizeUrl: () => request<{ url: string }>('/spotify/authorize'),
  disconnect: () => send<void>('DELETE', '/spotify/connection'),
  playlists: () => request<{ likedTotal: number; playlists: SpotifyPlaylist[] }>('/spotify/playlists'),
  importPlaylist: (playlistId: string, name: string) =>
    send<{ id: string; playlistId: string | null }>('POST', '/spotify/imports', { playlistId, name }),
  importLiked: () => send<{ id: string; playlistId: null }>('POST', '/spotify/imports', { liked: true }),
  imports: () => request<SpotifyImport[]>('/spotify/imports'),
  missing: (importId: string) => request<MissingTrack[]>(`/spotify/imports/${importId}/missing`),
}

export const jam = {
  current: () => request<JamState | null>('/jam/current'),
  start: (initial: JamStart) =>
    send<JamState>('POST', '/jam', initial),
  invite: (id: string) => request<JamInvite>(`/jam/${encodeURIComponent(id)}`),
  join: (id: string) => send<JamState>('POST', `/jam/${encodeURIComponent(id)}/join`),
  leave: (id: string) => send<void>('POST', `/jam/${id}/leave`),
  remove: (id: string, userId: string) => send<void>('DELETE', `/jam/${id}/participants/${userId}`),
  command: (id: string, command: JamCommand) => send<void>('POST', `/jam/${id}/commands`, command),
  eventsUrl: (id: string) => `${API_URL}/jam/${id}/events`,
}

export const podcasts = {
  search: (q: string) => request<PodcastSearchResult[]>(`/podcasts/search?${query({ q })}`),
  /** Reads the feed the first time; returns the podcast's id. */
  open: (feedUrl: string) => send<{ id: string }>('POST', '/podcasts', { feedUrl }),
  get: (id: string) => request<PodcastDetail>(`/podcasts/${id}`),
  subscriptions: () => request<SubscribedPodcast[]>('/me/podcasts'),
  subscribe: (id: string) => send<void>('PUT', `/me/podcasts/${id}`),
  unsubscribe: (id: string) => send<void>('DELETE', `/me/podcasts/${id}`),
  /** Unfinished episodes of the subscribed podcasts, newest first. */
  newEpisodes: () => request<Episode[]>('/me/podcasts/episodes'),
  saveProgress: (episodeId: string, progress: EpisodeProgress) =>
    send<void>('PUT', `/me/episodes/${episodeId}/progress`, progress),
  audioUrl: (episodeId: string) => `${API_URL}/episodes/${episodeId}/audio`,
  // Podcasts made of YouTube videos
  creation: () => request<{ enabled: boolean }>('/podcasts/creation'),
  create: () => send<{ id: string; title: string }>('POST', '/podcasts/created'),
  update: (id: string, data: { title?: string; description?: string }) => send<void>('PATCH', `/podcasts/${id}`, data),
  remove: (id: string) => send<void>('DELETE', `/podcasts/${id}`),
  /** A video or a whole playlist: skipped counts its videos already in the podcast. */
  addVideo: (id: string, url: string) =>
    send<{ added: number; skipped: number }>('POST', `/podcasts/${id}/episodes`, { url }),
  retry: (id: string, episodeId: string) => send<void>('POST', `/podcasts/${id}/episodes/${episodeId}/retry`),
  removeEpisode: (id: string, episodeId: string) => send<void>('DELETE', `/podcasts/${id}/episodes/${episodeId}`),
}

export const users = {
  list: () => request<ManagedUser[]>('/users'),
  create: (data: { username: string; password: string; displayName?: string; role: Role }) =>
    send<{ user: User }>('POST', '/users', data),
  update: (id: string, data: { role?: Role; password?: string; displayName?: string }) =>
    send<{ user: User }>('PATCH', `/users/${id}`, data),
  remove: (id: string) => send<void>('DELETE', `/users/${id}`),
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
  download: (url: string) => send<{ queued: boolean }>('POST', '/downloads', { url }),
  scanStatus: () => request<ScanStatus>('/library/scan'),
  startScan: (mode: ScanMode) => send<{ started: boolean }>('POST', `/library/scan?full=${mode === 'full'}`),
  duplicates: () => request<DuplicateGroup[]>('/library/duplicates'),
  removeDuplicates: (groups: { keepId: string; removeIds: string[] }[]) =>
    send<{ removed: number; failed: { path: string; error: string }[] }>('POST', '/library/duplicates/resolve', { groups }),
  streamUrl: (trackId: string) => `${API_URL}/tracks/${trackId}/stream`,
}

const fileCover = (trackId: string | null) => (trackId ? `${API_URL}/tracks/${trackId}/cover` : null)

/** Deezer images when matched, otherwise the art from the audio files. */
export const images = {
  track: (t: Track) => (t.episode ? `${API_URL}/episodes/${t.id}/image` : (t.album?.coverUrl ?? fileCover(t.id))),
  album: (a: Album) => a.coverUrl ?? fileCover(a.coverTrackId),
  artist: (a: Artist) => a.pictureUrl ?? fileCover(a.coverTrackId),
  mosaic: (c: MosaicCover) => c.coverUrl ?? fileCover(c.trackId),
  // Podcast artwork goes through the API: publishers' servers rarely allow CORS.
  podcast: (p: PodcastSummary) => (p.hasImage ? `${API_URL}/podcasts/${p.id}/image` : null),
  episode: (e: Episode) => (e.hasImage ? `${API_URL}/episodes/${e.id}/image` : null),
}
