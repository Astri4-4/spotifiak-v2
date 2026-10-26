import { Link } from 'react-router-dom'
import type { Track } from '../api'
import { formatAddedAt, formatDuration } from '../format'
import { ClockIcon, PauseIcon, PlayIcon } from '../icons'
import { usePlayer } from '../player/context'
import { Cover } from './Cover'

interface TrackListProps {
  tracks: Track[]
  contextId: string
  /**
   * album: no covers, numbered by track number. full: every column.
   * compact: numbered, no header. search: no numbers, play button over the cover.
   */
  variant?: 'album' | 'full' | 'compact' | 'search'
}

function Equalizer() {
  return (
    <span className="equalizer" aria-label="En cours de lecture">
      <span />
      <span />
      <span />
      <span />
    </span>
  )
}

export function TrackList({ tracks, contextId, variant = 'full' }: TrackListProps) {
  const { current, playing, playTracks, toggle } = usePlayer()
  const showCover = variant !== 'album'
  const showIndex = variant !== 'search'
  const showAlbum = variant === 'full'
  const showAdded = variant === 'full'

  const onPlay = (index: number) => {
    if (current?.id === tracks[index].id) toggle()
    else playTracks(tracks, index, contextId)
  }

  return (
    <div className={`tracklist tracklist-${variant}`} role="grid">
      {(variant === 'album' || variant === 'full') && (
        <div className="tracklist-header" role="row">
          <span className="col-index">#</span>
          <span>Titre</span>
          {showAlbum && <span>Album</span>}
          {showAdded && <span>Date d'ajout</span>}
          <span className="col-duration" aria-label="Durée">
            <ClockIcon />
          </span>
        </div>
      )}
      {tracks.map((track, i) => {
        const isCurrent = current?.id === track.id
        const isPlaying = isCurrent && playing
        return (
          <div
            key={track.id}
            className={`tracklist-row${isCurrent ? ' current' : ''}`}
            role="row"
            onDoubleClick={() => playTracks(tracks, i, contextId)}
          >
            {showIndex && (
              <span className="col-index">
                <span className="index-number">
                  {isPlaying ? <Equalizer /> : variant === 'album' ? (track.trackNumber ?? i + 1) : i + 1}
                </span>
                <button
                  className="index-play"
                  onClick={() => onPlay(i)}
                  aria-label={isPlaying ? 'Pause' : `Lire ${track.title}`}
                >
                  {isPlaying ? <PauseIcon /> : <PlayIcon />}
                </button>
              </span>
            )}
            <span className="col-title">
              {showCover && !showIndex && (
                <span className="cover-play-wrap">
                  <Cover trackId={track.id} size={40} />
                  <button
                    className="cover-play"
                    onClick={() => onPlay(i)}
                    aria-label={isPlaying ? 'Pause' : `Lire ${track.title}`}
                  >
                    {isPlaying ? <PauseIcon /> : <PlayIcon />}
                  </button>
                </span>
              )}
              {showCover && showIndex && <Cover trackId={track.id} size={40} />}
              <span className="title-text">
                <span className="track-name">{track.title}</span>
                <Link to={`/artist/${track.artistId}`} className="track-artist" onClick={(e) => e.stopPropagation()}>
                  {track.artistName}
                </Link>
              </span>
            </span>
            {showAlbum && (
              <span className="col-album">
                {track.album && <Link to={`/album/${track.album.id}`}>{track.album.title}</Link>}
              </span>
            )}
            {showAdded && <span className="col-added">{formatAddedAt(track.addedAt)}</span>}
            <span className="col-duration">{formatDuration(track.durationSec)}</span>
          </div>
        )
      })}
    </div>
  )
}
