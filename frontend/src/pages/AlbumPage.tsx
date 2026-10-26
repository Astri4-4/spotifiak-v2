import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { Cover } from '../components/Cover'
import { PlayButton } from '../components/PlayButton'
import { TrackList } from '../components/TrackList'
import { formatTotalDuration, pluralize } from '../format'
import { useDominantColor, useFetch } from '../hooks'
import { usePlayContext } from '../player/usePlayContext'

// Keyed by id so per-album state (header color) starts fresh on navigation.
export function AlbumPage() {
  const { id = '' } = useParams()
  return <AlbumView key={id} id={id} />
}

function AlbumView({ id }: { id: string }) {
  const { data: album, error } = useFetch(() => api.album(id), [id])
  const { color, fromImage } = useDominantColor()
  const { isPlaying, playTracks } = usePlayContext()

  if (error) return <div className="page page-inner error">Album introuvable.</div>
  if (!album) return <div className="page" />

  const total = album.tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0)

  return (
    <div className="page" style={{ '--header-color': color } as React.CSSProperties}>
      <header className="entity-header">
        <Cover trackId={album.coverTrackId} className="entity-cover" onLoad={fromImage} />
        <div className="entity-info">
          <span className="entity-type">Album</span>
          <h1 className={`entity-title${album.title.length > 24 ? ' long' : ''}`}>{album.title}</h1>
          <div className="entity-meta">
            <Cover trackId={album.coverTrackId} size={24} round />
            <Link to={`/artist/${album.artist.id}`} className="entity-meta-artist">
              {album.artist.name}
            </Link>
            {album.year && <span>• {album.year}</span>}
            <span>
              • {pluralize(album.trackCount, 'titre')}, <span className="muted">{formatTotalDuration(total)}</span>
            </span>
          </div>
        </div>
      </header>

      <div className="action-bar">
        <PlayButton size="lg" playing={isPlaying(album.id)} onClick={() => void playTracks(album.id, album.tracks)} />
      </div>

      <div className="page-inner">
        <TrackList tracks={album.tracks} contextId={album.id} variant="album" />
        {album.year && <p className="album-footer">© {album.year}</p>}
      </div>
    </div>
  )
}
