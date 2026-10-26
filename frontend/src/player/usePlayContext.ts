import { useCallback } from 'react'
import { api, type Track } from '../api'
import { usePlayer } from './context'

/** Play/pause an album or artist from a card or header, Spotify-style. */
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
    playTracks: (id: string, tracks: Track[]) => play(id, async () => tracks),
  }
}
