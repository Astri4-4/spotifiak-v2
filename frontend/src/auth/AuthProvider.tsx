import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { auth, UNAUTHORIZED_EVENT, type AuthStatus, type User } from '../api'
import { LogoIcon } from '../icons'
import { AuthContext, type AuthState } from './context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bumping it reloads the status (retry button, after the first sign-up).
  const [attempt, setAttempt] = useState(0)
  const refresh = useCallback(() => setAttempt((a) => a + 1), [])

  useEffect(() => {
    let cancelled = false
    auth
      .status()
      .then((s) => {
        if (cancelled) return
        setStatus(s)
        setError(null)
      })
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [attempt])

  // Session expired or revoked (password changed elsewhere, account deleted...).
  useEffect(() => {
    const onUnauthorized = () => setStatus((s) => (s?.user ? { ...s, user: null } : s))
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  const state: AuthState | null = useMemo(
    () =>
      status && {
        user: status.user,
        needsSetup: status.needsSetup,
        signupOpen: status.signupOpen,
        login: async (username, password) => {
          const { user } = await auth.login(username, password)
          setStatus((s) => s && { ...s, user })
        },
        register: async (username, password, displayName) => {
          const { user } = await auth.register(username, password, displayName)
          // The first account closes setup; re-read whether sign-ups stay open.
          setStatus((s) => s && { ...s, user, needsSetup: false })
          refresh()
        },
        logout: async () => {
          await auth.logout().catch(() => {})
          setStatus((s) => s && { ...s, user: null })
        },
        setUser: (user: User) => setStatus((s) => s && { ...s, user }),
      },
    [status, refresh],
  )

  if (!state) {
    return (
      <div className="splash">
        <LogoIcon size={48} />
        {error && (
          <p className="error">
            Impossible de joindre le serveur.{' '}
            <button className="text-link" onClick={refresh}>
              Réessayer
            </button>
          </p>
        )}
      </div>
    )
  }

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}
