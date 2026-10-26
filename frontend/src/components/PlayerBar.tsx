import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDuration } from '../format'
import {
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
import { usePlayer, useProgress } from '../player/context'
import { Cover } from './Cover'
import { Slider } from './Slider'

interface PlayerBarProps {
  queueOpen: boolean
  onToggleQueue: () => void
}

function Progress() {
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

export function PlayerBar({ queueOpen, onToggleQueue }: PlayerBarProps) {
  const p = usePlayer()
  const { current } = p
  const disabled = !current

  return (
    <footer className="player-bar">
      <div className="now-playing">
        {current && (
          <>
            <Cover trackId={current.id} size={56} />
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
          </>
        )}
      </div>

      <div className="controls">
        <div className="control-buttons">
          <button
            className={`control${p.shuffle ? ' active' : ''}`}
            onClick={p.toggleShuffle}
            disabled={disabled}
            aria-label={p.shuffle ? 'Désactiver la lecture aléatoire' : 'Activer la lecture aléatoire'}
          >
            <ShuffleIcon />
          </button>
          <button className="control" onClick={p.prev} disabled={disabled} aria-label="Précédent">
            <PrevIcon />
          </button>
          <button className="control-play" onClick={p.toggle} disabled={disabled} aria-label={p.playing ? 'Pause' : 'Lecture'}>
            {p.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="control" onClick={p.next} disabled={disabled} aria-label="Suivant">
            <NextIcon />
          </button>
          <button
            className={`control${p.repeat !== 'off' ? ' active' : ''}`}
            onClick={p.cycleRepeat}
            disabled={disabled}
            aria-label={
              p.repeat === 'off' ? 'Activer la répétition' : p.repeat === 'all' ? 'Répéter le titre' : 'Désactiver la répétition'
            }
          >
            {p.repeat === 'one' ? <RepeatOneIcon /> : <RepeatIcon />}
          </button>
        </div>
        <Progress />
      </div>

      <div className="extra-controls">
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
