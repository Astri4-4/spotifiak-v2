import { useState, type FormEvent } from 'react'
import { auth, social } from '../api'
import { resizeAvatar } from '../avatar'
import { PersonAvatar } from '../components/PersonAvatar'
import { useAuth, useCurrentUser } from '../auth/context'

function useForm() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async (action: () => Promise<string>) => {
    setBusy(true)
    setMessage(null)
    try {
      setMessage({ ok: true, text: await action() })
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return { busy, message, run }
}

function FormMessage({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null
  return <p className={message.ok ? 'form-success' : 'error'}>{message.text}</p>
}

/** The profile picture: chosen from the device, resized here, or removed. */
function AvatarSection() {
  const user = useCurrentUser()
  const { setUser } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true)
    setError(null)
    try {
      setUser({ ...user, avatarUpdatedAt: await action() })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="scan-card">
      <h2 className="settings-title">Photo de profil</h2>
      <div className="avatar-editor">
        <PersonAvatar person={user} size={96} />
        <div className="avatar-editor-actions">
          <label className={`pill-button small${busy ? ' disabled' : ''}`}>
            {user.avatarUpdatedAt ? 'Changer la photo' : 'Choisir une photo'}
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void run(async () => (await social.uploadAvatar(await resizeAvatar(file))).avatarUpdatedAt)
              }}
            />
          </label>
          {user.avatarUpdatedAt && (
            <button className="pill-button small outline" disabled={busy} onClick={() => void run(async () => (await social.removeAvatar(), null))}>
              Supprimer
            </button>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

export function AccountPage() {
  const user = useCurrentUser()
  const { setUser } = useAuth()
  const [displayName, setDisplayName] = useState(user.displayName)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const profile = useForm()
  const password = useForm()

  const saveProfile = (e: FormEvent) => {
    e.preventDefault()
    void profile.run(async () => {
      const res = await auth.updateProfile({ displayName })
      setUser(res.user)
      return 'Profil enregistré'
    })
  }

  const savePassword = (e: FormEvent) => {
    e.preventDefault()
    void password.run(async () => {
      if (newPassword !== confirm) throw new Error('Les mots de passe ne correspondent pas')
      await auth.changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
      return 'Mot de passe modifié. Vos autres appareils ont été déconnectés.'
    })
  }

  return (
    <div className="page">
      <div className="page-gradient" />
      <div className="page-inner settings-page">
        <h1 className="greeting">Compte</h1>

        <AvatarSection />

        <section className="scan-card">
          <h2 className="settings-title">Profil</h2>
          <form onSubmit={saveProfile} className="settings-form">
            <label>
              <span>Nom d'utilisateur</span>
              <input value={user.username} disabled />
            </label>
            <label>
              <span>Nom affiché</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} required />
            </label>
            <FormMessage message={profile.message} />
            <button className="pill-button" disabled={profile.busy || displayName.trim() === user.displayName}>
              Enregistrer
            </button>
          </form>
        </section>

        <section className="scan-card">
          <h2 className="settings-title">Confidentialité</h2>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={user.shareActivity}
              onChange={(e) =>
                void auth
                  .updateProfile({ shareActivity: e.target.checked })
                  .then((res) => setUser(res.user))
                  .catch(() => {})
              }
            />
            <span>
              Partager mon activité d'écoute avec mes amis
              <span className="muted">Vos amis voient ce que vous écoutez et vos dernières écoutes.</span>
            </span>
          </label>
        </section>

        <section className="scan-card">
          <h2 className="settings-title">Mot de passe</h2>
          <form onSubmit={savePassword} className="settings-form">
            <label>
              <span>Mot de passe actuel</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              <span>Nouveau mot de passe</span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <label>
              <span>Confirmer le nouveau mot de passe</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
            <FormMessage message={password.message} />
            <button className="pill-button" disabled={password.busy}>
              Changer le mot de passe
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
