import { createContext, useContext } from 'react'
import type { PlaylistSummary } from '../api'

export interface CollectionState {
  likedIds: Set<string>
  /** Bumped whenever likes change, so the liked tracks page can reload. */
  likesVersion: number
  toggleLike: (trackId: string) => void
  /** Reloads likes from the server (after an import added some). */
  refreshLikes: () => void
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
