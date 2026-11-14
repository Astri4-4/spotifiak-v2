import { eras as erasApi, images, type Era } from '../api'
import { Cover } from '../components/Cover'
import { MobileHeader } from '../components/Mobile'
import { PlayButton } from '../components/PlayButton'
import { pluralize } from '../format'
import { useFetch, useIsMobile } from '../hooks'
import { usePlayer } from '../player/context'

const month = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

/** "mars → mai 2026", "juin 2026", "déc. 2025 → févr. 2026". */
export function eraSpan(start: string, end: string) {
  const a = new Date(start)
  const b = new Date(end)
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return month(start)
  if (a.getFullYear() === b.getFullYear()) return `${a.toLocaleDateString('fr-FR', { month: 'long' })} → ${month(end)}`
  return `${month(start)} → ${month(end)}`
}

/** /eras: the user's listening history as chapters, newest first, each playable. */
export function ErasPage() {
  const { data, error } = useFetch(() => erasApi.list(), [])
  const isMobile = useIsMobile()

  return (
    <div className="page">
      <div className="page-inner">
        {isMobile ? <MobileHeader title="Tes ères" /> : <h1 className="greeting">Tes ères musicales</h1>}
        <p className="muted eras-intro">
          Ton historique d'écoute, découpé en chapitres : une ère commence quand tes artistes changent.
        </p>
        {error && <p className="error">{error}</p>}
        {data && data.length === 0 && (
          <div className="empty-state">
            <h2>Ta première ère s'écrit</h2>
            <p>Écoute quelques semaines de musique : tes chapitres apparaîtront ici.</p>
          </div>
        )}
        <ol className="eras">
          {data?.map((era, i) => <EraCard key={era.id} era={era} number={data.length - i} />)}
        </ol>
      </div>
    </div>
  )
}

function EraCard({ era, number }: { era: Era; number: number }) {
  const { current, playing, playTracks, toggle } = usePlayer()
  const contextId = `era:${era.id}`
  const isPlaying = playing && !!current && era.tracks.some((t) => t.id === current.id)
  const hero = era.artists[0]
  const picture = hero ? images.artist(hero) : null

  return (
    <li className={`era${era.current ? ' current' : ''}`}>
      <span className="era-dot" aria-hidden="true" />
      <article className="era-card">
        {picture && <img className="era-bg" src={picture} alt="" aria-hidden="true" />}
        <header>
          <span className="era-kicker">
            Chapitre {number} • {eraSpan(era.start, era.end)}
            {era.current && <span className="era-now">En cours</span>}
          </span>
          <h2>{era.title}</h2>
          <span className="muted">{pluralize(era.plays, 'écoute')}</span>
        </header>
        <div className="era-artists">
          {era.artists.map((a) => (
            <span key={a.id} className="era-artist" title={`${a.name} • ${a.plays} écoutes`}>
              <Cover src={images.artist(a)} size={40} round />
              <span>{a.name}</span>
            </span>
          ))}
        </div>
        <div className="era-tracks">
          {era.tracks.slice(0, 4).map((t) => (
            <span key={t.id} className="era-track">
              <Cover src={images.track(t)} size={32} />
              <span className="title-text">
                <span className="track-name">{t.title}</span>
                <span className="track-artist">{t.artistName}</span>
              </span>
            </span>
          ))}
        </div>
        <div className="era-play">
          <PlayButton
            playing={isPlaying}
            onClick={() => (isPlaying ? toggle() : playTracks(era.tracks, 0, contextId, era.title))}
          />
          <span>Réécouter cette ère</span>
        </div>
      </article>
    </li>
  )
}
