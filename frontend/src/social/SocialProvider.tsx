import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { social, type Person } from '../api'
import { SocialContext, type SocialState } from './context'

// No push to browsers: the badge checks the server this often (and on focus).
const COUNTS_POLL_MS = 30_000

export function SocialProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState({ unread: 0, friendRequests: 0 })
  const [friends, setFriends] = useState<Person[]>([])

  const refreshCounts = useCallback(() => {
    social.counts().then(setCounts).catch(() => {})
  }, [])
  const refreshFriends = useCallback(() => {
    social
      .friends()
      .then((f) => setFriends(f.friends))
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshCounts()
    refreshFriends()
    const timer = setInterval(refreshCounts, COUNTS_POLL_MS)
    window.addEventListener('focus', refreshCounts)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refreshCounts)
    }
  }, [refreshCounts, refreshFriends])

  const value = useMemo<SocialState>(
    () => ({ ...counts, refreshCounts, friends, refreshFriends }),
    [counts, refreshCounts, friends, refreshFriends],
  )
  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>
}
