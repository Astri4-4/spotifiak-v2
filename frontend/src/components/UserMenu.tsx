import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth, useCurrentUser } from '../auth/context'

function initials(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?'
}

export function UserMenu() {
  const user = useCurrentUser()
  const { logout } = useAuth()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // Close on outside click or Escape, like Spotify's menus.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const close = () => setOpen(false)

  return (
    <div className="user-menu" ref={root}>
      <button
        className="avatar"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Profil de ${user.displayName}`}
        title={user.displayName}
      >
        <span className="avatar-initial">{initials(user.displayName)}</span>
      </button>

      {open && (
        <div className="menu" role="menu">
          <div className="menu-header">
            <span className="menu-name">{user.displayName}</span>
            <span className="menu-sub">
              @{user.username}
              {user.role === 'admin' && ' · Administrateur'}
            </span>
          </div>
          <Link to="/account" role="menuitem" className="menu-item" onClick={close}>
            Compte
          </Link>
          <Link to="/scan" role="menuitem" className="menu-item" onClick={close}>
            Analyse de la bibliothèque
          </Link>
          {user.role === 'admin' && (
            <Link to="/admin/users" role="menuitem" className="menu-item" onClick={close}>
              Gérer les comptes
            </Link>
          )}
          <hr className="menu-separator" />
          <button role="menuitem" className="menu-item" onClick={() => void logout()}>
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  )
}
