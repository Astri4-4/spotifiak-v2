import { Link } from 'react-router-dom'
import { collection } from '../api'
import { useCurrentUser } from '../auth/context'
import { useCollection } from '../collection/context'
import { LikedCover } from '../components/CollectionCovers'
import { PlayButton } from '../components/PlayButton'
import { TrackList } from '../components/TrackList'
import { pluralize } from '../format'
import { useFetch } from '../hooks'
import { HeartIcon } from '../icons'
import { LIKED_CONTEXT, usePlayContext } from '../player/usePlayContext'

// Spotify's "Liked Songs" header colour.
const LIKED_HEADER_COLOR = '80, 56, 160'

export function LikedPage() {
  const user = useCurrentUser()
  const { likesVersion } = useCollection()
  // Reload when a heart is toggled anywhere (this list, the player, another page).
  const { data: tracks } = useFetch(() => collection.liked(), [likesVersion], { keepPrevious: true })
  const { isPlaying, playTracks } = usePlayContext()

  return (
    <div className="page" style={{ '--header-color': LIKED_HEADER_COLOR } as React.CSSProperties}>
      <header className="entity-header">
        <LikedCover className="entity-cover" />
        <div className="entity-info">
          <span className="entity-type">Playlist</span>
          <h1 className="entity-title">Titres likés</h1>
          <div className="entity-meta">
            <span className="entity-meta-artist">{user.displayName}</span>
            {tracks && <span>• {pluralize(tracks.length, 'titre')}</span>}
          </div>
        </div>
      </header>

      {tracks && tracks.length > 0 && (
        <div className="action-bar">
          <PlayButton size="lg" playing={isPlaying(LIKED_CONTEXT)} onClick={() => void playTracks(LIKED_CONTEXT, tracks)} />
        </div>
      )}

      <div className="page-inner">
        {tracks && tracks.length === 0 ? (
          <div className="empty-state">
            <HeartIcon size={48} />
            <h2>Les titres que vous aimez s'afficheront ici</h2>
            <p>Enregistrez des titres en appuyant sur l'icône en forme de cœur.</p>
            <Link to="/search" className="pill-button">
              Rechercher des titres
            </Link>
          </div>
        ) : (
          tracks && <TrackList tracks={tracks} contextId={LIKED_CONTEXT} variant="full" />
        )}
      </div>
    </div>
  )
}
