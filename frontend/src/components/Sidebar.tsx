import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { api, images } from '../api'
import { useCurrentUser } from '../auth/context'
import { useCollection } from '../collection/context'
import { LibraryIcon, PlusIcon, RefreshIcon, SearchIcon, VolumeIcon } from '../icons'
import { usePlayer } from '../player/context'
import { LIKED_CONTEXT } from '../player/usePlayContext'
import { LikedCover, PlaylistCover } from './CollectionCovers'
import { Cover } from './Cover'
import { MobileHeader } from './Mobile'

type Filter = 'all' | 'playlists' | 'albums' | 'artists' | 'podcasts'

interface Item {
  key: string
  to: string
  title: string
  subtitle: string
  cover: ReactNode
  /** Player context id, to highlight what is playing. */
  contextId: string
  /** Most recent first; pinned items (liked tracks) stay on top. */
  sortKey: string
  pinned?: boolean
}

// Cheap status check so the scan icon spins while a scan or Deezer lookup runs.
const SCAN_POLL_MS = 10_000

/** The library: the left panel on desktop, the Bibliothèque tab (`mobile`) on phones. */
export function Sidebar({ mobile = false }: { mobile?: boolean }) {
  const navigate = useNavigate()
  const user = useCurrentUser()
  const { contextId, playing } = usePlayer()
  // Only what the user added: saved albums and followed artists, not the whole server library.
  const { likedIds, playlists, savedAlbums: albums, followedArtists: artists, podcasts, createPlaylist } = useCollection()
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    const check = () =>
      api
        .scanStatus()
        .then((s) => setScanning(s.running || s.enrichment.running))
        .catch(() => setScanning(false))
    check()
    const interval = setInterval(check, SCAN_POLL_MS)
    return () => clearInterval(interval)
  }, [])

  const items = useMemo(() => {
    const show = (f: Filter) => filter === 'all' || filter === f
    const all: Item[] = [
      ...(show('playlists')
        ? [
            {
              key: 'liked',
              to: '/collection/tracks',
              title: 'Titres likés',
              subtitle: `Playlist • ${likedIds.size} titre${likedIds.size > 1 ? 's' : ''}`,
              cover: <LikedCover size={48} />,
              contextId: LIKED_CONTEXT,
              sortKey: '',
              pinned: true,
            },
            ...playlists.map((p) => ({
              key: `playlist-${p.id}`,
              to: `/playlist/${p.id}`,
              title: p.name,
              subtitle: `Playlist • ${user.displayName}`,
              cover: <PlaylistCover covers={p.covers} size={48} />,
              contextId: p.id,
              sortKey: p.updatedAt,
            })),
          ]
        : []),
      ...(show('albums')
        ? albums.map((a) => ({
            key: `album-${a.id}`,
            to: `/album/${a.id}`,
            title: a.title,
            subtitle: `Album • ${a.artist.name}`,
            cover: <Cover src={images.album(a)} size={48} />,
            contextId: a.id,
            sortKey: a.savedAt,
          }))
        : []),
      ...(show('artists')
        ? artists.map((a) => ({
            key: `artist-${a.id}`,
            to: `/artist/${a.id}`,
            title: a.name,
            subtitle: 'Artiste',
            cover: <Cover src={images.artist(a)} size={48} round />,
            contextId: a.id,
            sortKey: a.followedAt,
          }))
        : []),
      ...(show('podcasts')
        ? podcasts.map((p) => ({
            key: `podcast-${p.id}`,
            to: `/podcast/${p.id}`,
            title: p.title,
            subtitle: p.author ? `Podcast • ${p.author}` : 'Podcast',
            cover: <Cover src={images.podcast(p)} size={48} />,
            contextId: p.id,
            sortKey: p.subscribedAt,
          }))
        : []),
    ]
    const q = search.trim().toLowerCase()
    return all
      .filter((i) => !q || i.title.toLowerCase().includes(q) || i.subtitle.toLowerCase().includes(q))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.sortKey.localeCompare(a.sortKey))
  }, [albums, artists, podcasts, playlists, likedIds.size, filter, search, user.displayName])

  const chip = (value: Exclude<Filter, 'all'>, label: string) => (
    <button
      className={`chip${filter === value ? ' selected' : ''}`}
      onClick={() => setFilter(filter === value ? 'all' : value)}
    >
      {label}
    </button>
  )

  const headerActions = (
    <>
      <Link
        to="/scan"
        className={`icon-button${scanning ? ' scanning' : ''}`}
        aria-label="Analyse de la bibliothèque"
        title={scanning ? 'Analyse en cours…' : 'Analyse de la bibliothèque'}
      >
        <RefreshIcon className={scanning ? 'spin' : undefined} />
      </Link>
      <button
        className="icon-button create-button"
        onClick={() => void createPlaylist().then((id) => navigate(`/playlist/${id}`))}
        aria-label="Créer une playlist"
        title="Créer une playlist"
      >
        <PlusIcon />
      </button>
    </>
  )

  return (
    <aside className={mobile ? 'sidebar mobile' : 'sidebar panel'}>
      {mobile ? (
        <MobileHeader title="Bibliothèque">{headerActions}</MobileHeader>
      ) : (
        <header className="sidebar-header">
          <h2>
            <LibraryIcon size={24} />
            <span>Bibliothèque</span>
          </h2>
          <span className="sidebar-header-actions">{headerActions}</span>
        </header>
      )}

      <div className="chips">
        {chip('playlists', 'Playlists')}
        {chip('albums', 'Albums')}
        {chip('artists', 'Artistes')}
        {chip('podcasts', 'Podcasts')}
      </div>

      <div className="sidebar-tools">
        <label className={`library-search${searchOpen ? ' open' : ''}`}>
          <button className="icon-button" onClick={() => setSearchOpen(true)} aria-label="Rechercher dans la bibliothèque">
            <SearchIcon />
          </button>
          {searchOpen && (
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => !search && setSearchOpen(false)}
              placeholder="Rechercher dans Bibliothèque"
            />
          )}
        </label>
        <span className="sort-label">Récents</span>
      </div>

      <ul className="library-list">
        {items.map((item) => {
          const active = contextId === item.contextId
          return (
            <li key={item.key}>
              <NavLink to={item.to} className="library-item">
                {item.cover}
                <span className="library-item-text">
                  <span className={`library-item-title${active ? ' playing' : ''}`}>{item.title}</span>
                  <span className="library-item-subtitle">{item.subtitle}</span>
                </span>
                {active && playing && <VolumeIcon className="library-item-playing" />}
              </NavLink>
            </li>
          )
        })}
        {!items.length && (
          <li className="library-empty">
            {search ? 'Aucun résultat' : 'Votre bibliothèque est vide.'}
          </li>
        )}
      </ul>
    </aside>
  )
}
