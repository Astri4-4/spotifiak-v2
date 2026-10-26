import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Track } from '../api'
import { useCollection } from '../collection/context'
import { ChevronRightIcon, MoreIcon, PlusIcon } from '../icons'
import { PopoverMenu } from './PopoverMenu'

interface TrackMenuProps {
  track: Track
  /** Shown when the list is a playlist the user can edit. */
  onRemoveFromPlaylist?: () => void
}

export function TrackMenu({ track, onRemoveFromPlaylist }: TrackMenuProps) {
  const navigate = useNavigate()
  const { likedIds, toggleLike, playlists, createPlaylist, addToPlaylist } = useCollection()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [submenu, setSubmenu] = useState(false)

  const close = () => {
    setAnchor(null)
    setSubmenu(false)
  }
  const run = (action: () => void) => () => {
    close()
    action()
  }

  return (
    <>
      <button
        className={`more-button${anchor ? ' open' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          if (anchor) close()
          else setAnchor(e.currentTarget)
        }}
        aria-label={`Plus d'options pour ${track.title}`}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
      >
        <MoreIcon />
      </button>

      {anchor && (
        <PopoverMenu anchor={anchor} onClose={close} label={`Options pour ${track.title}`}>
          {submenu ? (
            <>
              <button role="menuitem" className="menu-item menu-back" onClick={() => setSubmenu(false)}>
                ‹ Ajouter à la playlist
              </button>
              <hr className="menu-separator" />
              <button
                role="menuitem"
                className="menu-item with-icon"
                onClick={run(() =>
                  void createPlaylist([track.id]).then((id) => navigate(`/playlist/${id}`)),
                )}
              >
                <PlusIcon /> Nouvelle playlist
              </button>
              {playlists.length > 0 && <hr className="menu-separator" />}
              <div className="menu-scroll">
                {playlists.map((p) => (
                  <button
                    key={p.id}
                    role="menuitem"
                    className="menu-item"
                    onClick={run(() => void addToPlaylist(p, [track.id]))}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <button role="menuitem" className="menu-item with-chevron" onClick={() => setSubmenu(true)}>
                Ajouter à la playlist <ChevronRightIcon />
              </button>
              {onRemoveFromPlaylist && (
                <button role="menuitem" className="menu-item" onClick={run(onRemoveFromPlaylist)}>
                  Retirer de cette playlist
                </button>
              )}
              <button role="menuitem" className="menu-item" onClick={run(() => toggleLike(track.id))}>
                {likedIds.has(track.id) ? 'Retirer des Titres likés' : 'Ajouter aux Titres likés'}
              </button>
              <hr className="menu-separator" />
              <button role="menuitem" className="menu-item" onClick={run(() => navigate(`/artist/${track.artistId}`))}>
                Accéder à l'artiste
              </button>
              {track.album && (
                <button
                  role="menuitem"
                  className="menu-item"
                  onClick={run(() => navigate(`/album/${track.album!.id}`))}
                >
                  Accéder à l'album
                </button>
              )}
            </>
          )}
        </PopoverMenu>
      )}
    </>
  )
}
