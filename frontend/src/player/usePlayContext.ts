import { useCallback } from 'react'
import { api, collection, type Track } from '../api'
import { usePlayer } from './context'

/** Context id of the liked tracks list, for the player's "what is playing" highlight. */
export const LIKED_CONTEXT = 'liked'

/** Play/pause an album, artist or playlist from a card or header, Spotify-style. */
export function usePlayContext() {
  const { contextId, playing, toggle, playTracks, playShuffled } = usePlayer()

  const isPlaying = useCallback((id: string) => playing && contextId === id, [playing, contextId])

  const play = useCallback(
    async (id: string, loadTracks: () => Promise<Track[]>, name?: string) => {
      if (contextId === id) return toggle()
      const tracks = await loadTracks()
      if (tracks.length) playTracks(tracks, 0, id, name)
    },
    [contextId, toggle, playTracks],
  )

  return {
    isPlaying,
    playAlbum: (id: string) => play(id, async () => (await api.album(id)).tracks),
    playArtist: (id: string) => play(id, async () => (await api.artist(id)).tracks),
    // The name goes to a Jam, for "Ensuite, depuis …".
    playPlaylist: (id: string, name?: string) =>
      play(id, async () => (await collection.playlist(id)).entries.map((e) => e.track), name),
    playLiked: () => play(LIKED_CONTEXT, collection.liked, 'Titres likés'),
    playTracks: (id: string, tracks: Track[], name?: string) => play(id, async () => tracks, name),
    /** The shuffle button next to the play button: always starts over, in a random order. */
    playShuffled: (id: string, tracks: Track[], name?: string) => playShuffled(tracks, id, name),
  }
}
