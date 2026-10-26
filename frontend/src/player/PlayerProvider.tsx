import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, type Track } from '../api'
import { storage } from '../storage'
import { PlayerContext, ProgressContext, type PlayerState, type RepeatMode } from './context'

// Like Spotify: "previous" restarts the track unless we're in its first seconds.
const RESTART_THRESHOLD_SEC = 3

function shuffledOrder(length: number, first: number) {
  const rest = [...Array(length).keys()].filter((i) => i !== first)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return [first, ...rest]
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null)

  const [queue, setQueue] = useState<Track[]>([])
  const [order, setOrder] = useState<number[]>([])
  const [pos, setPos] = useState(0)
  // Bumped on every explicit "play this", so replaying the same track restarts it.
  const [loadKey, setLoadKey] = useState(0)
  const [contextId, setContextId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [shuffle, setShuffle] = useState(() => storage.get('shuffle') === 'true')
  const [repeat, setRepeat] = useState<RepeatMode>(() => (storage.get('repeat') as RepeatMode) ?? 'off')
  const [volume, setVolumeState] = useState(() => Number(storage.get('volume') ?? 0.7))
  const [muted, setMuted] = useState(false)
  const [progress, setProgress] = useState({ currentTime: 0, duration: 0 })

  const current = queue[order[pos]] ?? null

  useEffect(() => {
    const el = audio.current
    if (!el || !current) return
    el.src = api.streamUrl(current.id)
    void el.play().catch(() => setPlaying(false))
    // loadKey is intentionally a dependency: it forces a reload of the same track.
  }, [current?.id, loadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (audio.current) audio.current.volume = muted ? 0 : volume
    storage.set('volume', String(volume))
  }, [volume, muted])

  useEffect(() => storage.set('shuffle', String(shuffle)), [shuffle])
  useEffect(() => storage.set('repeat', repeat), [repeat])

  const playTracks = useCallback(
    (tracks: Track[], startIndex = 0, ctx?: string) => {
      setQueue(tracks)
      if (shuffle) {
        setOrder(shuffledOrder(tracks.length, startIndex))
        setPos(0)
      } else {
        setOrder([...tracks.keys()])
        setPos(startIndex)
      }
      setContextId(ctx ?? null)
      setLoadKey((k) => k + 1)
    },
    [shuffle],
  )

  const toggle = useCallback(() => {
    const el = audio.current
    if (!el || !current) return
    if (el.paused) void el.play()
    else el.pause()
  }, [current])

  const advance = useCallback(
    (auto: boolean) => {
      if (!order.length) return
      if (auto && repeat === 'one') {
        setLoadKey((k) => k + 1)
        return
      }
      if (pos + 1 < order.length) setPos(pos + 1)
      else if (repeat === 'all') setPos(0)
      else {
        // End of the queue: stop on the last track, like Spotify.
        audio.current?.pause()
        if (audio.current) audio.current.currentTime = 0
        return
      }
      setLoadKey((k) => k + 1)
    },
    [order.length, pos, repeat],
  )

  const next = useCallback(() => advance(false), [advance])

  const prev = useCallback(() => {
    const el = audio.current
    if (!el) return
    if (el.currentTime > RESTART_THRESHOLD_SEC || (pos === 0 && repeat !== 'all')) {
      el.currentTime = 0
      return
    }
    setPos(pos === 0 ? order.length - 1 : pos - 1)
    setLoadKey((k) => k + 1)
  }, [order.length, pos, repeat])

  const seek = useCallback((seconds: number) => {
    if (audio.current) audio.current.currentTime = seconds
  }, [])

  const setVolume = useCallback((v: number) => {
    setVolumeState(Math.min(1, Math.max(0, v)))
    setMuted(false)
  }, [])

  const toggleMute = useCallback(() => setMuted((m) => !m), [])

  const toggleShuffle = useCallback(() => {
    const currentIndex = order[pos]
    if (shuffle) {
      setOrder([...queue.keys()])
      setPos(currentIndex ?? 0)
    } else if (queue.length) {
      setOrder(shuffledOrder(queue.length, currentIndex ?? 0))
      setPos(0)
    }
    setShuffle(!shuffle)
  }, [order, pos, queue, shuffle])

  const cycleRepeat = useCallback(
    () => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')),
    [],
  )

  // OS media keys, lock screen and headset controls.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const cover = current && api.coverUrl(current.id)
    navigator.mediaSession.metadata = current
      ? new MediaMetadata({
          title: current.title,
          artist: current.artistName,
          album: current.album?.title ?? '',
          artwork: cover ? [{ src: cover }] : [],
        })
      : null
    navigator.mediaSession.setActionHandler('play', toggle)
    navigator.mediaSession.setActionHandler('pause', toggle)
    navigator.mediaSession.setActionHandler('nexttrack', next)
    navigator.mediaSession.setActionHandler('previoustrack', prev)
    navigator.mediaSession.setActionHandler('seekto', (d) => d.seekTime != null && seek(d.seekTime))
  }, [current, toggle, next, prev, seek])

  // Space toggles playback unless the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.code !== 'Space' || target.closest('input, textarea, button, [contenteditable]')) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const upNext = useMemo(() => order.slice(pos + 1).map((i) => queue[i]), [order, pos, queue])

  const state: PlayerState = useMemo(
    () => ({
      current,
      contextId,
      playing,
      queue,
      upNext,
      shuffle,
      repeat,
      volume,
      muted,
      playTracks,
      toggle,
      next,
      prev,
      seek,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
    }),
    [current, contextId, playing, queue, upNext, shuffle, repeat, volume, muted, playTracks, toggle, next, prev, seek, setVolume, toggleMute, toggleShuffle, cycleRepeat],
  )

  return (
    <PlayerContext.Provider value={state}>
      <ProgressContext.Provider value={progress}>
        {children}
        <audio
          ref={audio}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => advance(true)}
          onTimeUpdate={(e) =>
            setProgress({ currentTime: e.currentTarget.currentTime, duration: e.currentTarget.duration || 0 })
          }
          onLoadedMetadata={(e) => setProgress({ currentTime: 0, duration: e.currentTarget.duration || 0 })}
        />
      </ProgressContext.Provider>
    </PlayerContext.Provider>
  )
}
