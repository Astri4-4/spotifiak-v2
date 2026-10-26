import { useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { api, images, type Album, type Artist } from '../api'
import { LibraryIcon, SearchIcon, VolumeIcon } from '../icons'
import { usePlayer } from '../player/context'
import { Cover } from './Cover'

type Filter = 'all' | 'albums' | 'artists'

type Item =
  | { kind: 'album'; id: string; title: string; subtitle: string; image: string | null; sortKey: string }
  | { kind: 'artist'; id: string; title: string; subtitle: string; image: string | null; sortKey: string }

// The library changes when deemix finishes downloads; refresh periodically.
const REFRESH_MS = 60_000

export function Sidebar() {
  const { contextId, playing } = usePlayer()
  const [albums, setAlbums] = useState<Album[]>([])
  const [artists, setArtists] = useState<Artist[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const load = () => {
      api.albums().then((r) => setAlbums(r.items)).catch(() => {})
      api.artists().then((r) => setArtists(r.items)).catch(() => {})
    }
    load()
    const interval = setInterval(load, REFRESH_MS)
    return () => clearInterval(interval)
  }, [])

  const items = useMemo(() => {
    const all: Item[] = [
      ...(filter !== 'artists'
        ? albums.map((a) => ({
            kind: 'album' as const,
            id: a.id,
            title: a.title,
            subtitle: `Album • ${a.artist.name}`,
            image: images.album(a),
            sortKey: a.createdAt,
          }))
        : []),
      ...(filter !== 'albums'
        ? artists.map((a) => ({
            kind: 'artist' as const,
            id: a.id,
            title: a.name,
            subtitle: 'Artiste',
            image: images.artist(a),
            sortKey: '',
          }))
        : []),
    ]
    const q = search.trim().toLowerCase()
    return all
      .filter((i) => !q || i.title.toLowerCase().includes(q) || i.subtitle.toLowerCase().includes(q))
      .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
  }, [albums, artists, filter, search])

  const chip = (value: Exclude<Filter, 'all'>, label: string) => (
    <button
      className={`chip${filter === value ? ' selected' : ''}`}
      onClick={() => setFilter(filter === value ? 'all' : value)}
    >
      {label}
    </button>
  )

  return (
    <aside className="sidebar panel">
      <header className="sidebar-header">
        <h2>
          <LibraryIcon size={24} />
          Bibliothèque
        </h2>
      </header>

      <div className="chips">
        {chip('albums', 'Albums')}
        {chip('artists', 'Artistes')}
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
          const active = contextId === item.id
          return (
            <li key={`${item.kind}-${item.id}`}>
              <NavLink to={`/${item.kind}/${item.id}`} className="library-item">
                <Cover src={item.image} size={48} round={item.kind === 'artist'} />
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
            {search ? 'Aucun résultat' : 'Votre bibliothèque est vide. Cherchez des titres pour les télécharger.'}
          </li>
        )}
      </ul>
    </aside>
  )
}
