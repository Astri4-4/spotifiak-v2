import { useState } from 'react'
import { Link } from 'react-router-dom'
import { images, type Episode } from '../api'
import { formatEpisodeDate, formatListenTime } from '../format'
import { CheckIcon, PauseIcon, PlayIcon, PlusIcon, RefreshIcon } from '../icons'
import { usePlayer, useProgress } from '../player/context'
import { markPlayed, progressOf, usePlayEpisode } from '../podcasts'
import { useCollection } from '../collection/context'
import { Cover } from './Cover'

function ProgressBar({ position, duration }: { position: number; duration: number }) {
  return (
    <span className="episode-progress" aria-hidden="true">
      <span style={{ width: `${Math.min(100, (position / duration) * 100)}%` }} />
    </span>
  )
}

/** Time left in the episode playing, updated as it plays. */
function LiveRemaining({ fallback }: { fallback: number }) {
  const { currentTime, duration } = useProgress()
  const total = duration || fallback
  return (
    <>
      <span>Il reste {formatListenTime(total - currentTime)}</span>
      <ProgressBar position={currentTime} duration={total} />
    </>
  )
}

/** What the creator of a podcast can do with its videos. */
export interface EpisodeActions {
  retry: (episode: Episode) => void
  remove: (episode: Episode) => void
}

/** A video of a created podcast that isn't playable yet. */
function DownloadStatus({ episode, actions }: { episode: Episode; actions?: EpisodeActions }) {
  if (episode.status === 'failed') {
    return (
      <span className="episode-meta">
        <span className="error">Échec du téléchargement{episode.error && ` : ${episode.error}`}</span>
        {actions && (
          <button className="text-button" onClick={() => actions.retry(episode)}>
            Réessayer
          </button>
        )}
      </span>
    )
  }
  return (
    <span className="episode-meta">
      <RefreshIcon className="spin" />
      <span>{episode.status === 'downloading' ? 'Téléchargement de l’audio…' : 'En attente de téléchargement…'}</span>
    </span>
  )
}

interface EpisodeRowProps {
  episode: Episode
  showPodcast: boolean
  actions?: EpisodeActions
}

function EpisodeRow({ episode, showPodcast, actions }: EpisodeRowProps) {
  const { current } = usePlayer()
  const { notify } = useCollection()
  const { isPlaying, play } = usePlayEpisode()
  // Re-rendered after "mark as played", which only changes the saved progress.
  const [, setVersion] = useState(0)
  const progress = progressOf(episode)
  const isCurrent = current?.id === episode.id
  const playing = isPlaying(episode)
  const duration = episode.durationSec ?? 0
  const started = !!progress && !progress.completed && progress.positionSec > 0
  const ready = episode.status === 'ready'

  const toggleCompleted = () => {
    const completed = !progress?.completed
    markPlayed(episode, completed)
      .then(() => setVersion((v) => v + 1))
      .catch(() => notify("Impossible d'enregistrer l'écoute"))
  }

  return (
    <li className={`episode-row${isCurrent ? ' current' : ''}`}>
      <Cover src={images.episode(episode)} className="episode-cover" />
      <div className="episode-body">
        <span className="episode-title">
          {episode.sourceUrl ? (
            <a href={episode.sourceUrl} target="_blank" rel="noreferrer" title="Voir la vidéo sur YouTube">
              {episode.title}
            </a>
          ) : (
            episode.title
          )}
        </span>
        {showPodcast && (
          <Link to={`/podcast/${episode.podcast.id}`} className="episode-podcast">
            {episode.podcast.title}
          </Link>
        )}
        {episode.description && <p className="episode-description">{episode.description}</p>}
        <div className="episode-footer">
          {!ready ? (
            <DownloadStatus episode={episode} actions={actions} />
          ) : (
            <>
              <button className="episode-play" onClick={() => play(episode)} aria-label={playing ? 'Pause' : `Lire ${episode.title}`}>
                {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
              </button>
              <span className="episode-meta">
                <span>{formatEpisodeDate(episode.publishedAt)}</span>
                {progress?.completed && !isCurrent ? (
                  <span className="episode-done">
                    <CheckIcon size={12} /> Écouté
                  </span>
                ) : isCurrent ? (
                  <LiveRemaining fallback={duration} />
                ) : started && duration ? (
                  <>
                    <span>Il reste {formatListenTime(duration - progress.positionSec)}</span>
                    <ProgressBar position={progress.positionSec} duration={duration} />
                  </>
                ) : (
                  duration > 0 && <span>{formatListenTime(duration)}</span>
                )}
              </span>
              <button
                className={`icon-button episode-mark${progress?.completed ? ' done' : ''}`}
                onClick={toggleCompleted}
                aria-pressed={!!progress?.completed}
                aria-label={progress?.completed ? 'Marquer comme non écouté' : 'Marquer comme écouté'}
                title={progress?.completed ? 'Marquer comme non écouté' : 'Marquer comme écouté'}
              >
                <CheckIcon size={16} />
              </button>
            </>
          )}
          {actions && (
            <button
              className="icon-button episode-mark"
              onClick={() => actions.remove(episode)}
              aria-label={`Retirer ${episode.title} du podcast`}
              title="Retirer du podcast"
            >
              <PlusIcon size={16} style={{ transform: 'rotate(45deg)' }} />
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

/** Episodes, Spotify style: artwork, title, description, then play, date and time left. */
export function EpisodeList({
  episodes,
  showPodcast = false,
  actions,
}: {
  episodes: Episode[]
  showPodcast?: boolean
  actions?: EpisodeActions
}) {
  return (
    <ul className="episode-list">
      {episodes.map((e) => (
        <EpisodeRow key={e.id} episode={e} showPodcast={showPodcast} actions={actions} />
      ))}
    </ul>
  )
}
