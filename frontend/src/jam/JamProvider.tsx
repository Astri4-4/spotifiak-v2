import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { jam as jamApi, type JamCommand, type JamState } from '../api'
import { useCollection } from '../collection/context'
import { JamContext, type JamContextState } from './context'

/**
 * Follows the Jam this account is in: its state arrives over Server-Sent Events, and
 * the player (see PlayerProvider) plays along. Commands go to the server, which
 * sends the new state to every participant, this one included.
 */
export function JamProvider({ children }: { children: ReactNode }) {
  const { notify } = useCollection()
  const [current, setCurrent] = useState<{ jam: JamState; receivedAt: number } | null>(null)
  // Set while this account leaves or ends the Jam itself: no "you were removed" toast then.
  const leaving = useRef(false)
  const jamId = current?.jam.id ?? null

  const apply = useCallback((jam: JamState | null) => {
    setCurrent(jam ? { jam, receivedAt: performance.now() } : null)
  }, [])

  // Back in the Jam after a reload.
  useEffect(() => {
    jamApi.current().then(apply).catch(() => {})
  }, [apply])

  useEffect(() => {
    if (!jamId) return
    leaving.current = false
    const events = new EventSource(jamApi.eventsUrl(jamId), { withCredentials: true })
    events.addEventListener('state', (e) => apply(JSON.parse((e as MessageEvent<string>).data) as JamState))
    events.addEventListener('end', (e) => {
      events.close()
      apply(null)
      if (leaving.current) return
      const { reason } = JSON.parse((e as MessageEvent<string>).data) as { reason: 'ended' | 'removed' }
      notify(reason === 'ended' ? "L'hôte a mis fin à la Jam" : 'Vous avez été retiré de la Jam')
    })
    // The browser reconnects by itself after a network blip; when the Jam is gone
    // (server restarted, ended meanwhile) the stream is refused and stays closed.
    events.onerror = () => {
      if (events.readyState !== EventSource.CLOSED) return
      jamApi
        .current()
        .then((jam) => {
          apply(jam)
          if (!jam) notify('La Jam est terminée')
        })
        .catch(() => {})
    }
    return () => events.close()
  }, [jamId, apply, notify])

  const start = useCallback<JamContextState['start']>(
    async (initial) => {
      apply(await jamApi.start(initial))
      notify('Jam démarrée : invitez vos amis avec le lien')
    },
    [apply, notify],
  )

  const join = useCallback(
    async (id: string) => {
      const jam = await jamApi.join(id)
      apply(jam)
      notify(`Vous avez rejoint la Jam de ${jam.host.displayName}`)
    },
    [apply, notify],
  )

  const leave = useCallback(async () => {
    if (!jamId) return
    leaving.current = true
    apply(null)
    await jamApi.leave(jamId).catch(() => {})
  }, [jamId, apply])

  const removeParticipant = useCallback(
    async (userId: string) => {
      if (jamId) await jamApi.remove(jamId, userId).catch((err: Error) => notify(err.message))
    },
    [jamId, notify],
  )

  const command = useCallback(
    (cmd: JamCommand) => {
      if (jamId) jamApi.command(jamId, cmd).catch((err: Error) => notify(err.message))
    },
    [jamId, notify],
  )

  const value = useMemo<JamContextState>(
    () => ({
      jam: current?.jam ?? null,
      receivedAt: current?.receivedAt ?? 0,
      start,
      join,
      leave,
      removeParticipant,
      command,
    }),
    [current, start, join, leave, removeParticipant, command],
  )

  return <JamContext.Provider value={value}>{children}</JamContext.Provider>
}
