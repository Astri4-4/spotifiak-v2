import { useState } from 'react'
import { images, social, type Track } from '../api'
import { useCollection } from '../collection/context'
import { useSocial } from '../social/context'
import { Cover } from './Cover'
import { Dialog } from './Dialog'
import { PersonAvatar } from './PersonAvatar'

/** "Citer un passage": sends a lyric line to friends; their player starts at that line. */
export function QuoteDialog({ track, quote, position, onClose }: { track: Track; quote: string; position: number | null; onClose: () => void }) {
  const { friends } = useSocial()
  const { notify } = useCollection()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const send = async () => {
    setSending(true)
    try {
      await social.share(track.id, [...selected], message.trim() || undefined, { quote, position: position ?? undefined })
      const names = friends.filter((f) => selected.has(f.id)).map((f) => f.displayName)
      notify(`Passage envoyé à ${names.join(', ')}`)
      onClose()
    } catch (err) {
      notify((err as Error).message)
      setSending(false)
    }
  }

  return (
    <Dialog title="Citer un passage" onClose={onClose}>
      <QuoteCard track={track} quote={quote} position={position} />
      <input
        className="quote-input"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Un mot avec (facultatif)"
        maxLength={300}
        aria-label="Message"
      />
      {friends.length === 0 ? (
        <p className="muted">Ajoutez des amis depuis la page Amis.</p>
      ) : (
        <ul className="quote-friends">
          {friends.map((f) => (
            <li key={f.id}>
              <label>
                <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)} />
                <PersonAvatar person={f} size={28} />
                <span>{f.displayName}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <button className="pill-button" disabled={!selected.size || sending} onClick={() => void send()}>
        Envoyer
      </button>
    </Dialog>
  )
}

const at = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/** The quote over the track's cover: what the sender sees before sending and the friend in their inbox. */
export function QuoteCard({ track, quote, position, onPlay }: { track: Track; quote: string; position: number | null; onPlay?: () => void }) {
  const cover = images.track(track)
  return (
    <figure className="quote-card">
      {cover && <img className="quote-card-bg" src={cover} alt="" aria-hidden="true" />}
      <blockquote>{quote}</blockquote>
      <figcaption>
        <Cover src={cover} size={36} />
        <span className="title-text">
          <span className="track-name">{track.title}</span>
          <span className="track-artist">
            {track.artistName}
            {position !== null && ` • à ${at(position)}`}
          </span>
        </span>
        {onPlay && (
          <button className="pill-button small" onClick={onPlay}>
            Écouter le passage
          </button>
        )}
      </figcaption>
    </figure>
  )
}
