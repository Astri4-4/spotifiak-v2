import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/** The main view scrolls independently of the window; reset it on navigation. */
export function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    // Typing in search changes the path on every keystroke; don't jump while typing.
    if (pathname.startsWith('/search/')) return
    document.getElementById('main-view')?.scrollTo(0, 0)
  }, [pathname])
  return null
}
