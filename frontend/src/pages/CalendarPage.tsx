import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type CalendarConcert, type CalendarRelease } from '../api'
import { useCurrentUser } from '../auth/context'
import { useCollection } from '../collection/context'
import { Cover } from '../components/Cover'
import { MobileHeader } from '../components/Mobile'
import { useFetch, useIsMobile } from '../hooks'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon } from '../icons'

// The server loads releases and shows in the background: ask again while it does.
const LOADING_POLL_MS = 3000
const WEEKDAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']
const TYPES: Record<string, string> = { album: 'Album', single: 'Single', ep: 'EP', compile: 'Compilation' }

/** YYYY-MM-DD of a local date. */
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The weeks (Monday first) covering a month; days outside it are null. */
function monthWeeks(year: number, month: number) {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  const days = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = [...Array<null>(offset).fill(null)]
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7))
}

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

function ReleaseRow({ release }: { release: CalendarRelease }) {
  const { notify } = useCollection()
  const [queued, setQueued] = useState(false)
  const download = () => {
    setQueued(true)
    api
      .download(release.link)
      .then(() => notify('Téléchargement lancé : la sortie apparaîtra dans votre bibliothèque'))
      .catch((err: Error) => {
        setQueued(false)
        notify(err.message)
      })
  }
  return (
    <li className="calendar-row">
      <Cover src={release.coverUrl} size={56} />
      <span className="title-text">
        <span className="track-name">{release.title}</span>
        <span className="track-artist">
          {TYPES[release.type] ?? 'Sortie'} •{' '}
          <Link to={`/artist/${release.artist.id}`}>{release.artist.name}</Link> • {longDate(release.date)}
        </span>
      </span>
      {release.albumId ? (
        <Link to={`/album/${release.albumId}`} className="pill-button small outline">
          Ouvrir
        </Link>
      ) : (
        <button
          className={`icon-button download-button${queued ? ' queued' : ''}`}
          onClick={download}
          disabled={queued}
          aria-label={queued ? 'Téléchargement lancé' : `Télécharger ${release.title}`}
          title={queued ? 'Téléchargement lancé' : 'Télécharger dans la bibliothèque'}
        >
          {queued ? <CheckIcon size={20} /> : <DownloadIcon size={20} />}
        </button>
      )}
    </li>
  )
}

function ConcertRow({ concert }: { concert: CalendarConcert }) {
  const date = new Date(`${concert.date}T12:00:00`)
  return (
    <li className={`calendar-row${concert.cancelled ? ' cancelled' : ''}`}>
      <span className="concert-date" aria-hidden="true">
        <span>{date.toLocaleDateString('fr-FR', { month: 'short' })}</span>
        <strong>{date.getDate()}</strong>
      </span>
      <span className="title-text">
        <span className="track-name">
          <Link to={`/artist/${concert.artist.id}`}>{concert.artist.name}</Link>
          {concert.cancelled && <span className="concert-cancelled">Annulé</span>}
        </span>
        <span className="track-artist">
          {[concert.venue, concert.city, concert.country].filter(Boolean).join(', ')}
        </span>
        <span className="track-artist">
          {longDate(concert.date)}
          {concert.time && ` à ${concert.time.replace(':', 'h')}`}
        </span>
      </span>
      {concert.url && !concert.cancelled && (
        <a href={concert.url} target="_blank" rel="noreferrer" className="pill-button small">
          Billets
        </a>
      )}
    </li>
  )
}

