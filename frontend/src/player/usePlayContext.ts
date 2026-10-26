import { useCallback } from 'react'
import { api, collection, type Track } from '../api'
import { usePlayer } from './context'

/** Context id of the liked tracks list, for the player's "what is playing" highlight. */
export const LIKED_CONTEXT = 'liked'

/** Play/pause an album, artist or playlist from a card or header, Spotify-style. */
export function usePlayContext() {
  const { contextId, playing, toggle, playTracks } = usePlayer()

  const isPlaying = useCallback((id: string) => playing && contextId === id, [playing, contextId])

  const play = useCallback(
    async (id: string, loadTracks: () => Promise<Track[]>) => {
      if (contextId === id) return toggle()
      const tracks = await loadTracks()
      if (tracks.length) playTracks(tracks, 0, id)
    },
    [contextId, toggle, playTracks],
  )

  return {
    isPlaying,
    playAlbum: (id: string) => play(id, async () => (await api.album(id)).tracks),
    playArtist: (id: string) => play(id, async () => (await api.artist(id)).tracks),
    playPlaylist: (id: string) => play(id, async () => (await collection.playlist(id)).entries.map((e) => e.track)),
    playLiked: () => play(LIKED_CONTEXT, collection.liked),
    playTracks: (id: string, tracks: Track[]) => play(id, async () => tracks),
  }
}
