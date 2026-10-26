import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'

export interface PlayableTrack {
  id: string
  title: string
  artist: string
  cover?: string
}

interface PlayerState {
  current: PlayableTrack | null
  playing: boolean
  play: (track: PlayableTrack) => void
  toggle: () => void
  audio: React.RefObject<HTMLAudioElement | null>
}

const PlayerContext = createContext<PlayerState | null>(null)

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [current, setCurrent] = useState<PlayableTrack | null>(null)
  const [playing, setPlaying] = useState(false)

  const play = (track: PlayableTrack) => {
    const el = audio.current
    if (!el) return
    setCurrent(track)
    el.src = api.streamUrl(track.id)
    void el.play()
  }

  const toggle = () => {
    const el = audio.current
    if (!el || !current) return
    if (el.paused) void el.play()
    else el.pause()
  }

  return (
    <PlayerContext.Provider value={{ current, playing, play, toggle, audio }}>
      {children}
      <audio ref={audio} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
    </PlayerContext.Provider>
  )
}

export function usePlayer() {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider')
  return ctx
}
