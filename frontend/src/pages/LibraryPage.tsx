import { useEffect, useState } from 'react'
import { api, type Track } from '../api'
import { formatDuration } from '../format'
import { usePlayer } from '../player/PlayerContext'

export function LibraryPage() {
  const { current, play } = usePlayer()
  const [tracks, setTracks] = useState<Track[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timeout = setTimeout(() => {
      api
        .tracks(filter.trim() || undefined)
        .then((res) => setTracks(res.items))
        .catch((err: Error) => setError(err.message))
    }, 200)
    return () => clearTimeout(timeout)
  }, [filter])

  const onPlay = (track: Track) =>
    play({ id: track.id, title: track.title, artist: track.artist, cover: api.coverUrl(track.id) })

  return (
    <section>
      <div className="page-header">
        <h2>Your library</h2>
        <button onClick={() => void api.rescan()}>Rescan</button>
      </div>
      <input
        className="filter-input"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by title, artist or album"
      />
      {error && <p className="error">{error}</p>}
      {tracks.length === 0 && !error && <p className="muted">No tracks yet. Download some from Search.</p>}
      <ul className="track-list">
        {tracks.map((track) => (
          <li
            key={track.id}
            onDoubleClick={() => onPlay(track)}
            className={current?.id === track.id ? 'active' : undefined}
          >
            <img src={api.coverUrl(track.id)} alt="" loading="lazy" />
            <div className="track-meta">
              <div className="title">{track.title}</div>
              <div className="artist">
                {track.artist}
                {track.album && ` · ${track.album}`}
              </div>
            </div>
            <span className="muted">{formatDuration(track.durationSec)}</span>
            <button onClick={() => onPlay(track)}>Play</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
