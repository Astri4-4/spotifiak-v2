import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { images, social, type Person, type Relation } from '../api'
import { useCollection } from '../collection/context'
import { Cover } from '../components/Cover'
import { MobileHeader } from '../components/Mobile'
import { PersonAvatar } from '../components/PersonAvatar'
import { formatAgo } from '../format'
import { useFetch, useIsMobile } from '../hooks'
import { BellIcon, SearchIcon } from '../icons'
import { usePlayer } from '../player/context'
import { useSocial } from '../social/context'

const SEARCH_DEBOUNCE_MS = 250
// Activity is refreshed this often while the page is open.
const ACTIVITY_POLL_MS = 30_000

/** The button for someone, from where you stand with them. */
function RelationButton({ person, relation, onChange }: { person: Person; relation: Relation; onChange: () => void }) {
  const { notify } = useCollection()
  const { refreshCounts, refreshFriends } = useSocial()
  const run = (action: () => Promise<unknown>, done?: string) => () =>
    void action()
      .then(() => {
        if (done) notify(done)
        onChange()
        refreshCounts()
        refreshFriends()
      })
      .catch((err: Error) => notify(err.message))

  switch (relation) {
    case 'friend':
      return <span className="muted">Amis</span>
    case 'sent':
      return (
        <button className="pill-button small outline" onClick={run(() => social.removeFriend(person.id))}>
          Annuler la demande
        </button>
      )
    case 'received':
      return (
        <span className="friend-actions">
          <button className="pill-button small" onClick={run(() => social.acceptFriend(person.id), `Vous êtes amis avec ${person.displayName}`)}>
            Accepter
          </button>
          <button className="pill-button small outline" onClick={run(() => social.removeFriend(person.id))}>
            Refuser
          </button>
        </span>
      )
    default:
      return (
        <button
          className="pill-button small"
          onClick={run(() => social.addFriend(person.id), `Demande envoyée à ${person.displayName}`)}
        >
          Ajouter
        </button>
      )
  }
}

function PersonRow({ person, detail, children }: { person: Person; detail?: string; children?: React.ReactNode }) {
  return (
    <li className="person-row">
      <Link to={`/user/${person.id}`} className="person-link">
        <PersonAvatar person={person} />
        <span className="title-text">
          <span className="track-name">{person.displayName}</span>
          <span className="track-artist">{detail ?? `@${person.username}`}</span>
        </span>
      </Link>
      {children}
    </li>
  )
}

function PeopleSearch({ onChange }: { onChange: () => void }) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])
  const { data } = useFetch(() => (debounced ? social.people(debounced) : Promise.resolve(null)), [debounced, version], {
    keepPrevious: true,
  })

  return (
    <section className="scan-card">
      <h2 className="settings-title">Ajouter des amis</h2>
      <label className="add-tracks-search">
        <SearchIcon />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom ou nom d'utilisateur" />
      </label>
      {debounced && data && (
        <ul className="person-list">
          {data.length === 0 && <li className="muted">Personne ne correspond à « {debounced} »</li>}
          {data.map((p) => (
            <PersonRow key={p.id} person={p}>
              <RelationButton
                person={p}
                relation={p.relation}
                onChange={() => {
                  setVersion((v) => v + 1)
                  onChange()
                }}
              />
            </PersonRow>
          ))}
        </ul>
      )}
    </section>
  )
}

/** What friends listen to now or last; a track plays on click. */
function Activity() {
  const [version, setVersion] = useState(0)
  const { data } = useFetch(() => social.activity(), [version], { keepPrevious: true })
  const { playTracks } = usePlayer()
  useEffect(() => {
    const timer = setInterval(() => setVersion((v) => v + 1), ACTIVITY_POLL_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <section className="scan-card">
      <h2 className="settings-title">Activité de vos amis</h2>
      {data && data.length === 0 && <p className="muted">Vos amis n'ont encore rien écouté, ou ne partagent pas leur activité.</p>}
      <ul className="person-list">
        {data?.map((a) => (
          <li key={a.user.id} className="person-row activity-row">
            <Link to={`/user/${a.user.id}`} className="person-link">
              <PersonAvatar person={a.user} />
            </Link>
            <span className="title-text">
              <Link to={`/user/${a.user.id}`} className="track-name">
                {a.user.displayName}
              </Link>
              <button className="activity-track" onClick={() => playTracks([a.track], 0)} title={`Écouter ${a.track.title}`}>
                <Cover src={images.track(a.track)} size={20} /> {a.track.title} • {a.track.artistName}
              </button>
            </span>
            <span className={a.listening ? 'listening-now' : 'muted'}>{a.listening ? 'En écoute' : formatAgo(a.playedAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** /friends: requests, activity, people search and the friends list. */
export function FriendsPage() {
  const [version, setVersion] = useState(0)
  const { data } = useFetch(() => social.friends(), [version], { keepPrevious: true })
  const { unread } = useSocial()
  const isMobile = useIsMobile()
  const reload = () => setVersion((v) => v + 1)

  return (
    <div className="page">
      <div className="page-gradient" />
      <div className="page-inner settings-page friends-page">
        {isMobile ? <MobileHeader title="Amis" /> : <h1 className="greeting">Amis</h1>}
        <Link to="/inbox" className="pill-button outline small inbox-link">
          <BellIcon /> Notifications{unread > 0 && <span className="badge">{unread}</span>}
        </Link>

        {!!data?.incoming.length && (
          <section className="scan-card">
            <h2 className="settings-title">Demandes d'amis</h2>
            <ul className="person-list">
              {data.incoming.map((p) => (
                <PersonRow key={p.id} person={p} detail={`@${p.username} • ${formatAgo(p.sentAt)}`}>
                  <RelationButton person={p} relation="received" onChange={reload} />
                </PersonRow>
              ))}
            </ul>
          </section>
        )}

        <Activity />
        <PeopleSearch onChange={reload} />

        <section className="scan-card">
          <h2 className="settings-title">Vos amis {data && <span className="muted">({data.friends.length})</span>}</h2>
          {data && data.friends.length === 0 && <p className="muted">Cherchez quelqu'un ci-dessus pour l'ajouter.</p>}
          <ul className="person-list">
            {data?.friends.map((p) => (
              <PersonRow key={p.id} person={p} />
            ))}
          </ul>
          {!!data?.outgoing.length && (
            <>
              <h3 className="settings-subtitle">Demandes envoyées</h3>
              <ul className="person-list">
                {data.outgoing.map((p) => (
                  <PersonRow key={p.id} person={p}>
                    <RelationButton person={p} relation="sent" onChange={reload} />
                  </PersonRow>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
