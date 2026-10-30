import { createContext, useContext } from 'react'
import type { Person } from '../api'

export interface SocialState {
  /** Unread notifications and friend requests waiting for an answer: the badge. */
  unread: number
  friendRequests: number
  refreshCounts: () => void
  /** Accepted friends, for the share and Jam invitation menus. */
  friends: Person[]
  refreshFriends: () => void
}

export const SocialContext = createContext<SocialState | null>(null)

export function useSocial() {
  const ctx = useContext(SocialContext)
  if (!ctx) throw new Error('useSocial must be used inside SocialProvider')
  return ctx
}
