import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { users, type ManagedUser, type Role } from '../api'
import { useCurrentUser } from '../auth/context'
import { formatAddedAt } from '../format'

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('user')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await users.create({ username, password, displayName: displayName.trim() || undefined, role })
      setUsername('')
      setDisplayName('')
      setPassword('')
      setRole('user')
      onCreated()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="settings-form users-create">
      <div className="settings-row">
        <label>
          <span>Nom d'utilisateur</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" required />
        </label>
        <label>
          <span>
            Nom affiché <span className="muted">(facultatif)</span>
          </span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
      </div>
      <div className="settings-row">
        <label>
          <span>Mot de passe provisoire</span>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            autoComplete="off"
            required
          />
        </label>
        <label>
          <span>Rôle</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="user">Utilisateur</option>
            <option value="admin">Administrateur</option>
          </select>
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="pill-button" disabled={busy}>
        Créer le compte
      </button>
    </form>
  )
}

function UserRow({ user, isSelf, onChanged }: { user: ManagedUser; isSelf: boolean; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null)

  const act = async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const resetPassword = () => {
    const password = window.prompt(`Nouveau mot de passe pour ${user.displayName} (8 caractères minimum) :`)
    if (password) void act(() => users.update(user.id, { password }))
  }

  const remove = () => {
    if (window.confirm(`Supprimer le compte de ${user.displayName} ? Ses playlists et ses likes seront perdus.`)) {
      void act(() => users.remove(user.id))
    }
  }

  return (
    <li className="user-row">
      <span className="avatar small">
        <span className="avatar-initial">{user.displayName.charAt(0).toUpperCase()}</span>
      </span>
      <div className="user-row-text">
        <span className="user-row-name">
          {user.displayName}
          {isSelf && <span className="muted"> (vous)</span>}
        </span>
        <span className="muted">
          @{user.username} · {user.lastSeenAt ? `vu ${formatAddedAt(user.lastSeenAt)}` : 'jamais connecté'}
        </span>
        {error && <span className="error">{error}</span>}
      </div>
      <select
        value={user.role}
        onChange={(e) => void act(() => users.update(user.id, { role: e.target.value as Role }))}
        aria-label={`Rôle de ${user.displayName}`}
      >
        <option value="user">Utilisateur</option>
        <option value="admin">Administrateur</option>
      </select>
      <button className="pill-button outline small" onClick={resetPassword}>
        Mot de passe
      </button>
      <button className="pill-button outline small danger" onClick={remove} disabled={isSelf}>
        Supprimer
      </button>
    </li>
  )
}

export function UsersPage() {
  const me = useCurrentUser()
  const [list, setList] = useState<ManagedUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    users
      .list()
      .then(setList)
      .catch((err: Error) => setError(err.message))
  }, [])

  useEffect(load, [load])

  if (me.role !== 'admin') return <Navigate to="/" replace />

  return (
    <div className="page">
      <div className="page-gradient" />
      <div className="page-inner settings-page">
        <h1 className="greeting">Gérer les comptes</h1>

        <section className="scan-card">
          <h2 className="settings-title">Nouveau compte</h2>
          <CreateUserForm onCreated={load} />
        </section>

        <section className="scan-card">
          <h2 className="settings-title">Comptes {list && <span className="muted">({list.length})</span>}</h2>
          {error && <p className="error">{error}</p>}
          <ul className="user-list">
            {list?.map((u) => (
              <UserRow key={u.id} user={u} isSelf={u.id === me.id} onChanged={load} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
