import { images, type Track } from '../api'
import { usePlayer } from '../player/context'
import { Cover } from './Cover'

function QueueItem({ track, current = false }: { track: Track; current?: boolean }) {
  return (
    <li className="queue-item">
      <Cover src={images.track(track)} size={48} />
      <span className="queue-item-text">
        <span className={`queue-item-title${current ? ' playing' : ''}`}>{track.title}</span>
        <span className="queue-item-artist">{track.artistName}</span>
      </span>
    </li>
  )
}

export function QueuePanel() {
  const { current, upNext } = usePlayer()

  return (
    <aside className="queue-panel panel">
      <h2>File d'attente</h2>
      {current ? (
        <>
          <h3>En cours de lecture</h3>
          <ul>
            <QueueItem track={current} current />
          </ul>
          {upNext.length > 0 && (
            <>
              <h3>Suivant</h3>
              <ul>
                {upNext.map((t, i) => (
                  <QueueItem key={`${t.id}-${i}`} track={t} />
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p className="muted">Ajoutez des titres à votre file d'attente en lançant un album ou un artiste.</p>
      )}
    </aside>
  )
}
