import { useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { images, type Track } from '../api'
import { formatAddedAt, formatDuration } from '../format'
import { ClockIcon, PauseIcon, PlayIcon } from '../icons'
import { usePlayer } from '../player/context'
import { Cover } from './Cover'
import { HeartButton } from './HeartButton'
import { TrackMenu } from './TrackMenu'

interface TrackListProps {
  tracks: Track[]
  contextId: string
  /**
   * album: no covers, numbered by track number. full: every column.
   * compact: numbered, no header. search: no numbers, play button over the cover.
   */
  variant?: 'album' | 'full' | 'compact' | 'search'
  /** Row keys when tracks can repeat (playlist entries); defaults to track ids. */
  rowKeys?: string[]
  /** Playlist editing: remove the row at this index. */
  onRemove?: (index: number) => void
  /** Playlist editing: move row `from` before row `before` (tracks.length = to the end). */
  onMove?: (from: number, before: number) => void
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

export function TrackList({ tracks, contextId, variant = 'full', rowKeys, onRemove, onMove }: TrackListProps) {
  const { current, playing, playTracks, toggle } = usePlayer()
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropBefore, setDropBefore] = useState<number | null>(null)
  const showCover = variant !== 'album'
  const showIndex = variant !== 'search'
  const showAlbum = variant === 'full'
  const showAdded = variant === 'full'

  const onPlay = (index: number) => {
    if (current?.id === tracks[index].id) toggle()
    else playTracks(tracks, index, contextId)
  }

  const dragHandlers = (i: number) =>
    onMove && {
      draggable: true,
      onDragStart: (e: DragEvent) => {
        setDragFrom(i)
        e.dataTransfer.effectAllowed = 'move'
      },
      onDragOver: (e: DragEvent<HTMLDivElement>) => {
        if (dragFrom === null) return
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        // Upper half of a row drops before it, lower half after it.
        setDropBefore(e.clientY < rect.top + rect.height / 2 ? i : i + 1)
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        if (dragFrom !== null && dropBefore !== null && dropBefore !== dragFrom && dropBefore !== dragFrom + 1) {
          onMove(dragFrom, dropBefore)
        }
        setDragFrom(null)
        setDropBefore(null)
      },
      onDragEnd: () => {
        setDragFrom(null)
        setDropBefore(null)
      },
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
        const dropClass =
          dropBefore === i ? ' drop-before' : dropBefore === i + 1 && i === tracks.length - 1 ? ' drop-after' : ''
        return (
          <div
            key={rowKeys?.[i] ?? track.id}
            className={`tracklist-row${isCurrent ? ' current' : ''}${dragFrom === i ? ' dragging' : ''}${dropClass}`}
            role="row"
            onDoubleClick={() => playTracks(tracks, i, contextId)}
            {...dragHandlers(i)}
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
                  <Cover src={images.track(track)} size={40} />
                  <button
                    className="cover-play"
                    onClick={() => onPlay(i)}
                    aria-label={isPlaying ? 'Pause' : `Lire ${track.title}`}
                  >
                    {isPlaying ? <PauseIcon /> : <PlayIcon />}
                  </button>
                </span>
              )}
              {showCover && showIndex && <Cover src={images.track(track)} size={40} />}
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
            <span className="col-duration">
              <HeartButton trackId={track.id} />
              <span className="duration-text">{formatDuration(track.durationSec)}</span>
              <TrackMenu track={track} onRemoveFromPlaylist={onRemove && (() => onRemove(i))} />
            </span>
          </div>
        )
      })}
    </div>
  )
}
