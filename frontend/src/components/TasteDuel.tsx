import { useState } from 'react'
import { images, social, type Duel, type Person, type Track } from '../api'
import { useCollection } from '../collection/context'
import { useFetch } from '../hooks'
import { usePlayer } from '../player/context'
import { Cover } from './Cover'
import { PersonAvatar } from './PersonAvatar'

/**
 * The weekly taste duel with each friend: a favourite of theirs you never heard, one of yours for
 * them; whoever's pick the other likes scores a point.
 */
export function TasteDuels() {
  const [version, setVersion] = useState(0)
  const { data: duels } = useFetch(() => social.duels(), [version])
  if (!duels?.length) return null
  return (
    <section className="scan-card">
      <h2 className="settings-title">Duel des goûts</h2>
      <p className="muted">Chaque semaine, un titre préféré de ton ami que tu n'as jamais écouté, et un des tiens pour lui.</p>
      <ul className="duel-list">
        {duels.map((duel) => (
          <DuelRow key={duel.friend.id} duel={duel} onVote={() => setVersion((v) => v + 1)} />
        ))}
      </ul>
    </section>
  )
}

function DuelRow({ duel, onVote }: { duel: Duel; onVote: () => void }) {
  const { notify } = useCollection()
  const vote = (liked: boolean) =>
    void social
      .voteDuel(duel.friend.id, liked)
      .then(onVote)
      .catch((err: Error) => notify(err.message))
  return (
    <li className="duel">
      <div className="duel-score" aria-label={`Score : toi ${duel.score.me}, ${duel.friend.displayName} ${duel.score.friend}`}>
        <span>Toi {duel.score.me}</span>
        <PersonAvatar person={duel.friend} size={28} />
        <span>
          {duel.score.friend} {duel.friend.displayName}
        </span>
      </div>
      {duel.forMe ? (
        <DuelTrack label={`Le choix de ${duel.friend.displayName} pour toi`} track={duel.forMe.track}>
          <span className="duel-votes" role="group" aria-label="Ton avis">
            <button className={`chip${duel.forMe.myVote === true ? ' selected' : ''}`} aria-pressed={duel.forMe.myVote === true} onClick={() => vote(true)}>
              J'aime
            </button>
            <button className={`chip${duel.forMe.myVote === false ? ' selected' : ''}`} aria-pressed={duel.forMe.myVote === false} onClick={() => vote(false)}>
              Pas pour moi
            </button>
          </span>
        </DuelTrack>
      ) : (
        <p className="muted">Tu as déjà écouté tous les préférés de {duel.friend.displayName} !</p>
      )}
      {duel.fromMe && (
        <DuelTrack label={`Ton choix pour ${duel.friend.displayName}`} track={duel.fromMe.track}>
          <span className="muted">{verdict(duel.fromMe.theirVote, duel.friend)}</span>
        </DuelTrack>
      )}
    </li>
  )
}

function verdict(vote: boolean | null, friend: Person) {
  if (vote === null) return 'Pas encore écouté'
  return vote ? `${friend.displayName} a aimé` : `${friend.displayName} n'a pas accroché`
}

function DuelTrack({ label, track, children }: { label: string; track: Track; children: React.ReactNode }) {
  const { playTracks } = usePlayer()
  return (
    <div className="duel-track">
      <span className="duel-label">{label}</span>
      <button className="duel-play" onClick={() => playTracks([track], 0)} aria-label={`Écouter ${track.title}`}>
        <Cover src={images.track(track)} size={48} />
        <span className="title-text">
          <span className="track-name">{track.title}</span>
          <span className="track-artist">{track.artistName}</span>
        </span>
      </button>
      {children}
    </div>
  )
}
