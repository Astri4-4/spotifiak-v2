import { useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeftIcon, ChevronRightIcon, HomeFilledIcon, HomeIcon, LogoIcon, SearchIcon, UserIcon } from '../icons'

const SEARCH_PREFIX = '/search/'

export function TopBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const input = useRef<HTMLInputElement>(null)
  const routeQuery = location.pathname.startsWith(SEARCH_PREFIX)
    ? decodeURIComponent(location.pathname.slice(SEARCH_PREFIX.length))
    : ''

  // The input is uncontrolled: router updates are deferred, so a URL-driven value
  // would drop fast keystrokes. Sync from the URL only when the user isn't typing
  // (back/forward, leaving the search page).
  useEffect(() => {
    const el = input.current
    if (el && document.activeElement !== el && el.value !== routeQuery) el.value = routeQuery
  }, [routeQuery])

  // window.location, not the router's: router updates lag behind fast typing.
  const onSearchPage = () => window.location.pathname.startsWith('/search')

  const onChange = (value: string) => {
    const onSearch = onSearchPage()
    const target = value.trim() ? `${SEARCH_PREFIX}${encodeURIComponent(value)}` : '/search'
    // Typing replaces the history entry instead of adding one per keystroke.
    navigate(target, { replace: onSearch })
  }

  const isHome = location.pathname === '/'

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link to="/" className="logo" aria-label="Spotifiak">
          <LogoIcon size={32} />
        </Link>
        <button className="nav-arrow" onClick={() => navigate(-1)} aria-label="Retour">
          <ChevronLeftIcon />
        </button>
        <button className="nav-arrow" onClick={() => navigate(1)} aria-label="Avancer">
          <ChevronRightIcon />
        </button>
      </div>

      <div className="topbar-center">
        <Link to="/" className="home-button" aria-label="Accueil">
          {isHome ? <HomeFilledIcon size={24} /> : <HomeIcon size={24} />}
        </Link>
        <label className="search-box">
          <SearchIcon size={24} />
          <input
            ref={input}
            defaultValue={routeQuery}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => !onSearchPage() && navigate('/search')}
            placeholder="Que souhaitez-vous écouter ?"
            aria-label="Rechercher"
          />
        </label>
      </div>

      <div className="topbar-right">
        <button className="avatar" aria-label="Profil">
          <UserIcon />
        </button>
      </div>
    </header>
  )
}
