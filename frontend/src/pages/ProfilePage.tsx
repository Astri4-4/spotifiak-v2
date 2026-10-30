import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { social } from '../api'
import { useCurrentUser } from '../auth/context'
import { useCollection } from '../collection/context'
import { Card } from '../components/Card'
import { PlaylistCover } from '../components/CollectionCovers'
import { PersonAvatar } from '../components/PersonAvatar'
import { Shelf } from '../components/Shelf'
import { TrackList } from '../components/TrackList'
import { formatAgo } from '../format'
import { useFetch } from '../hooks'
import { usePlayContext } from '../player/usePlayContext'
import { useSocial } from '../social/context'

/** /user/:id: someone's page, their friendship button, recent listens (friends) and public playlists. */
export function ProfilePage() {
  const { id = '' } = useParams()
  const [version, setVersion] = useState(0)
  const { data: profile, error } = useFetch(() => social.profile(id), [id, version], { keepPrevious: true })
  const { notify } = useCollection()
  const { refreshCounts, refreshFriends } = useSocial()
  const { isPlaying, playPlaylist } = usePlayContext()
  const me = useCurrentUser()

  if (error) {
    return (
      <div className="page">
        <div className="page-inner">
          <p className="error">{error}</p>
        </div>
      </div>
    )
  }
  if (!profile) return null
  const { user, relation } = profile
  const isMe = user.id === me.id

  const act = (action: () => Promise<unknown>, done?: string) =>
    void action()
      .then(() => {
        if (done) notify(done)
        setVersion((v) => v + 1)
        refreshCounts()
        refreshFriends()
      })
      .catch((err: Error) => notify(err.message))

  const last = profile.recentPlays[0]

  return (
    <div className="page">
      <div className="page-gradient" />
      <header className="entity-header">
        <PersonAvatar person={user} size={160} />
        <div className="entity-info">
          <span className="entity-type">Profil</span>
          <h1 className="entity-title">{user.displayName}</h1>
          <span className="muted">
            @{user.username}
            {last && ` • ${last.listening ? 'en écoute' : `écouté ${formatAgo(last.playedAt)}`}`}
          </span>
        </div>
      </header>

      <div className="action-bar">
        {relation === null && !isMe && (
          <button className="pill-button" onClick={() => act(() => social.addFriend(user.id), 'Demande envoyée')}>
            Ajouter en ami
          </button>
        )}
        {relation === 'received' && (
          <>
            <button className="pill-button" onClick={() => act(() => social.acceptFriend(user.id), `Vous êtes amis avec ${user.displayName}`)}>
              Accepter la demande
            </button>
            <button className="pill-button outline" onClick={() => act(() => social.removeFriend(user.id))}>
              Refuser
            </button>
          </>
        )}
        {relation === 'sent' && (
          <button className="pill-button outline" onClick={() => act(() => social.removeFriend(user.id))}>
            Annuler la demande
          </button>
        )}
        {relation === 'friend' && (
          <button
            className="pill-button outline"
            onClick={() => {
              if (window.confirm(`Retirer ${user.displayName} de vos amis ?`)) act(() => social.removeFriend(user.id))
            }}
          >
            Amis ✓
          </button>
        )}
      </div>

      <div className="page-inner">
        {relation === 'friend' && profile.recentPlays.length > 0 && (
          <section>
            <h2 className="section-title">Écoutes récentes</h2>
            <TrackList tracks={profile.recentPlays.map((p) => p.track)} contextId={`user:${user.id}`} contextName={user.displayName} variant="search" />
          </section>
        )}
        {profile.activityHidden && <p className="muted">{user.displayName} ne partage pas son activité d'écoute.</p>}
        {relation !== 'friend' && relation !== null && <p className="muted">Ses écoutes apparaîtront quand vous serez amis.</p>}
        {relation === null && !isMe && <p className="muted">Ajoutez {user.displayName} en ami pour voir ce qu'il ou elle écoute.</p>}
        {profile.playlists.length > 0 && (
          <Shelf title="Playlists publiques">
            {profile.playlists.map((p) => (
              <Card
                key={p.id}
                to={`/playlist/${p.id}`}
                title={p.name}
                subtitle={`${p.trackCount} titres`}
                image={null}
                cover={<PlaylistCover covers={p.covers} quality="md" />}
                playing={isPlaying(p.id)}
                onPlay={() => void playPlaylist(p.id, p.name)}
              />
            ))}
          </Shelf>
        )}
      </div>
    </div>
  )
}
