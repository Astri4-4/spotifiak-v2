import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, social, type MixDetail, type Person } from '../api'
import { useCurrentUser } from '../auth/context'
import { MixCover } from '../components/MixCover'
import { PersonAvatar } from '../components/PersonAvatar'
import { PlayButton } from '../components/PlayButton'
import { TrackList } from '../components/TrackList'
import { pluralize } from '../format'
import { useFetch } from '../hooks'
import { usePlayContext } from '../player/usePlayContext'

const TYPES: Record<MixDetail['kind'], string> = {
  daily: 'Mix',
  blend: 'Entre amis',
  weekly: 'Mix',
  radar: 'Mix',
  radio: 'Radio',
  genre: 'Genre',
  history: 'Historique',
  moment: 'Mix',
  place: 'Mix',
  skipped: 'Écartés',
}

const UPDATES: Partial<Record<MixDetail['kind'], string>> = {
  daily: 'Mis à jour chaque jour',
  blend: 'Mis à jour chaque jour',
  weekly: 'Mis à jour chaque lundi',
  radar: 'Mis à jour chaque lundi',
  moment: 'Mis à jour chaque heure',
}

/** A mix made by the server from what people listen to: Daily Mix, "Entre amis", radio, genre, history… */
export function MixPage() {
  const { id = '' } = useParams()
  const { data: mix, error } = useFetch(() => api.mix(id), [id])
  const { isPlaying, playTracks } = usePlayContext()
  const me = useCurrentUser()
  const contextId = `mix:${id}`
  // Skipped tracks taken back on this page.
  const [restored, setRestored] = useState<Set<string>>(new Set())

  if (error) {
    return (
      <div className="page">
        <div className="page-inner">
          <div className="empty-state">
            <h2>Ce mix n'est plus disponible</h2>
            <p>Les mixes changent chaque jour : retrouvez ceux du jour sur l'accueil.</p>
          </div>
        </div>
      </div>
    )
  }
  if (!mix) return <div className="page" aria-busy="true" />
  const tracks = mix.tracks.filter((t) => !restored.has(t.id))
  const restore = (trackId: string) =>
    void social.unskip(trackId).then(() => setRestored((prev) => new Set(prev).add(trackId)), () => {})

  return (
    <div className="page">
      <header className="entity-header">
        <MixCover mix={mix} className="entity-cover" quality="lg" />
        <div className="entity-info">
          <span className="entity-type">{TYPES[mix.kind]}</span>
          <h1 className="entity-title">{mix.title}</h1>
          <p className="entity-description">
            {mix.friend ? `Chaque titre vient de toi, de ${mix.friend.displayName} ou de vous deux.` : mix.description}
          </p>
          <div className="entity-meta">
            {mix.friend && <PersonAvatar person={mix.friend} size={24} />}
            <span>{[UPDATES[mix.kind], pluralize(tracks.length, 'titre')].filter(Boolean).join(' • ')}</span>
          </div>
        </div>
      </header>

      <div className="action-bar">
        <PlayButton size="lg" playing={isPlaying(contextId)} onClick={() => void playTracks(contextId, tracks, mix.title)} />
      </div>

      <div className="page-inner">
        <TrackList
          tracks={tracks}
          contextId={contextId}
          contextName={mix.title}
          variant="full"
          badges={
            mix.friend
              ? tracks.map((t) => t.from && <FromBadge key={t.id} from={t.from} me={me} friend={mix.friend!} />)
              : mix.kind === 'skipped'
                ? tracks.map((t) => (
                    <button key={t.id} className="pill-button small outline" onClick={() => restore(t.id)} aria-label={`Réentendre ${t.title} dans les mixes`}>
                      Réentendre
                    </button>
                  ))
                : undefined
          }
        />
      </div>
    </div>
  )
}

type Source = NonNullable<MixDetail['tracks'][number]['from']>

/** Whose taste an "Entre amis" track comes from: your picture, your friend's, or both. */
function FromBadge({ from, me, friend }: { from: Source; me: Person; friend: Person }) {
  const label = from === 'both' ? `De toi et ${friend.displayName}` : from === 'me' ? 'De toi' : `De ${friend.displayName}`
  return (
    <span className="mix-from" title={label}>
      {from !== 'friend' && <PersonAvatar person={me} size={22} />}
      {from !== 'me' && <PersonAvatar person={friend} size={22} />}
      <span className="visually-hidden">{label}</span>
    </span>
  )
}
