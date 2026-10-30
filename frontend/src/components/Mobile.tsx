import { useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { images } from '../api'
import { useDominantColor } from '../hooks'
import { ChevronLeftIcon, HomeFilledIcon, HomeIcon, JamIcon, LibraryIcon, PauseIcon, PlayIcon, QueueIcon, SearchIcon } from '../icons'
import { useJam } from '../jam/context'
import { usePlayer, useProgress } from '../player/context'
import { useSocial } from '../social/context'
import { artistLink } from '../podcasts'
import { Cover } from './Cover'
import { HeartButton } from './HeartButton'
import { ControlButtons, Progress } from './PlayerBar'
import { QueuePanel } from './QueuePanel'
import { UserMenu } from './UserMenu'

// Phone layout, like the Spotify app: a header per tab, a back button elsewhere,
// the mini player above the bottom tabs, and a full-screen player.

const TAB_ROOTS = ['/', '/search', '/library']

/** Tab page header: profile avatar (opens the account menu), title, actions. */
export function MobileHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mobile-header">
      <UserMenu />
      <h1>{title}</h1>
      {children && <span className="mobile-header-actions">{children}</span>}
    </header>
  )
}

/** Floating back arrow on pages opened from a tab (album, playlist...). */
export function MobileBackButton() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  if (TAB_ROOTS.includes(pathname) || pathname.startsWith('/search/')) return null
  // The router counts entries of this session in history.state.idx; a page opened
  // from a link has nothing to go back to, so go home.
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0
  return (
    <div className="mobile-back">
      <button onClick={() => (canGoBack ? navigate(-1) : navigate('/'))} aria-label="Retour">
        <ChevronLeftIcon size={20} />
      </button>
    </div>
  )
}

export function BottomNav() {
  const { pathname } = useLocation()
  const { unread, friendRequests } = useSocial()
  const pending = unread + friendRequests
  const tab = (to: string, label: string, icon: ReactNode, activeIcon: ReactNode, active: boolean) => (
    <NavLink to={to} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
      {active ? activeIcon : icon}
      <span>{label}</span>
    </NavLink>
  )
  return (
    <nav className="bottom-nav" aria-label="Navigation">
      {tab('/', 'Accueil', <HomeIcon size={24} />, <HomeFilledIcon size={24} />, pathname === '/')}
      {tab('/search', 'Rechercher', <SearchIcon size={24} />, <SearchIcon size={24} />, pathname.startsWith('/search'))}
      {tab('/library', 'Bibliothèque', <LibraryIcon size={24} />, <LibraryIcon size={24} />, pathname === '/library')}
      {tab(
        '/friends',
        'Amis',
        <span className="nav-icon">
          <JamIcon size={24} />
          {pending > 0 && <span className="badge">{pending}</span>}
        </span>,
        <span className="nav-icon">
          <JamIcon size={24} />
          {pending > 0 && <span className="badge">{pending}</span>}
        </span>,
        ['/friends', '/inbox', '/user/'].some((p) => pathname.startsWith(p)),
      )}
    </nav>
  )
}

function MiniProgress() {
  const { currentTime, duration } = useProgress()
  return (
    <span className="mini-progress">
      <span style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
    </span>
  )
}

/** Mini player above the tabs; tapping it opens the full-screen player. */
export function MobilePlayer() {
  const { current, playing, toggle } = usePlayer()
  const { jam } = useJam()
  const { color, fromImage } = useDominantColor()
  const { pathname } = useLocation()
  // Open on the page it was opened from: following a link (album, artist) closes it.
  const [openedOn, setOpenedOn] = useState<string | null>(null)

  if (!current) return null
  const cover = images.track(current)

  return (
    <>
      <div
        className="mini-player"
        style={{ '--header-color': color } as React.CSSProperties}
        onClick={() => setOpenedOn(pathname)}
        role="button"
        aria-label="Ouvrir le lecteur"
      >
        <Cover src={cover} size={40} onLoad={fromImage} />
        <span className="mini-player-text">
          <span className="mini-player-title">{current.title}</span>
          <span className="mini-player-artist">
            {jam && <span className="mini-player-jam">Jam · </span>}
            {current.artistName}
          </span>
        </span>
        {/* The buttons act on their own instead of opening the player. */}
        <span className="mini-player-buttons" onClick={(e) => e.stopPropagation()}>
          {!current.episode && <HeartButton trackId={current.id} />}
          <button className="mini-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Lecture'}>
            {playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
          </button>
        </span>
        <MiniProgress />
      </div>
      {openedOn === pathname && <FullPlayer color={color} onClose={() => setOpenedOn(null)} />}
    </>
  )
}

function FullPlayer({ color, onClose }: { color: string; onClose: () => void }) {
  const { current } = usePlayer()
  const { jam } = useJam()
  const [queueOpen, setQueueOpen] = useState(false)

  if (!current) return null

  return (
    <div className="full-player" style={{ '--header-color': color } as React.CSSProperties} role="dialog" aria-label="Lecteur">
      <header className="full-player-header">
        <button className="icon-button" onClick={onClose} aria-label="Réduire le lecteur">
          <ChevronLeftIcon size={20} style={{ transform: 'rotate(-90deg)' }} />
        </button>
        <span>{queueOpen ? "File d'attente" : jam ? `Jam de ${jam.host.displayName}` : 'En cours de lecture'}</span>
        <button
          className={`icon-button${queueOpen ? ' active' : ''}`}
          onClick={() => setQueueOpen(!queueOpen)}
          aria-label="File d'attente"
          aria-pressed={queueOpen}
        >
          <QueueIcon size={20} />
        </button>
      </header>

      {queueOpen ? (
        <QueuePanel />
      ) : (
        <div className="full-player-art">
          <Cover src={images.track(current)} quality="lg" className="full-player-cover" />
        </div>
      )}

      <div className="full-player-info">
        <span className="full-player-text">
          {current.album || current.episode ? (
            <Link
              to={current.episode ? `/podcast/${current.episode.podcastId}` : `/album/${current.album!.id}`}
              className="full-player-title"
            >
              {current.title}
            </Link>
          ) : (
            <span className="full-player-title">{current.title}</span>
          )}
          <Link to={artistLink(current)} className="full-player-artist">
            {current.artistName}
          </Link>
        </span>
        {!current.episode && <HeartButton trackId={current.id} />}
      </div>

      <Progress />
      <ControlButtons iconSize={24} />
      <div className="full-player-footer">
        <button
          className={`icon-button${jam ? ' active' : ''}`}
          onClick={() => setQueueOpen(true)}
          aria-label={jam ? 'Voir la Jam' : 'Démarrer une Jam'}
        >
          <JamIcon size={20} />
          {jam && <span>{jam.participants.length}</span>}
        </button>
      </div>
    </div>
  )
}
