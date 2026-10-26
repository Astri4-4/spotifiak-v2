import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, images, type DeezerTrack } from '../api'
import { Card } from '../components/Card'
import { Cover } from '../components/Cover'
import { PlayButton } from '../components/PlayButton'
import { Shelf } from '../components/Shelf'
import { TrackList } from '../components/TrackList'
import { formatDuration } from '../format'
import { useFetch } from '../hooks'
import { CheckIcon, DownloadIcon } from '../icons'
import { usePlayContext } from '../player/usePlayContext'

type Tab = 'all' | 'tracks' | 'albums' | 'artists' | 'deezer'

const TABS: [Tab, string][] = [
  ['all', 'Tout'],
  ['tracks', 'Titres'],
  ['albums', 'Albums'],
  ['artists', 'Artistes'],
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
  return (
    <div className="page-inner">
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

function DeezerResults({ query, limit }: { query: string; limit?: number }) {
  const { data, error } = useFetch(() => api.deezerSearch(query), [query])
  const [queued, setQueued] = useState<Set<number>>(new Set())
  const [failed, setFailed] = useState<string | null>(null)

  const download = async (track: DeezerTrack) => {
    try {
      await api.download(track.link)
      setQueued((prev) => new Set(prev).add(track.id))
    } catch (err) {
      setFailed((err as Error).message)
    }
  }

  if (error) return <p className="muted">Deezer est injoignable (deemix ne répond pas).</p>
  if (!data) return null
  if (!data.length) return <p className="muted">Aucun résultat sur Deezer.</p>

  return (
    <>
      {failed && <p className="error">Échec du téléchargement : {failed}</p>}
      <div className="tracklist tracklist-compact">
        {data.slice(0, limit).map((track) => {
          const isQueued = queued.has(track.id)
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
              <button
                className={`icon-button download-button${isQueued ? ' queued' : ''}`}
                onClick={() => void download(track)}
                disabled={isQueued}
                aria-label={isQueued ? 'Téléchargement lancé' : `Télécharger ${track.title}`}
                title={isQueued ? 'Téléchargement lancé, le titre apparaîtra dans votre bibliothèque' : 'Télécharger'}
              >
                {isQueued ? <CheckIcon size={20} /> : <DownloadIcon size={20} />}
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}

function Results({ query }: { query: string }) {
  const [tab, setTab] = useState<Tab>('all')
  const { data } = useFetch(() => api.search(query), [query])
  const { isPlaying, playAlbum, playArtist } = usePlayContext()

  const hasLocal = data && (data.tracks.length || data.albums.length || data.artists.length)
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

            <section>
              <h2 className="section-title">Sur Deezer</h2>
              <DeezerResults query={query} limit={8} />
            </section>
          </>
        )}

        {tab === 'tracks' && data && <TrackList tracks={data.tracks} contextId={`search:${query}`} variant="full" />}
        {tab === 'albums' && <div className="card-grid">{albumCards}</div>}
        {tab === 'artists' && <div className="card-grid">{artistCards}</div>}
        {tab === 'deezer' && <DeezerResults query={query} />}
      </div>
    </>
  )
}

export function SearchPage() {
  const { query = '' } = useParams()
  const debounced = useDebounced(query.trim(), DEBOUNCE_MS)

  return <div className="page search-page">{debounced ? <Results query={debounced} /> : <BrowseAll />}</div>
}
