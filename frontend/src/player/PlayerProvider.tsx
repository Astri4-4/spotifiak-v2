import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, images, type Track } from '../api'
import { useJam } from '../jam/context'
import { storage } from '../storage'
import { PlayerContext, ProgressContext, type PlayerState, type RepeatMode } from './context'

// Like Spotify: "previous" restarts the track unless we're in its first seconds.
const RESTART_THRESHOLD_SEC = 3
// In a Jam, seek to the shared position when this far off (network delays, slow
// loads); checked on every update and while playing.
const JAM_DRIFT_SEC = 1

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

  // In a Jam the server's queue replaces the local one (see JamProvider).
  const { jam, receivedAt, command } = useJam()
  const jamEntry = jam?.queue[jam.index] ?? null
  const current = jam ? (jamEntry?.track ?? null) : (queue[order[pos]] ?? null)
  const inJam = !!jam

  // Leaving a Jam doesn't resume the local queue from before it (adjusted while
  // rendering, as React recommends for state derived from a change).
  const [wasInJam, setWasInJam] = useState(inJam)
  if (wasInJam !== inJam) {
    setWasInJam(inJam)
    if (!inJam) {
      setQueue([])
      setOrder([])
      setPos(0)
    }
  }

  /** Brings the audio to the Jam's track position and play/pause state. */
  const syncToJam = useCallback(() => {
    const el = audio.current
    if (!el || !jam || !jamEntry) return
    const elapsed = jam.playing ? (performance.now() - receivedAt) / 1000 : 0
    const expected = Math.min(jam.position + elapsed, Number.isFinite(el.duration) ? el.duration : Infinity)
    if (Math.abs(el.currentTime - expected) > JAM_DRIFT_SEC) el.currentTime = expected
    if (jam.playing && el.paused) void el.play().catch(() => setPlaying(false))
    if (!jam.playing && !el.paused) el.pause()
  }, [jam, jamEntry, receivedAt])

  // What to load: the Jam entry (the same track can be queued twice), or the local
  // track; loadKey forces a reload of the same track ("play this" again).
  const source = jam ? `jam:${jamEntry?.id ?? ''}` : `local:${current?.id ?? ''}:${loadKey}`

  useEffect(() => {
    const el = audio.current
    if (!el) return
    if (!current) {
      el.pause()
      el.removeAttribute('src')
      return
    }
    const url = api.streamUrl(current.id)
    // Starting a Jam with the track already playing here: keep it, don't restart it.
    if (!(jam && el.src.endsWith(url))) el.src = url
    if (jam) syncToJam()
    else void el.play().catch(() => setPlaying(false))
  }, [source]) // eslint-disable-line react-hooks/exhaustive-deps

  // Every Jam update (someone paused, skipped, seeked).
  useEffect(() => syncToJam(), [syncToJam])


  useEffect(() => {
    if (audio.current) audio.current.volume = muted ? 0 : volume
    storage.set('volume', String(volume))
  }, [volume, muted])

  useEffect(() => storage.set('shuffle', String(shuffle)), [shuffle])
  useEffect(() => storage.set('repeat', repeat), [repeat])

  const playTracks = useCallback(
    (tracks: Track[], startIndex = 0, ctx?: string) => {
      setContextId(ctx ?? null)
      if (inJam) {
        command({ type: 'playTracks', trackIds: tracks.map((t) => t.id), index: startIndex })
        return
      }
      setQueue(tracks)
      if (shuffle) {
        setOrder(shuffledOrder(tracks.length, startIndex))
        setPos(0)
      } else {
        setOrder([...tracks.keys()])
        setPos(startIndex)
      }
      setLoadKey((k) => k + 1)
    },
    [shuffle, inJam, command],
  )

  const addToQueue = useCallback(
    (tracks: Track[]) => {
      if (inJam) return command({ type: 'add', trackIds: tracks.map((t) => t.id) })
      if (!queue.length) return playTracks(tracks)
      setOrder([...order, ...tracks.map((_, i) => queue.length + i)])
      setQueue([...queue, ...tracks])
    },
    [inJam, command, queue, order, playTracks],
  )

  const toggle = useCallback(() => {
    const el = audio.current
    if (!el || !current) return
    if (jam) {
      // Playing for the others but silent here (autoplay blocked): just listen in.
      if (jam.playing && el.paused) void el.play().catch(() => {})
      else command({ type: jam.playing ? 'pause' : 'play', position: el.currentTime })
      return
    }
    if (el.paused) void el.play()
    else el.pause()
  }, [current, jam, command])

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

  const next = useCallback(() => (inJam ? command({ type: 'next' }) : advance(false)), [inJam, command, advance])

  const onEnded = useCallback(() => {
    if (jamEntry) command({ type: 'ended', entryId: jamEntry.id })
    else if (!inJam) advance(true)
  }, [jamEntry, inJam, command, advance])

  const prev = useCallback(() => {
    const el = audio.current
    if (!el) return
    if (inJam) return command({ type: 'prev' })
    if (el.currentTime > RESTART_THRESHOLD_SEC || (pos === 0 && repeat !== 'all')) {
      el.currentTime = 0
      return
    }
    setPos(pos === 0 ? order.length - 1 : pos - 1)
    setLoadKey((k) => k + 1)
  }, [order.length, pos, repeat, inJam, command])

  const seek = useCallback(
    (seconds: number) => {
      if (audio.current) audio.current.currentTime = seconds
      if (inJam) command({ type: 'seek', position: seconds })
    },
    [inJam, command],
  )

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
    const cover = current && images.track(current)
    navigator.mediaSession.metadata = current
      ? new MediaMetadata({
          title: current.title,
          artist: current.artistName,
          album: current.album?.title ?? '',
          artwork: cover ? [{ src: cover, sizes: '1000x1000' }] : [],
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

  const upNext = useMemo(
    () => (jam ? jam.queue.slice(jam.index + 1).map((e) => e.track) : order.slice(pos + 1).map((i) => queue[i])),
    [jam, order, pos, queue],
  )

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
      inJam,
      playTracks,
      addToQueue,
      toggle,
      next,
      prev,
      seek,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
    }),
    [current, contextId, playing, queue, upNext, shuffle, repeat, volume, muted, inJam, playTracks, addToQueue, toggle, next, prev, seek, setVolume, toggleMute, toggleShuffle, cycleRepeat],
  )

  return (
    <PlayerContext.Provider value={state}>
      <ProgressContext.Provider value={progress}>
        {children}
        <audio
          ref={audio}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={onEnded}
          onTimeUpdate={(e) => {
            setProgress({ currentTime: e.currentTarget.currentTime, duration: e.currentTarget.duration || 0 })
            if (jam?.playing && !e.currentTarget.seeking) syncToJam()
          }}
          onLoadedMetadata={(e) => {
            setProgress({ currentTime: e.currentTarget.currentTime, duration: e.currentTarget.duration || 0 })
            syncToJam()
          }}
        />
      </ProgressContext.Provider>
    </PlayerContext.Provider>
  )
}
