import { useEffect, useState } from 'react'
import { capsules, images, type OpenedCapsule, type SealedCapsule } from '../api'
import { useCurrentUser } from '../auth/context'
import { useCollection } from '../collection/context'
import { Cover } from '../components/Cover'
import { MobileHeader } from '../components/Mobile'
import { PersonAvatar } from '../components/PersonAvatar'
import { PlayButton } from '../components/PlayButton'
import { useFetch, useIsMobile } from '../hooks'
import { usePlayer } from '../player/context'

const longDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { dateStyle: 'long' })

/** "dans 1 an et 2 mois", "dans 12 jours", then a live "03:12:45" on the last day. */
export function countdown(ms: number) {
  if (ms <= 0) return 'maintenant'
  const day = 24 * 3600 * 1000
  if (ms < day) {
    const s = Math.floor(ms / 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
  }
  const days = Math.floor(ms / day)
  const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
  if (days < 61) return `dans ${plural(days, 'jour', 'jours')}`
  const months = Math.floor(days / 30.44)
  if (months < 12) return `dans ${plural(months, 'mois', 'mois')}`
  const years = Math.floor(months / 12)
  const rest = months % 12
  return `dans ${plural(years, 'an', 'ans')}${rest ? ` et ${plural(rest, 'mois', 'mois')}` : ''}`
}

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}

/** /capsules: tracks sealed until a date, for the user or by them. */
export function CapsulesPage() {
  const [version, setVersion] = useState(0)
  const { data, error } = useFetch(() => capsules.list(), [version], { keepPrevious: true })
  const { notify } = useCollection()
  const isMobile = useIsMobile()
  const now = useNow(1000)

  // A capsule whose day comes while the page is open: reload to reveal it.
  const nextOpen = data?.sealed[0] ? new Date(data.sealed[0].openAt).getTime() : null
  useEffect(() => {
    if (nextOpen && nextOpen <= now) setVersion((v) => v + 1)
  }, [nextOpen, now])

  const remove = (id: string) =>
    void capsules
      .remove(id)
      .then(() => setVersion((v) => v + 1))
      .catch((err: Error) => notify(err.message))

  const empty = data && !data.sealed.length && !data.opened.length && !data.sent.length

  return (
    <div className="page">
      <div className="page-inner capsules">
        {isMobile ? <MobileHeader title="Capsules" /> : <h1 className="greeting">Capsules temporelles</h1>}
        {error && <p className="error">{error}</p>}
        {empty && (
          <div className="empty-state">
            <h2>Scelle un titre pour le futur</h2>
            <p>
              Dans le menu ⋯ d'un titre, choisis « Mettre en capsule » : pour toi dans un an, ou pour un ami. Personne ne sait
              ce qu'il y a dedans avant le jour J.
            </p>
          </div>
        )}

        {data && data.sealed.length > 0 && (
          <section>
            <h2 className="section-title">À ouvrir</h2>
            <div className="capsule-grid">
              {data.sealed.map((c) => (
                <Sealed key={c.id} capsule={c} now={now} />
              ))}
            </div>
          </section>
        )}

        {data && data.opened.length > 0 && (
          <section>
            <h2 className="section-title">Ouvertes</h2>
            <ul className="capsule-list">
              {data.opened.map((c) => (
                <Opened key={c.id} capsule={c} onRemove={() => remove(c.id)} />
              ))}
            </ul>
          </section>
        )}

        {data && data.sent.length > 0 && (
          <section>
            <h2 className="section-title">Envoyées</h2>
            <ul className="capsule-list">
              {data.sent.map((c) => (
                <li key={c.id} className="capsule-row">
                  <PersonAvatar person={c.to} size={36} />
                  <span className="title-text">
                    <span className="track-name">
                      {c.track.title} <span className="muted">pour {c.to.displayName}</span>
                    </span>
                    <span className="track-artist">
                      {c.open ? `Ouverte le ${longDate(c.openAt)}` : `S'ouvre le ${longDate(c.openAt)} (${countdown(new Date(c.openAt).getTime() - now)})`}
                    </span>
                  </span>
                  {!c.open && (
                    <button className="pill-button small outline" onClick={() => remove(c.id)}>
                      Reprendre
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

function Sealed({ capsule, now }: { capsule: SealedCapsule; now: number }) {
  const me = useCurrentUser()
  const total = new Date(capsule.openAt).getTime() - new Date(capsule.createdAt).getTime()
  const left = new Date(capsule.openAt).getTime() - now
  const done = Math.min(1, Math.max(0, 1 - left / total))
  return (
    <div className="capsule-sealed">
      <span className="capsule-lock" aria-hidden="true">
        🔒
      </span>
      <strong className="capsule-countdown">{countdown(left)}</strong>
      <span className="muted">le {longDate(capsule.openAt)}</span>
      <div className="capsule-progress" aria-hidden="true">
        <div style={{ width: `${done * 100}%` }} />
      </div>
      <span className="capsule-from">
        <PersonAvatar person={capsule.from} size={22} />
        {capsule.from.id === me.id ? `Scellée par toi le ${longDate(capsule.createdAt)}` : `Scellée par ${capsule.from.displayName}`}
      </span>
    </div>
  )
}

function Opened({ capsule, onRemove }: { capsule: OpenedCapsule; onRemove: () => void }) {
  const { current, playing, playTracks, toggle } = usePlayer()
  const isCurrent = current?.id === capsule.track.id
  return (
    <li className="capsule-opened">
      <Cover src={images.track(capsule.track)} size={64} />
      <span className="title-text">
        <span className="track-name">{capsule.track.title}</span>
        <span className="track-artist">{capsule.track.artistName}</span>
        {capsule.message && <span className="capsule-message">« {capsule.message} »</span>}
        <span className="capsule-from muted">
          <PersonAvatar person={capsule.from} size={18} /> {capsule.from.displayName} • scellée le {longDate(capsule.createdAt)}
        </span>
      </span>
      <PlayButton playing={isCurrent && playing} onClick={() => (isCurrent ? toggle() : playTracks([capsule.track], 0))} />
      <button className="pill-button small outline" onClick={onRemove}>
        Effacer
      </button>
    </li>
  )
}