/** /calendar: new releases and upcoming shows of the followed artists, on a month view. */
export function CalendarPage() {
  const [version, setVersion] = useState(0)
  const { data, error } = useFetch(() => api.calendar(), [version], { keepPrevious: true })
  const { followedArtists } = useCollection()
  const isAdmin = useCurrentUser().role === 'admin'
  const isMobile = useIsMobile()
  // Read once: the page doesn't need to roll over at midnight.
  const [today] = useState(() => new Date())
  const [month, setMonth] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (!data?.loading) return
    const timer = setTimeout(() => setVersion((v) => v + 1), LOADING_POLL_MS)
    return () => clearTimeout(timer)
  }, [data])

  const releaseDays = new Set(data?.releases.map((r) => r.date))
  const concertDays = new Set(data?.concerts.map((c) => c.date))
  const releases = data?.releases.filter((r) => !selected || r.date === selected) ?? []
  const concerts = data?.concerts.filter((c) => !selected || c.date === selected) ?? []
  const shift = (by: number) => {
    const d = new Date(month.year, month.month + by, 1)
    setMonth({ year: d.getFullYear(), month: d.getMonth() })
  }
  const title = new Date(month.year, month.month, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

  return (
    <div className="page">
      <div className="page-gradient" />
      <div className="page-inner settings-page calendar-page">
        {isMobile ? <MobileHeader title="Calendrier" /> : <h1 className="greeting">Calendrier</h1>}
        {error && <p className="error">{error}</p>}
        {followedArtists.length === 0 && (
          <p className="muted">Suivez des artistes pour voir ici leurs nouvelles sorties et leurs concerts.</p>
        )}

        <section className="scan-card calendar-month">
          <header className="calendar-month-header">
            <button className="icon-button" onClick={() => shift(-1)} aria-label="Mois précédent">
              <ChevronLeftIcon />
            </button>
            <h2>{title}</h2>
            <button className="icon-button" onClick={() => shift(1)} aria-label="Mois suivant">
              <ChevronRightIcon />
            </button>
          </header>
          <table className="calendar-grid">
            <thead>
              <tr>
                {WEEKDAYS.map((d) => (
                  <th key={d} scope="col">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthWeeks(month.year, month.month).map((week, w) => (
                <tr key={w}>
                  {week.map((day, d) => {
                    if (!day) return <td key={d} />
                    const iso = isoDay(day)
                    const hasRelease = releaseDays.has(iso)
                    const hasConcert = concertDays.has(iso)
                    const label = [
                      longDate(iso),
                      hasRelease && 'nouvelle sortie',
                      hasConcert && 'concert',
                    ]
                      .filter(Boolean)
                      .join(', ')
                    return (
                      <td key={d}>
                        <button
                          className={`calendar-day${iso === isoDay(today) ? ' today' : ''}${selected === iso ? ' selected' : ''}`}
                          onClick={() => setSelected(selected === iso ? null : iso)}
                          aria-pressed={selected === iso}
                          aria-label={label}
                        >
                          {day.getDate()}
                          <span className="calendar-dots">
                            {hasRelease && <span className="dot release" />}
                            {hasConcert && <span className="dot concert" />}
                          </span>
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="calendar-legend muted">
            <span className="dot release" /> Sortie <span className="dot concert" /> Concert
            {!!data?.loading && ` • chargement de ${data.loading} artiste${data.loading > 1 ? 's' : ''}…`}
          </p>
        </section>

        {selected && (
          <button className="pill-button small outline calendar-clear" onClick={() => setSelected(null)}>
            {longDate(selected)} • Tout afficher
          </button>
        )}

        <section className="scan-card">
          <h2 className="settings-title">Nouvelles sorties</h2>
          {data && releases.length === 0 && (
            <p className="muted">{selected ? 'Aucune sortie ce jour-là.' : 'Aucune sortie ces six derniers mois.'}</p>
          )}
          <ul className="person-list">
            {releases.map((r) => (
              <ReleaseRow key={`${r.artist.id}-${r.id}`} release={r} />
            ))}
          </ul>
        </section>

        <section className="scan-card">
          <h2 className="settings-title">Concerts à venir</h2>
          {data && !data.concertsEnabled ? (
            <p className="muted">
              {isAdmin
                ? 'Les concerts viennent de Ticketmaster : créez une clé gratuite sur developer.ticketmaster.com et renseignez TICKETMASTER_API_KEY dans la configuration de l’API.'
                : 'Les concerts ne sont pas activés sur ce serveur.'}
            </p>
          ) : (
            data &&
            concerts.length === 0 && <p className="muted">{selected ? 'Aucun concert ce jour-là.' : 'Aucun concert annoncé.'}</p>
          )}
          <ul className="person-list">
            {concerts.map((c) => (
              <ConcertRow key={`${c.artist.id}-${c.id}`} concert={c} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
