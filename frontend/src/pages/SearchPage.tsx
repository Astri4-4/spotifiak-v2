import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, images, podcasts, type DownloadState, type PodcastSearchResult } from '../api'
import { startDownload } from '../downloads'
import { Card } from '../components/Card'
import { PlaylistCover } from '../components/CollectionCovers'
import { Cover } from '../components/Cover'
import { PlayButton } from '../components/PlayButton'
import { Shelf } from '../components/Shelf'
import { TrackList } from '../components/TrackList'
import { formatDuration } from '../format'
import { MobileHeader } from '../components/Mobile'
import { SearchInput } from '../components/SearchInput'
import { useFetch, useIsMobile } from '../hooks'
import { CheckIcon, DownloadIcon } from '../icons'
import { usePlayContext } from '../player/usePlayContext'

type Tab = 'all' | 'tracks' | 'albums' | 'artists' | 'playlists' | 'podcasts' | 'deezer'

const TABS: [Tab, string][] = [
  ['all', 'Tout'],
  ['tracks', 'Titres'],
  ['albums', 'Albums'],
  ['artists', 'Artistes'],
  ['playlists', 'Playlists'],
  ['podcasts', 'Podcasts'],
  ['deezer', 'Deezer'],
]

const DEBOUNCE_MS = 250

// Browse tiles get a stable color per name, like Spotify's category tiles.
const TILE_COLORS = ['#dc148c', '#006450', '#8400e7', '#1e3264', '#e8115b', '#27856a', '#477d95', '#ba5d07', '#e13300', '#503750', '#148a08', '#7358ff']

