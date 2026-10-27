import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, images } from '../api'
import { Card } from '../components/Card'
import { Cover } from '../components/Cover'
import { FollowButton } from '../components/LibraryButtons'
import { PlayButton } from '../components/PlayButton'
import { Shelf } from '../components/Shelf'
import { TrackList } from '../components/TrackList'
import { pluralize } from '../format'
import { useDominantColor, useFetch } from '../hooks'
import { usePlayContext } from '../player/usePlayContext'

const POPULAR_COLLAPSED = 5

// Keyed by id so per-artist state (header color, "Plus") starts fresh on navigation.
export function ArtistPage() {
  const { id = '' } = useParams()
  return <ArtistView key={id} id={id} />
}

function ArtistView({ id }: { id: string }) {
  const { data: artist, error } = useFetch(() => api.artist(id), [id])
  const { color, fromImage } = useDominantColor()
  const { isPlaying, playTracks, playAlbum } = usePlayContext()
  const [showAll, setShowAll] = useState(false)

  if (error) return <div className="page page-inner error">Artiste introuvable.</div>
  if (!artist) return <div className="page" />

  const popular = showAll ? artist.tracks : artist.tracks.slice(0, POPULAR_COLLAPSED)

  return (
    <div className="page" style={{ '--header-color': color } as React.CSSProperties}>
      <header className="entity-header">
        <Cover src={images.artist(artist)} quality="lg" className="entity-cover" round onLoad={fromImage} />
        <div className="entity-info">
          <span className="entity-type">Artiste</span>
          <h1 className={`entity-title${artist.name.length > 24 ? ' long' : ''}`}>{artist.name}</h1>
          <div className="entity-meta">
            <span>
              {pluralize(artist.albums.length, 'album')} • {pluralize(artist.tracks.length, 'titre')} dans votre
              bibliothèque
            </span>
          </div>
        </div>
      </header>

      <div className="action-bar">
        <PlayButton size="lg" playing={isPlaying(artist.id)} onClick={() => void playTracks(artist.id, artist.tracks)} />
        <FollowButton artist={artist} />
      </div>

      <div className="page-inner">
        {artist.tracks.length > 0 && (
          <section>
            <h2 className="section-title">Populaires</h2>
            <TrackList tracks={popular} contextId={artist.id} variant="compact" />
            {artist.tracks.length > POPULAR_COLLAPSED && (
              <button className="text-button" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Moins' : 'Plus'}
              </button>
            )}
          </section>
        )}

        {artist.albums.length > 0 && (
          <Shelf title="Discographie">
            {artist.albums.map((album) => (
              <Card
                key={album.id}
                to={`/album/${album.id}`}
                title={album.title}
                subtitle={[album.year, 'Album'].filter(Boolean).join(' • ')}
                image={images.album(album)}
                playing={isPlaying(album.id)}
                onPlay={() => void playAlbum(album.id)}
              />
            ))}
          </Shelf>
        )}
      </div>
    </div>
  )
}
