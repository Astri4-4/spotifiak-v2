import { createContext, useContext } from 'react'
import type { Album, Artist, FollowedArtist, PlaylistSummary, PodcastSummary, SavedAlbum, SubscribedPodcast } from '../api'

export interface CollectionState {
  likedIds: Set<string>
  /** Bumped whenever likes change, so the liked tracks page can reload. */
  likesVersion: number
  toggleLike: (trackId: string) => void
  /** Reloads likes from the server (after an import added some). */
  refreshLikes: () => void
  /** Albums saved and artists followed: with playlists, what the library shows. */
  savedAlbums: SavedAlbum[]
  followedArtists: FollowedArtist[]
  toggleSaveAlbum: (album: Album) => void
  toggleFollowArtist: (artist: Artist) => void
  /** Podcasts the user subscribed to, also in the library. */
  podcasts: SubscribedPodcast[]
  toggleSubscribe: (podcast: PodcastSummary) => void
  refreshPodcasts: () => void
  /** Creating podcasts from YouTube videos needs PODCAST_DIR on the server. */
  canCreatePodcast: boolean
  /** Creates a podcast (in the library) and returns its id. */
  createPodcast: () => Promise<string>
  playlists: PlaylistSummary[]
  refreshPlaylists: () => void
  /** Creates a playlist (optionally with tracks) and returns its id. */
  createPlaylist: (trackIds?: string[]) => Promise<string>
  addToPlaylist: (playlist: PlaylistSummary, trackIds: string[]) => Promise<void>
  /** Short confirmation shown above the player, like Spotify's toasts. */
  notify: (message: string) => void
}

export const CollectionContext = createContext<CollectionState | null>(null)

export function useCollection() {
  const ctx = useContext(CollectionContext)
  if (!ctx) throw new Error('useCollection must be used inside CollectionProvider')
  return ctx
}
