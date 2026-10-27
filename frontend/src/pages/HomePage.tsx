import { Link } from 'react-router-dom'
import { api, images, podcasts } from '../api'
import { Card } from '../components/Card'
import { Cover } from '../components/Cover'
import { PlayButton } from '../components/PlayButton'
import { Shelf } from '../components/Shelf'
import { useCollection } from '../collection/context'
import { LikedCover, PlaylistCover } from '../components/CollectionCovers'
import { MobileHeader } from '../components/Mobile'
import { useFetch, useIsMobile } from '../hooks'
import { LIKED_CONTEXT, usePlayContext } from '../player/usePlayContext'
import { usePlayEpisode } from '../podcasts'

function greeting() {
  const hour = new Date().getHours()
  if (hour < 5 || hour >= 18) return 'Bonsoir'
  if (hour < 12) return 'Bonjour'
  return 'Bon après-midi'
}

export function HomePage() {
  const { data: albums } = useFetch(() => api.albums().then((r) => r.items), [])
  const { data: artists } = useFetch(() => api.artists().then((r) => r.items), [])
  const { isPlaying, playAlbum, playArtist, playPlaylist, playLiked } = usePlayContext()
  const { likedIds, playlists, podcasts: subscriptions } = useCollection()
  // Reloaded when subscriptions change, so a new subscription shows up here.
  const { data: episodes } = useFetch(() => podcasts.newEpisodes(), [subscriptions.length])
  const episode = usePlayEpisode()
  const isMobile = useIsMobile()

  const empty = albums && artists && !albums.length && !artists.length

  return (
    <div className="page home">
      <div className="page-gradient" />
      <div className="page-inner">
        {isMobile ? <MobileHeader title={greeting()} /> : <h1 className="greeting">{greeting()}</h1>}

        {empty && (
          <div className="empty-state">
            <h2>Votre bibliothèque est vide</h2>
            <p>Recherchez un titre et téléchargez-le depuis Deezer pour commencer.</p>
            <Link to="/search" className="pill-button">
              Rechercher
            </Link>
          </div>
        )}

        {albums && (albums.length > 0 || playlists.length > 0) && (
          <div className="quick-grid">
            {[
              ...(likedIds.size > 0
                ? [{ key: 'liked', to: '/collection/tracks', title: 'Titres likés', cover: <LikedCover />, id: LIKED_CONTEXT, play: playLiked }]
                : []),
              ...playlists
                .filter((p) => p.trackCount > 0)
                .slice(0, 3)
                .map((p) => ({
                  key: p.id,
                  to: `/playlist/${p.id}`,
                  title: p.name,
                  cover: <PlaylistCover covers={p.covers} />,
                  id: p.id,
                  play: () => playPlaylist(p.id),
                })),
              ...albums.map((a) => ({
                key: a.id,
                to: `/album/${a.id}`,
                title: a.title,
                cover: <Cover src={images.album(a)} />,
                id: a.id,
                play: () => playAlbum(a.id),
              })),
            ]
              .slice(0, 8)
              .map((item) => (
                <Link key={item.key} to={item.to} className="quick-item">
                  {item.cover}
                  <span className="quick-item-title">{item.title}</span>
                  <PlayButton
                    playing={isPlaying(item.id)}
                    onClick={() => void item.play()}
                    className={isPlaying(item.id) ? 'visible' : ''}
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

        {episodes && episodes.length > 0 && (
          <Shelf title="Nouveaux épisodes">
            {episodes.map((e) => (
              <Card
                key={e.id}
                to={`/podcast/${e.podcast.id}`}
                title={e.title}
                subtitle={e.podcast.title}
                image={images.episode(e)}
                playing={episode.isPlaying(e)}
                onPlay={() => episode.play(e)}
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