function tileColor(name: string) {
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0
  return TILE_COLORS[Math.abs(hash) % TILE_COLORS.length]
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

function BrowseAll() {
  const { data: artists } = useFetch(() => api.artists().then((r) => r.items), [])
  const { data: genres } = useFetch(() => api.genres(), [])
  return (
    <div className="page-inner">
      <Link to="/discover" className="discover-banner">
        <strong>Découvrir</strong>
        <span>De nouveaux artistes proches de ce que tu écoutes, à écouter avant de télécharger</span>
      </Link>
      <Link to="/quiz" className="discover-banner quiz-banner">
        <strong>Blind test</strong>
        <span>Défie tes amis sur les titres que vous écoutez</span>
      </Link>
      {genres && genres.length > 0 && (
        <>
          <h2 className="section-title">Genres</h2>
          <div className="browse-grid">
            {genres.map((genre) => (
              <Link key={genre.id} to={`/mix/genre-${genre.id}`} className="browse-tile" style={{ backgroundColor: tileColor(genre.name) }}>
                <span>{genre.name}</span>
              </Link>
            ))}
          </div>
        </>
      )}
      <h2 className="section-title">Parcourir tout</h2>
      <div className="browse-grid">
        {artists?.map((artist) => (
          <Link
            key={artist.id}
            to={`/artist/${artist.id}`}
            className="browse-tile"
            style={{ backgroundColor: tileColor(artist.name) }}
          >
            <span>{artist.name}</span>
            <Cover src={images.artist(artist)} className="browse-tile-cover" />
          </Link>
        ))}
      </div>
    </div>
  )
}

/** A search result's download: what the user started here, else their latest one (from the server). */
function useStarted() {
  const [started, setStarted] = useState<Map<string, DownloadState>>(new Map())
  const [failed, setFailed] = useState<string | null>(null)
  const start = async (key: string, url: string) => {
    setFailed(null)
    setStarted((prev) => new Map(prev).set(key, { id: '', status: 'queued', progress: 0 }))
    try {
      const downloads = await startDownload(url)
      if (downloads[0]) setStarted((prev) => new Map(prev).set(key, downloads[0]))
    } catch (err) {
      setStarted((prev) => {
        const next = new Map(prev)
        next.delete(key)
        return next
      })
      setFailed((err as Error).message)
    }
  }
  return { started, failed, start }
}

/** Downloading, waiting, done…, or a download button. */
function DownloadButton({ state, label, onClick }: { state: DownloadState | null | undefined; label: string; onClick: () => void }) {
  const busy = state && (state.status === 'queued' || state.status === 'downloading')
  if (busy) {
    return (
      <Link to="/downloads" className="download-state" title="Voir les téléchargements">
        {state.status === 'queued' || !state.progress ? 'En attente' : `${state.progress} %`}
      </Link>
    )
  }
  return (
    <button className="icon-button download-button" onClick={onClick} aria-label={label} title={label}>
      <DownloadIcon size={20} />
    </button>
  )
}

function InLibrary({ to, label = 'Dans ta bibliothèque' }: { to: string; label?: string }) {
  return (
    <Link to={to} className="in-library" title={label}>
      <CheckIcon size={16} />
      <span>{label}</span>
    </Link>
  )
}

function DeezerTracks({ query, limit }: { query: string; limit?: number }) {
  const { data, error } = useFetch(() => api.deezerSearch(query), [query])
  const { started, failed, start } = useStarted()
  const { playTracks, isPlaying } = usePlayContext()

  if (error) return <p className="muted">Deezer est injoignable (deemix ne répond pas).</p>
  if (!data) return null
  if (!data.length) return <p className="muted">Aucun titre sur Deezer.</p>

  return (
    <>
      {failed && <p className="error">Échec du téléchargement : {failed}</p>}
      <div className="tracklist tracklist-compact">
        {data.slice(0, limit).map((track) => {
          const local = track.libraryTrack
          return (
            <div key={track.id} className="tracklist-row deezer-row">
              <span className="col-title">
                <img className="cover" src={track.album.cover_medium} alt="" width={40} height={40} />
                <span className="title-text">
                  <span className="track-name">{track.title}</span>
                  <span className="track-artist">
                    {track.artist.name} • {track.album.title}
                  </span>
                </span>
              </span>
              <span className="col-duration">{formatDuration(track.duration)}</span>
              {local ? (
                <PlayButton
                  playing={isPlaying(`deezer:${local.id}`)}
                  onClick={() => void playTracks(`deezer:${local.id}`, [local], local.title)}
                  className="visible in-library-play"
                />
              ) : (
                <DownloadButton
                  state={started.get(`track:${track.id}`) ?? track.download}
                  label={`Télécharger ${track.title}`}
                  onClick={() => void start(`track:${track.id}`, track.link)}
                />
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function DeezerAlbums({ query }: { query: string }) {
  const { data, error } = useFetch(() => api.deezerAlbums(query), [query])
  const { started, failed, start } = useStarted()
  if (error || !data?.length) return null
  return (
    <section>
      <h2 className="section-title">Albums</h2>
      {failed && <p className="error">Échec du téléchargement : {failed}</p>}
      <ul className="deezer-list">
        {data.map((album) => (
          <li key={album.id} className="deezer-item">
            <img className="cover" src={album.cover_medium} alt="" width={56} height={56} />
            <span className="deezer-item-text">
              <span className="track-name">{album.title}</span>
              <span className="track-artist">
                {album.artist.name} • {album.nb_tracks} titre{album.nb_tracks > 1 ? 's' : ''}
              </span>
            </span>
            {album.libraryAlbumId ? (
              <InLibrary to={`/album/${album.libraryAlbumId}`} />
            ) : (
              <DownloadButton
                state={started.get(`album:${album.id}`) ?? album.download}
                label={`Télécharger l'album ${album.title}`}
                onClick={() => void start(`album:${album.id}`, album.link)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function DeezerArtists({ query }: { query: string }) {
  const { data, error } = useFetch(() => api.deezerArtists(query), [query])
  const { started, failed, start } = useStarted()
  // A discography is many albums: one click asks, a second one starts.
  const [confirming, setConfirming] = useState<number | null>(null)
  if (error || !data?.length) return null
  return (
    <section>
      <h2 className="section-title">Artistes</h2>
      {failed && <p className="error">Échec du téléchargement : {failed}</p>}
      <ul className="deezer-list">
        {data.slice(0, 10).map((artist) => {
          const state = started.get(`artist:${artist.id}`)
          return (
            <li key={artist.id} className="deezer-item">
              <img className="cover round" src={artist.picture_medium} alt="" width={56} height={56} />
              <span className="deezer-item-text">
                <span className="track-name">{artist.name}</span>
                <span className="track-artist">
                  {artist.nb_album} album{artist.nb_album > 1 ? 's' : ''}
                </span>
              </span>
              {artist.libraryArtistId && <InLibrary to={`/artist/${artist.libraryArtistId}`} label="Dans ta bibliothèque" />}
              {state ? (
                <Link to="/downloads" className="download-state">
                  Discographie lancée
                </Link>
              ) : confirming === artist.id ? (
                <span className="confirm-download">
                  <button
                    className="pill-button small"
                    onClick={() => {
                      setConfirming(null)
                      void start(`artist:${artist.id}`, artist.link)
                    }}
                  >
                    Télécharger {artist.nb_album} album{artist.nb_album > 1 ? 's' : ''}
                  </button>
                  <button className="pill-button small outline" onClick={() => setConfirming(null)}>
                    Annuler
                  </button>
                </span>
              ) : (
                <button
                  className="icon-button download-button"
                  onClick={() => setConfirming(artist.id)}
                  aria-label={`Télécharger la discographie de ${artist.name}`}
                  title="Télécharger la discographie"
                >
                  <DownloadIcon size={20} />
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Deezer, through deemix: tracks (with `limit`, only them), else albums and artists too. */
function DeezerResults({ query, limit }: { query: string; limit?: number }) {
  if (limit) return <DeezerTracks query={query} limit={limit} />
  return (
    <>
      <p className="deezer-hint">
        Ce qui est déjà dans ta bibliothèque est marqué. <Link to="/downloads">Voir les téléchargements</Link>
      </p>
      <section>
        <h2 className="section-title">Titres</h2>
        <DeezerTracks query={query} />
      </section>
      <DeezerAlbums query={query} />
      <DeezerArtists query={query} />
    </>
  )
}

const podcastLink = (r: PodcastSearchResult) =>
  r.podcastId ? `/podcast/${r.podcastId}` : `/podcasts/open?feed=${encodeURIComponent(r.feedUrl)}`

/** Podcasts from the directory; a pasted RSS address opens that feed. */
function PodcastResults({ query, shelf = false }: { query: string; shelf?: boolean }) {
  const isFeed = /^https?:\/\/\S+$/i.test(query)
  const { data, error } = useFetch(() => (isFeed ? Promise.resolve([]) : podcasts.search(query)), [query])

  if (isFeed) {
    return (
      <section>
        <h2 className="section-title">Podcasts</h2>
        <Link to={`/podcasts/open?feed=${encodeURIComponent(query)}`} className="pill-button small">
          Ouvrir ce flux RSS
        </Link>
      </section>
    )
  }
  if (error) return <p className="muted">La recherche de podcasts est indisponible.</p>
  if (!data) return null
  if (!data.length) return shelf ? null : <p className="muted">Aucun podcast pour « {query} ».</p>

  const cards = data.map((r) => (
    <Card key={r.feedUrl} to={podcastLink(r)} title={r.title} subtitle={r.author ?? 'Podcast'} image={r.imageUrl} />
  ))
  return shelf ? <Shelf title="Podcasts">{cards.slice(0, 8)}</Shelf> : <div className="card-grid">{cards}</div>
}

function Results({ query }: { query: string }) {
  const [tab, setTab] = useState<Tab>('all')
  const { data } = useFetch(() => api.search(query), [query])
  const { isPlaying, playAlbum, playArtist, playPlaylist } = usePlayContext()

  const hasLocal = data && (data.tracks.length || data.albums.length || data.artists.length || data.playlists.length)
  const top = data?.artists[0]
    ? { kind: 'artist' as const, item: data.artists[0] }
    : data?.albums[0]
      ? { kind: 'album' as const, item: data.albums[0] }
      : null

  const albumCards = data?.albums.map((album) => (
    <Card
      key={album.id}
      to={`/album/${album.id}`}
      title={album.title}
      subtitle={[album.year, album.artist.name].filter(Boolean).join(' • ')}
      image={images.album(album)}
      playing={isPlaying(album.id)}
      onPlay={() => void playAlbum(album.id)}
    />
  ))

  const artistCards = data?.artists.map((artist) => (
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
  ))

  const playlistCards = data?.playlists.map((p) => (
    <Card
      key={p.id}
      to={`/playlist/${p.id}`}
      title={p.name}
      subtitle={`De ${p.owner.displayName}`}
      image={null}
      cover={<PlaylistCover covers={p.covers} quality="md" />}
      playing={isPlaying(p.id)}
      onPlay={() => void playPlaylist(p.id, p.name)}
    />
  ))

  return (
    <>
      <div className="chips search-tabs">
        {TABS.map(([value, label]) => (
          <button key={value} className={`chip${tab === value ? ' selected' : ''}`} onClick={() => setTab(value)}>
            {label}
          </button>
        ))}
      </div>

      <div className="page-inner">
        {tab === 'all' && (
          <>
            {hasLocal ? (
              <div className={`top-row${top ? '' : ' single'}`}>
                {top && (
                  <section className="top-result">
                    <h2 className="section-title">Meilleur résultat</h2>
                    <Link
                      to={`/${top.kind}/${top.item.id}`}
                      className="top-result-card"
                    >
                      <Cover
                        src={top.kind === 'artist' ? images.artist(top.item) : images.album(top.item)}
                        size={92}
                        quality="md"
                        round={top.kind === 'artist'}
                      />
                      <span className="top-result-name">{top.kind === 'artist' ? top.item.name : top.item.title}</span>
                      <span className="top-result-type">
                        {top.kind === 'artist' ? (
                          'Artiste'
                        ) : (
                          <>
                            Album • <span className="white">{top.item.artist.name}</span>
                          </>
                        )}
                      </span>
                      <PlayButton
                        size="lg"
                        playing={isPlaying(top.item.id)}
                        onClick={() => void (top.kind === 'artist' ? playArtist(top.item.id) : playAlbum(top.item.id))}
                        className={isPlaying(top.item.id) ? 'visible' : ''}
                      />
                    </Link>
                  </section>
                )}
                {data.tracks.length > 0 && (
                  <section className="top-tracks">
                    <h2 className="section-title">Titres</h2>
                    <TrackList tracks={data.tracks.slice(0, 4)} contextId={`search:${query}`} variant="search" />
                  </section>
                )}
              </div>
            ) : (
              data && <p className="muted">Rien dans votre bibliothèque pour « {query} ».</p>
            )}

            {!!data?.artists.length && <Shelf title="Artistes">{artistCards}</Shelf>}
            {!!data?.albums.length && <Shelf title="Albums">{albumCards}</Shelf>}
            {!!data?.playlists.length && <Shelf title="Playlists">{playlistCards}</Shelf>}
            <PodcastResults query={query} shelf />

            <section>
              <h2 className="section-title">Sur Deezer</h2>
              <DeezerResults query={query} limit={8} />
            </section>
          </>
        )}

        {tab === 'tracks' && data && <TrackList tracks={data.tracks} contextId={`search:${query}`} variant="full" />}
        {tab === 'albums' && <div className="card-grid">{albumCards}</div>}
        {tab === 'artists' && <div className="card-grid">{artistCards}</div>}
        {tab === 'playlists' &&
          data &&
          (data.playlists.length ? (
            <div className="card-grid">{playlistCards}</div>
          ) : (
            <p className="muted">Aucune playlist pour « {query} ».</p>
          ))}
        {tab === 'podcasts' && <PodcastResults query={query} />}
        {tab === 'deezer' && <DeezerResults query={query} />}
      </div>
    </>
  )
}

export function SearchPage() {
  const { query = '' } = useParams()
  const debounced = useDebounced(query.trim(), DEBOUNCE_MS)
  const isMobile = useIsMobile()

  return (
    <div className="page search-page">
      {/* On phones the search field lives in the page, not in a top bar. */}
      {isMobile && (
        <div className="page-inner">
          <MobileHeader title="Rechercher" />
          <SearchInput className="mobile-search" />
        </div>
      )}
      {debounced ? <Results query={debounced} /> : <BrowseAll />}
    </div>
  )
}
