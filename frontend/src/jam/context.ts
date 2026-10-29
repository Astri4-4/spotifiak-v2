import { createContext, useContext } from 'react'
import type { JamCommand, JamStart, JamState } from '../api'

export interface JamContextState {
  /** The Jam this account is in, or null. */
  jam: JamState | null
  /** performance.now() when `jam` arrived: its position counts from then. */
  receivedAt: number
  /** Starts a Jam with what is playing (current track first). */
  start: (initial: JamStart) => Promise<void>
  join: (id: string) => Promise<void>
  /** Leaves the Jam; for the host, ends it for everyone. */
  leave: () => Promise<void>
  removeParticipant: (userId: string) => Promise<void>
  command: (command: JamCommand) => void
}

export const JamContext = createContext<JamContextState | null>(null)

export function useJam() {
  const ctx = useContext(JamContext)
  if (!ctx) throw new Error('useJam must be used inside JamProvider')
  return ctx
}
