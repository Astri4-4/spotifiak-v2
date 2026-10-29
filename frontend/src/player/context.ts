import { createContext, useContext } from 'react'
import type { Track } from '../api'

export type RepeatMode = 'off' | 'all' | 'one'

export interface PlayerState {
  current: Track | null
  /** Identifies what is playing (album id, artist id, "liked"...) to highlight its play button. */
  contextId: string | null
  /** Its name ("Ma playlist"), when known: a Jam shows where its next tracks come from. */
  contextName: string | null
  playing: boolean
  queue: Track[]
  upNext: Track[]
  shuffle: boolean
  repeat: RepeatMode
  volume: number
  muted: boolean
  /** In a Jam: playback follows the shared queue; shuffle and repeat are off. */
  inJam: boolean
  /** Podcast playback speed (music always plays at 1×). */
  rate: number
  setRate: (rate: number) => void
  /** Moves forward (or back, when negative) by this many seconds. */
  skip: (seconds: number) => void
  playTracks: (tracks: Track[], startIndex?: number, contextId?: string, contextName?: string) => void
  /** Plays the tracks in a random order (and turns shuffle on). */
  playShuffled: (tracks: Track[], contextId?: string, contextName?: string) => void
  /** Reorders what plays next: upNext[from] goes before upNext[before]. */
  moveInQueue: (from: number, before: number) => void
  /** "Ajouter à la file d'attente": after the queue's last track. */
  addToQueue: (tracks: Track[]) => void
  toggle: () => void
  next: () => void
  prev: () => void
  seek: (seconds: number) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
}

export interface ProgressState {
  currentTime: number
  duration: number
}

export const PlayerContext = createContext<PlayerState | null>(null)
export const ProgressContext = createContext<ProgressState>({ currentTime: 0, duration: 0 })

export function usePlayer() {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider')
  return ctx
}

export function useProgress() {
  return useContext(ProgressContext)
}
