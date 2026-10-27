import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SearchIcon } from '../icons'

const SEARCH_PREFIX = '/search/'

/** The search field: typing updates /search/:query. In the top bar, or the search tab on phones. */
export function SearchInput({ className = '' }: { className?: string }) {
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

  return (
    <label className={`search-box ${className}`}>
      <SearchIcon size={24} />
      <input
        ref={input}
        defaultValue={routeQuery}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => !onSearchPage() && navigate('/search')}
        placeholder="Que souhaitez-vous écouter ?"
        aria-label="Rechercher"
        enterKeyHint="search"
      />
    </label>
  )
}
