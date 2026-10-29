import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, collection, images, type PlaylistDetail, type PlaylistEntry, type Track } from '../api'
import { useCollection } from '../collection/context'
import { PlaylistCover } from '../components/CollectionCovers'
import { Cover } from '../components/Cover'
import { Dialog } from '../components/Dialog'
import { PlayButton } from '../components/PlayButton'
import { PopoverMenu } from '../components/PopoverMenu'
import { TrackList } from '../components/TrackList'
import { formatDuration, formatTotalDuration, pluralize } from '../format'
import { useDominantColor, useFetch } from '../hooks'
import { MoreIcon, PencilIcon, SearchIcon, ShuffleIcon } from '../icons'
import { usePlayer } from '../player/context'
import { usePlayContext } from '../player/usePlayContext'

const SEARCH_DEBOUNCE_MS = 250

// Keyed by id so per-playlist state (colour, dialogs, search) starts fresh on navigation.
export function PlaylistPage() {
  const { id = '' } = useParams()
  return <PlaylistView key={id} id={id} />
}

function EditDialog({ playlist, onClose, onSaved }: { playlist: PlaylistDetail; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(playlist.name)
  const [description, setDescription] = useState(playlist.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await collection.updatePlaylist(playlist.id, { name, description })
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog title="Modifier les informations" onClose={onClose}>
      <form className="edit-playlist" onSubmit={onSubmit}>
        <PlaylistCover covers={playlist.covers} className="edit-playlist-cover" quality="md" />
        <div className="edit-playlist-fields">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Ajouter un nom" aria-label="Nom" autoFocus />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={300}
            placeholder="Ajouter une description (facultatif)"
            aria-label="Description"
          />
        </div>
        {error && <p className="error edit-playlist-error">{error}</p>}
        <button className="pill-button edit-playlist-save" disabled={busy || !name.trim()}>
          Enregistrer
        </button>
      </form>
    </Dialog>
  )
}

/** "Let's find something for your playlist", at the bottom of the page like Spotify. */
function AddTracks({ onAdd }: { onAdd: (track: Track) => void }) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])
  const { data } = useFetch(() => (debounced ? api.search(debounced) : Promise.resolve(null)), [debounced], {
    keepPrevious: true,
  })

  return (
    <section className="add-tracks">
      <h2 className="section-title">Ajoutons quelque chose à votre playlist</h2>
      <label className="add-tracks-search">
        <SearchIcon />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher des titres" />
      </label>
      {debounced && data && (
        <ul className="add-tracks-results">
          {data.tracks.length === 0 && <li className="muted">Aucun titre trouvé pour « {debounced} »</li>}
          {data.tracks.slice(0, 10).map((track) => (
            <li key={track.id} className="add-tracks-row">
              <Cover src={images.track(track)} size={40} />
              <span className="title-text">
                <span className="track-name">{track.title}</span>
                <span className="track-artist">{track.artistName}</span>
              </span>
              <span className="muted add-tracks-album">{track.album?.title}</span>
              <span className="muted">{formatDuration(track.durationSec)}</span>
              <button className="pill-button outline small" onClick={() => onAdd(track)}>
                Ajouter
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function PlaylistView({ id }: { id: string }) {
  const navigate = useNavigate()
  const { refreshPlaylists, notify, likesVersion } = useCollection()
  const [version, setVersion] = useState(0)
  const reload = () => {
    setVersion((v) => v + 1)
    refreshPlaylists()
  }
  const { data: playlist, error } = useFetch(() => collection.playlist(id), [id, version, likesVersion], {
    keepPrevious: true,
  })
  // Local order while a move is saved, so the row lands immediately.
  const [optimistic, setOptimistic] = useState<PlaylistEntry[] | null>(null)
  const { color, fromImage } = useDominantColor()
  const { isPlaying, playTracks, playShuffled } = usePlayContext()
  const { contextId, shuffle } = usePlayer()
  const [editing, setEditing] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  if (error) return <div className="page page-inner error">Playlist introuvable.</div>
  if (!playlist) return <div className="page" />

  const owned = playlist.owned
  const entries = optimistic ?? playlist.entries
  const tracks = entries.map((e) => e.track)
  const total = tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0)

  const move = async (from: number, before: number) => {
    const next = [...entries]
    const [moved] = next.splice(from, 1)
    next.splice(before > from ? before - 1 : before, 0, moved)
    setOptimistic(next)
    try {
      await collection.moveInPlaylist(id, moved.id, entries[before]?.id ?? null)
    } catch (err) {
      notify((err as Error).message)
    }
    reload()
    setOptimistic(null)
  }

  const remove = async (index: number) => {
    await collection.removeFromPlaylist(id, entries[index].id)
    notify(`Retiré de « ${playlist.name} »`)
    reload()
  }

  const add = async (track: Track) => {
    await collection.addToPlaylist(id, [track.id])
    notify(`Ajouté à « ${playlist.name} »`)
    reload()
  }

  const togglePublic = async () => {
    setMenuAnchor(null)
    try {
      await collection.updatePlaylist(id, { public: !playlist.public })
      notify(playlist.public ? 'Playlist rendue privée' : "Playlist publique : tout le monde peut l'écouter")
      reload()
    } catch (err) {
      notify((err as Error).message)
    }
  }

  const deletePlaylist = async () => {
    setMenuAnchor(null)
    if (!window.confirm(`Supprimer « ${playlist.name} » ? Cette action est définitive.`)) return
    await collection.deletePlaylist(id)
    refreshPlaylists()
    notify('Playlist supprimée')
    navigate('/')
  }

  return (
    <div className="page" style={{ '--header-color': color } as React.CSSProperties}>
      <header className="entity-header">
        {/* Hidden image only to sample the header colour from the first cover. */}
        {playlist.covers[0] && (
          <Cover src={images.mosaic(playlist.covers[0])} className="color-probe" onLoad={fromImage} />
        )}
        {owned ? (
          <button className="entity-cover-button" onClick={() => setEditing(true)} aria-label="Modifier les informations">
            <PlaylistCover covers={playlist.covers} className="entity-cover" quality="lg" />
            <span className="entity-cover-edit">
              <PencilIcon size={32} />
              Modifier
            </span>
          </button>
        ) : (
          <PlaylistCover covers={playlist.covers} className="entity-cover" quality="lg" />
        )}
        <div className="entity-info">
          <span className="entity-type">{playlist.public ? 'Playlist publique' : 'Playlist privée'}</span>
          {owned ? (
            <h1
              className={`entity-title editable${playlist.name.length > 24 ? ' long' : ''}`}
              onClick={() => setEditing(true)}
              title="Modifier les informations"
            >
              {playlist.name}
            </h1>
          ) : (
            <h1 className={`entity-title${playlist.name.length > 24 ? ' long' : ''}`}>{playlist.name}</h1>
          )}
          {playlist.description && <p className="entity-description">{playlist.description}</p>}
          <div className="entity-meta">
            <span className="entity-meta-artist">{playlist.owner.displayName}</span>
            <span>
              • {pluralize(tracks.length, 'titre')}
              {total > 0 && <span className="muted">, {formatTotalDuration(total)}</span>}
            </span>
          </div>
        </div>
      </header>

      <div className="action-bar">
        {tracks.length > 0 && (
          <>
            <PlayButton size="lg" playing={isPlaying(id)} onClick={() => void playTracks(id, tracks, playlist.name)} />
            <button
              className={`icon-button action-shuffle${shuffle && contextId === id ? ' active' : ''}`}
              onClick={() => void playShuffled(id, tracks, playlist.name)}
              aria-label={`Lecture aléatoire de ${playlist.name}`}
              title="Lecture aléatoire"
            >
              <ShuffleIcon size={28} />
            </button>
          </>
        )}
        {owned && (
          <>
            <button
              className="icon-button action-more"
              onClick={(e) => setMenuAnchor(menuAnchor ? null : e.currentTarget)}
              aria-label={`Plus d'options pour ${playlist.name}`}
              aria-haspopup="menu"
            >
              <MoreIcon size={24} />
            </button>
            {menuAnchor && (
              <PopoverMenu anchor={menuAnchor} onClose={() => setMenuAnchor(null)} label={`Options pour ${playlist.name}`}>
                <button
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setMenuAnchor(null)
                    setEditing(true)
                  }}
                >
                  Modifier les informations
                </button>
                <button role="menuitem" className="menu-item" onClick={() => void togglePublic()}>
                  {playlist.public ? 'Rendre privée' : 'Rendre publique'}
                </button>
                <button role="menuitem" className="menu-item danger" onClick={() => void deletePlaylist()}>
                  Supprimer
                </button>
              </PopoverMenu>
            )}
          </>
        )}
      </div>

      <div className="page-inner">
        {tracks.length > 0 && (
          <TrackList
            tracks={tracks}
            contextId={id}
            contextName={playlist.name}
            variant="full"
            rowKeys={entries.map((e) => e.id)}
            onRemove={owned ? (i) => void remove(i) : undefined}
            onMove={owned ? (from, before) => void move(from, before) : undefined}
          />
        )}
        {owned && <AddTracks onAdd={(t) => void add(t)} />}
      </div>

      {editing && <EditDialog playlist={playlist} onClose={() => setEditing(false)} onSaved={reload} />}
    </div>
  )
}
