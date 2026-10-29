import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { jam as jamApi, type JamPerson } from '../api'
import { useCurrentUser } from '../auth/context'
import { useCollection } from '../collection/context'
import { useFetch } from '../hooks'
import { JamIcon, PlusIcon } from '../icons'
import { useJam } from '../jam/context'
import { usePlayer, useProgress } from '../player/context'

function Avatar({ person }: { person: JamPerson }) {
  return (
    <span className="avatar-initial" title={person.displayName}>
      {person.displayName.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

const inviteUrl = (id: string) => `${window.location.origin}/jam/${id}`

/** Top of the queue panel: start a Jam, or who's in it, the invite link and leave/end. */
export function JamSection() {
  const user = useCurrentUser()
  const { notify } = useCollection()
  const { jam, start, leave, removeParticipant } = useJam()
  const { current, upNext, playing, contextName } = usePlayer()
  const { currentTime } = useProgress()
  const [busy, setBusy] = useState(false)

  if (!jam) {
    const onStart = async () => {
      setBusy(true)
      try {
        // The Jam starts with what is playing here, from the current track on; a
        // podcast episode stays out of it (the Jam shares library tracks).
        const tracks = current && !current.episode ? [current, ...upNext] : []
        // What comes next becomes the Jam's fallback: tracks people add play first.
        await start({
          trackIds: tracks.map((t) => t.id),
          index: 0,
          position: tracks.length ? currentTime : 0,
          playing: !!tracks.length && playing,
          source: contextName ?? undefined,
        })
      } catch (err) {
        notify((err as Error).message)
      } finally {
        setBusy(false)
      }
    }
    return (
      <section className="jam-card">
        <h3>
          <JamIcon size={20} /> Démarrer une Jam
        </h3>
        <p>Écoutez ensemble, chacun sur son appareil. Tout le monde peut ajouter des titres et contrôler la lecture.</p>
        <button className="pill-button small" onClick={() => void onStart()} disabled={busy}>
          Démarrer une Jam
        </button>
      </section>
    )
  }

  const isHost = jam.host.id === user.id
  const url = inviteUrl(jam.id)

  const share = async () => {
    // Phones: the system share sheet. Elsewhere: the clipboard (HTTPS or localhost only).
    if (navigator.share) {
      await navigator.share({ title: 'Rejoindre ma Jam', url }).catch(() => {})
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(url)
      notify('Lien copié')
    } else {
      window.prompt('Copiez le lien de la Jam :', url)
    }
  }

  return (
    <section className="jam-card active">
      <h3>
        <JamIcon size={20} /> {isHost ? 'Votre Jam' : `Jam de ${jam.host.displayName}`}
      </h3>
      <ul className="jam-people">
        {jam.participants.map((p) => (
          <li key={p.id}>
            <Avatar person={p} />
            <span className="jam-person-name">
              {p.displayName}
              {p.id === user.id && ' (vous)'}
            </span>
            {p.id === jam.host.id ? (
              <span className="jam-host">Hôte</span>
            ) : (
              isHost && (
                <button
                  className="icon-button"
                  onClick={() => void removeParticipant(p.id)}
                  aria-label={`Retirer ${p.displayName} de la Jam`}
                  title="Retirer de la Jam"
                >
                  <PlusIcon style={{ transform: 'rotate(45deg)' }} />
                </button>
              )
            )}
          </li>
        ))}
      </ul>
      <div className="jam-invite">
        <code>{url}</code>
        <button className="pill-button small" onClick={() => void share()}>
          Inviter
        </button>
      </div>
      <button className="pill-button small outline" onClick={() => void leave()}>
        {isHost ? 'Mettre fin à la Jam' : 'Quitter la Jam'}
      </button>
    </section>
  )
}

/** /jam/:code — the invitation link. */
export function JamPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { jam, join } = useJam()
  const { data: invite, error } = useFetch(() => jamApi.invite(id), [id])
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  const onJoin = async () => {
    setJoining(true)
    setJoinError(null)
    try {
      await join(id)
      navigate('/')
    } catch (err) {
      setJoinError((err as Error).message)
      setJoining(false)
    }
  }

  const alreadyIn = invite?.joined || jam?.id === invite?.id

  return (
    <div className="page">
      <div className="page-gradient" />
      <div className="page-inner jam-page">
        <JamIcon size={48} />
        {error && (
          <>
            <h1>Jam introuvable</h1>
            <p className="muted">{error}</p>
          </>
        )}
        {invite && (
          <>
            <h1>{alreadyIn ? 'Vous êtes dans cette Jam' : `${invite.host.displayName} vous invite à sa Jam`}</h1>
            <p className="muted">
              Écoutez la même musique en même temps, chacun sur son appareil. Tout le monde peut ajouter des titres et
              contrôler la lecture.
            </p>
            <div className="jam-avatars">
              {invite.participants.map((p) => (
                <Avatar key={p.id} person={p} />
              ))}
            </div>
            {jam && !alreadyIn && <p className="muted">Vous quitterez la Jam en cours.</p>}
            {joinError && <p className="error">{joinError}</p>}
            {alreadyIn ? (
              <button className="pill-button" onClick={() => navigate('/')}>
                Continuer
              </button>
            ) : (
              <button className="pill-button jam-join" onClick={() => void onJoin()} disabled={joining}>
                Rejoindre la Jam
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
