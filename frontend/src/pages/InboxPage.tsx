import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { images, social } from '../api'
import { useCollection } from '../collection/context'
import { Cover } from '../components/Cover'
import { MobileHeader } from '../components/Mobile'
import { PersonAvatar } from '../components/PersonAvatar'
import { PlayButton } from '../components/PlayButton'
import { formatAgo } from '../format'
import { useFetch, useIsMobile } from '../hooks'
import { PlusIcon } from '../icons'
import { useJam } from '../jam/context'
import { usePlayer } from '../player/context'
import { useSocial } from '../social/context'

/** /inbox: tracks friends shared and their Jam invitations, newest first. Opening it marks them read. */
export function InboxPage() {
  const [version, setVersion] = useState(0)
  const { data, error } = useFetch(() => social.notifications(), [version], { keepPrevious: true })
  const { refreshCounts } = useSocial()
  const { notify } = useCollection()
  const { current, playing, playTracks, toggle } = usePlayer()
  const { join } = useJam()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const hasUnread = !!data?.some((n) => !n.read)

  // Shown once as unread (highlighted), then marked read on the server.
  useEffect(() => {
    if (hasUnread) void social.markRead().then(refreshCounts)
  }, [hasUnread, refreshCounts])

  const remove = (id: string) => void social.removeNotification(id).then(() => setVersion((v) => v + 1))

  return (
    <div className="page">
      <div className="page-gradient" />
      <div className="page-inner settings-page">
        {isMobile ? <MobileHeader title="Notifications" /> : <h1 className="greeting">Notifications</h1>}
        {error && <p className="error">{error}</p>}
        {data && data.length === 0 && (
          <p className="muted">
            Rien pour l'instant. Les titres que vos <Link to="/friends">amis</Link> partagent et leurs invitations à une Jam
            arrivent ici.
          </p>
        )}
        <ul className="person-list inbox-list">
          {data?.map((n) => (
            <li key={n.id} className={`person-row inbox-row${n.read ? '' : ' unread'}`}>
              <Link to={`/user/${n.from.id}`} className="person-link">
                <PersonAvatar person={n.from} />
              </Link>
              <span className="title-text">
                <span>
                  <Link to={`/user/${n.from.id}`} className="white">
                    {n.from.displayName}
                  </Link>{' '}
                  {n.type === 'share' ? 'vous a partagé un titre' : 'vous invite à sa Jam'}
                  <span className="muted"> • {formatAgo(n.createdAt)}</span>
                </span>
                {n.message && <span className="inbox-message">« {n.message} »</span>}
                {n.track && (
                  <span className="inbox-track">
                    <Cover src={images.track(n.track)} size={40} />
                    <span className="title-text">
                      <span className="track-name">{n.track.title}</span>
                      <span className="track-artist">{n.track.artistName}</span>
                    </span>
                    <PlayButton
                      playing={current?.id === n.track.id && playing}
                      onClick={() => (current?.id === n.track!.id ? toggle() : playTracks([n.track!], 0))}
                    />
                  </span>
                )}
              </span>
              {n.type === 'jam' &&
                (n.jamActive ? (
                  <button
                    className="pill-button small"
                    onClick={() =>
                      void join(n.jamId!)
                        .then(() => navigate('/'))
                        .catch((err: Error) => notify(err.message))
                    }
                  >
                    Rejoindre
                  </button>
                ) : (
                  <span className="muted">Terminée</span>
                ))}
              <button className="icon-button" onClick={() => remove(n.id)} aria-label="Supprimer la notification" title="Supprimer">
                <PlusIcon style={{ transform: 'rotate(45deg)' }} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
