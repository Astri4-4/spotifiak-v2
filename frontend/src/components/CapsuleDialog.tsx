import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { capsules, images, type Track } from '../api'
import { useCurrentUser } from '../auth/context'
import { useCollection } from '../collection/context'
import { useSocial } from '../social/context'
import { Cover } from './Cover'
import { Dialog } from './Dialog'

const PRESETS: { label: string; months: number }[] = [
  { label: 'Dans 1 mois', months: 1 },
  { label: 'Dans 6 mois', months: 6 },
  { label: 'Dans 1 an', months: 12 },
  { label: 'Dans 5 ans', months: 60 },
]

function inMonths(months: number) {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return d
}

/** yyyy-mm-dd of a local date, for <input type="date">. */
const dayValue = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Seals a track with a word, for oneself or a friend, until a chosen date. */
export function CapsuleDialog({ track, onClose }: { track: Track; onClose: () => void }) {
  const me = useCurrentUser()
  const { friends } = useSocial()
  const { notify } = useCollection()
  const navigate = useNavigate()
  const [to, setTo] = useState(me.id)
  const [day, setDay] = useState(dayValue(inMonths(12)))
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  // Opens at 9:00 on the chosen day, a nice time to find it.
  const openAt = new Date(`${day}T09:00:00`)
  const tooSoon = !(openAt.getTime() > Date.now() + 60 * 60 * 1000)

  const seal = async () => {
    setSending(true)
    try {
      await capsules.seal(track.id, to, openAt, message.trim() || undefined)
      notify(`Capsule scellée jusqu'au ${openAt.toLocaleDateString('fr-FR', { dateStyle: 'long' })}`)
      onClose()
      navigate('/capsules')
    } catch (err) {
      notify((err as Error).message)
      setSending(false)
    }
  }

  return (
    <Dialog title="Sceller une capsule" onClose={onClose}>
      <div className="capsule-track">
        <Cover src={images.track(track)} size={48} />
        <span className="title-text">
          <span className="track-name">{track.title}</span>
          <span className="track-artist">{track.artistName}</span>
        </span>
      </div>
      <p className="muted capsule-hint">
        Le titre et ton mot restent cachés jusqu'au jour choisi : on ne voit qu'une capsule scellée et un compte à rebours.
      </p>

      <label className="capsule-field">
        <span>Pour</span>
        <select value={to} onChange={(e) => setTo(e.target.value)}>
          <option value={me.id}>Moi, dans le futur</option>
          {friends.map((f) => (
            <option key={f.id} value={f.id}>
              {f.displayName}
            </option>
          ))}
        </select>
      </label>

      <div className="capsule-field">
        <span>S'ouvre le</span>
        <div className="capsule-presets">
          {PRESETS.map((p) => (
            <button
              key={p.months}
              className={`chip${day === dayValue(inMonths(p.months)) ? ' selected' : ''}`}
              onClick={() => setDay(dayValue(inMonths(p.months)))}
            >
              {p.label}
            </button>
          ))}
          <input type="date" value={day} min={dayValue(new Date(Date.now() + 24 * 3600 * 1000))} onChange={(e) => setDay(e.target.value)} />
        </div>
      </div>

      <textarea
        className="quote-input"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={to === me.id ? 'Un mot pour toi dans le futur…' : 'Un mot, à lire le jour venu…'}
        maxLength={500}
        rows={3}
        aria-label="Message"
      />
      <button className="pill-button" disabled={sending || tooSoon || !day} onClick={() => void seal()}>
        Sceller
      </button>
    </Dialog>
  )
}
