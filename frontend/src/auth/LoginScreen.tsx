import { useState, type FormEvent } from 'react'
import { LogoIcon } from '../icons'
import { useAuth } from './context'

type Mode = 'login' | 'signup'

export function LoginScreen() {
  const { needsSetup, signupOpen, login, register } = useAuth()
  const [mode, setMode] = useState<Mode>(needsSetup ? 'signup' : 'login')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const signup = mode === 'signup'

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (signup && password !== confirm) {
      setError('Les mots de passe ne correspondent pas')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (signup) await register(username, password, displayName.trim() || undefined)
      else await login(username, password)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setPassword('')
    setConfirm('')
  }

  return (
    <div className="auth-screen">
      <main className="auth-card">
        <LogoIcon size={40} className="auth-logo" />
        <h1>
          {needsSetup ? 'Bienvenue sur Spotifiak' : signup ? "S'inscrire sur Spotifiak" : 'Se connecter à Spotifiak'}
        </h1>
        {needsSetup && (
          <p className="auth-intro">
            Créez le premier compte. Il sera administrateur : il pourra créer les comptes des autres utilisateurs et
            lancer les analyses de la bibliothèque.
          </p>
        )}

        <form onSubmit={onSubmit} className="auth-form">
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <label>
            <span>Nom d'utilisateur</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoFocus
              required
            />
          </label>

          {signup && (
            <label>
              <span>
                Nom affiché <span className="muted">(facultatif)</span>
              </span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="nickname" />
            </label>
          )}

          <label>
            <span>Mot de passe</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={signup ? 'new-password' : 'current-password'}
              minLength={signup ? 8 : undefined}
              required
            />
          </label>

          {signup && (
            <label>
              <span>Confirmer le mot de passe</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
          )}

          <button className="auth-submit" disabled={busy}>
            {busy ? '…' : needsSetup ? 'Créer le compte administrateur' : signup ? "S'inscrire" : 'Se connecter'}
          </button>
        </form>

        {!needsSetup && (
          <>
            <hr className="auth-divider" />
            {signup ? (
              <p className="auth-switch">
                Vous avez déjà un compte ?{' '}
                <button className="text-link" onClick={() => switchMode('login')}>
                  Se connecter
                </button>
              </p>
            ) : signupOpen ? (
              <p className="auth-switch">
                Vous n'avez pas de compte ?{' '}
                <button className="text-link" onClick={() => switchMode('signup')}>
                  S'inscrire
                </button>
              </p>
            ) : (
              <p className="auth-switch muted">Pas de compte ? Demandez à un administrateur de vous en créer un.</p>
            )}
          </>
        )}
      </main>
    </div>
  )
}
