import { Link } from 'react-router-dom'
import { api, images } from '../api'
import { Card } from '../components/Card'
import { Cover } from '../components/Cover'
import { PlayButton } from '../components/PlayButton'
import { Shelf } from '../components/Shelf'
import { useFetch } from '../hooks'
import { usePlayContext } from '../player/usePlayContext'

function greeting() {
  const hour = new Date().getHours()
  if (hour < 5 || hour >= 18) return 'Bonsoir'
  if (hour < 12) return 'Bonjour'
  return 'Bon après-midi'
}

export function HomePage() {
  const { data: albums } = useFetch(() => api.albums().then((r) => r.items), [])
  const { data: artists } = useFetch(() => api.artists().then((r) => r.items), [])
  const { isPlaying, playAlbum, playArtist } = usePlayContext()

  const empty = albums && artists && !albums.length && !artists.length

  return (
    <div className="page home">
      <div className="page-gradient" />
      <div className="page-inner">
        <h1 className="greeting">{greeting()}</h1>

        {empty && (
          <div className="empty-state">
            <h2>Votre bibliothèque est vide</h2>
            <p>Recherchez un titre et téléchargez-le depuis Deezer pour commencer.</p>
            <Link to="/search" className="pill-button">
              Rechercher
            </Link>
          </div>
        )}

        {albums && albums.length > 0 && (
          <div className="quick-grid">
            {albums.slice(0, 8).map((album) => (
              <Link key={album.id} to={`/album/${album.id}`} className="quick-item">
                <Cover src={images.album(album)} />
                <span className="quick-item-title">{album.title}</span>
                <PlayButton
                  playing={isPlaying(album.id)}
                  onClick={() => void playAlbum(album.id)}
                  className={isPlaying(album.id) ? 'visible' : ''}
                />
              </Link>
            ))}
          </div>
        )}

        {albums && albums.length > 0 && (
          <Shelf title="Ajoutés récemment">
            {albums.slice(0, 12).map((album) => (
              <Card
                key={album.id}
                to={`/album/${album.id}`}
                title={album.title}
                subtitle={album.artist.name}
                image={images.album(album)}
                playing={isPlaying(album.id)}
                onPlay={() => void playAlbum(album.id)}
              />
            ))}
          </Shelf>
        )}

        {artists && artists.length > 0 && (
          <Shelf title="Vos artistes">
            {artists.slice(0, 12).map((artist) => (
              <Card
                key={artist.id}
                to={`/artist/${artist.id}`}
                title={artist.name}
                subtitle="Artiste"
                image={images.artist(artist)}
                round
                playing={isPlaying(artist.id)}
                onPlay={() => void playArtist(artist.id)}
              />
            ))}
          </Shelf>
        )}
      </div>
    </div>
  )
}
