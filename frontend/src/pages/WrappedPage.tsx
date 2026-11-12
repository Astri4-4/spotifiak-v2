import { useState } from 'react'
import { api, images } from '../api'
import { Card } from '../components/Card'
import { MobileHeader } from '../components/Mobile'
import { TrackList } from '../components/TrackList'
import { pluralize } from '../format'
import { useFetch, useIsMobile } from '../hooks'
import { usePlayContext } from '../player/usePlayContext'

const number = new Intl.NumberFormat('fr-FR')

/** The user's year in Spotifiak, like Spotify Wrapped: minutes, top tracks, artists and genres. */
export function WrappedPage() {
  const [year, setYear] = useState<number>()
  const { data: wrapped, error } = useFetch(() => api.wrapped(year), [year])
  const { isPlaying, playArtist } = usePlayContext()
  const isMobile = useIsMobile()
  const title = `Ton année ${wrapped?.year ?? ''}`.trim()

  return (
    <div className="page">
      <div className="page-inner">
        {isMobile ? <MobileHeader title={title} /> : <h1 className="greeting">{title}</h1>}
        {error && <p className="error">{error}</p>}
        {wrapped && wrapped.years.length > 1 && (
          <div className="wrapped-years" role="group" aria-label="Année">
            {wrapped.years.map((y) => (
              <button key={y} className={`chip${y === wrapped.year ? ' selected' : ''}`} aria-pressed={y === wrapped.year} onClick={() => setYear(y)}>
                {y}
              </button>
            ))}
          </div>
        )}
        {wrapped && !wrapped.plays && (
          <div className="empty-state">
            <h2>Rien d'écouté en {wrapped.year}</h2>
            <p>Lance quelques titres : ton année se remplit au fil des écoutes.</p>
          </div>
        )}
        {wrapped && wrapped.plays > 0 && (
          <>
            <div className="wrapped-stats">
              <div className="wrapped-stat">
                <strong>{number.format(wrapped.minutes)}</strong>
                <span>minutes d'écoute</span>
              </div>
              <div className="wrapped-stat">
                <strong>{number.format(wrapped.plays)}</strong>
                <span>titres lancés</span>
              </div>
              {wrapped.topGenres[0] && (
                <div className="wrapped-stat">
                  <strong>{wrapped.topGenres[0].name}</strong>
                  <span>ton genre préféré</span>
                </div>
              )}
            </div>

            <h2 className="section-title">Tes artistes préférés</h2>
            <div className="card-grid">
              {wrapped.topArtists.map((artist, i) => (
                <Card
                  key={artist.id}
                  to={`/artist/${artist.id}`}
                  title={`${i + 1}. ${artist.name}`}
                  subtitle={pluralize(artist.plays, 'écoute')}
                  image={images.artist(artist)}
                  round
                  playing={isPlaying(artist.id)}
                  onPlay={() => void playArtist(artist.id)}
                />
              ))}
            </div>

            <h2 className="section-title">Tes titres préférés</h2>
            <TrackList
              tracks={wrapped.topTracks}
              contextId={`wrapped:${wrapped.year}`}
              contextName={title}
              variant="full"
              badges={wrapped.topTracks.map((t) => (
                <span key={t.id} className="wrapped-plays">
                  {pluralize(t.plays, 'écoute')}
                </span>
              ))}
            />
          </>
        )}
      </div>
    </div>
  )
}
