import { useState } from 'react'
import { Link } from 'react-router-dom'
import { images } from '../api'
import { formatDuration } from '../format'
import {
  JamIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  VolumeIcon,
  VolumeMuteIcon,
} from '../icons'
import { useJam } from '../jam/context'
import { usePlayer, useProgress } from '../player/context'
import { Cover } from './Cover'
import { HeartButton } from './HeartButton'
import { Slider } from './Slider'

interface PlayerBarProps {
  queueOpen: boolean
  onToggleQueue: () => void
}

export function Progress() {
  const { seek } = usePlayer()
  const { currentTime, duration } = useProgress()
  const [preview, setPreview] = useState<number | null>(null)

  return (
    <div className="progress">
      <span className="time">{formatDuration(preview ?? currentTime)}</span>
      <Slider value={currentTime} max={duration} onChange={seek} onPreview={setPreview} label="Progression" />
      <span className="time">{formatDuration(duration)}</span>
    </div>
  )
}

/** Shuffle, previous, play/pause, next, repeat. Bigger icons in the phone player. */
export function ControlButtons({ iconSize = 16 }: { iconSize?: number }) {
  const p = usePlayer()
  const disabled = !p.current

  return (
    <div className="control-buttons">
      <button
        className={`control${p.shuffle ? ' active' : ''}`}
        onClick={p.toggleShuffle}
        disabled={disabled || p.inJam}
        aria-label={p.shuffle ? 'Désactiver la lecture aléatoire' : 'Activer la lecture aléatoire'}
      >
        <ShuffleIcon size={iconSize} />
      </button>
      <button className="control" onClick={p.prev} disabled={disabled} aria-label="Précédent">
        <PrevIcon size={iconSize} />
      </button>
      <button className="control-play" onClick={p.toggle} disabled={disabled} aria-label={p.playing ? 'Pause' : 'Lecture'}>
        {p.playing ? <PauseIcon size={iconSize} /> : <PlayIcon size={iconSize} />}
      </button>
      <button className="control" onClick={p.next} disabled={disabled} aria-label="Suivant">
        <NextIcon size={iconSize} />
      </button>
      <button
        className={`control${p.repeat !== 'off' ? ' active' : ''}`}
        onClick={p.cycleRepeat}
        disabled={disabled || p.inJam}
        aria-label={
          p.repeat === 'off' ? 'Activer la répétition' : p.repeat === 'all' ? 'Répéter le titre' : 'Désactiver la répétition'
        }
      >
        {p.repeat === 'one' ? <RepeatOneIcon size={iconSize} /> : <RepeatIcon size={iconSize} />}
      </button>
    </div>
  )
}

export function PlayerBar({ queueOpen, onToggleQueue }: PlayerBarProps) {
  const p = usePlayer()
  const { current } = p
  const { jam } = useJam()

  return (
    <footer className="player-bar">
      <div className="now-playing">
        {current && (
          <>
            <Cover src={images.track(current)} size={56} />
            <div className="now-playing-text">
              {current.album ? (
                <Link to={`/album/${current.album.id}`} className="now-playing-title">
                  {current.title}
                </Link>
              ) : (
                <span className="now-playing-title">{current.title}</span>
              )}
              <Link to={`/artist/${current.artistId}`} className="now-playing-artist">
                {current.artistName}
              </Link>
            </div>
            <HeartButton trackId={current.id} className="now-playing-heart" />
          </>
        )}
      </div>

      <div className="controls">
        <ControlButtons />
        <Progress />
      </div>

      <div className="extra-controls">
        {/* The Jam lives at the top of the queue panel. */}
        <button
          className={`control${jam ? ' active' : ''}`}
          onClick={() => !queueOpen && onToggleQueue()}
          aria-label={jam ? `Jam de ${jam.host.displayName}, ${jam.participants.length} participants` : 'Démarrer une Jam'}
          title={jam ? `Jam · ${jam.participants.length} participant${jam.participants.length > 1 ? 's' : ''}` : 'Démarrer une Jam'}
        >
          <JamIcon />
        </button>
        <button
          className={`control${queueOpen ? ' active' : ''}`}
          onClick={onToggleQueue}
          aria-label="File d'attente"
        >
          <QueueIcon />
        </button>
        <button className="control" onClick={p.toggleMute} aria-label={p.muted ? 'Réactiver le son' : 'Couper le son'}>
          {p.muted || p.volume === 0 ? <VolumeMuteIcon /> : <VolumeIcon />}
        </button>
        <div className="volume">
          <Slider value={p.muted ? 0 : p.volume} max={1} onChange={p.setVolume} live label="Volume" />
        </div>
      </div>
    </footer>
  )
}
