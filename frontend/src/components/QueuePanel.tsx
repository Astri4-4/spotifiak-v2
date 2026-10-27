import { images, type Track } from '../api'
import { useJam } from '../jam/context'
import { usePlayer } from '../player/context'
import { Cover } from './Cover'
import { JamSection } from './Jam'

interface QueueItemProps {
  track: Track
  current?: boolean
  /** In a Jam: who added it. */
  addedBy?: string
  onPlay?: () => void
}

function QueueItem({ track, current = false, addedBy, onPlay }: QueueItemProps) {
  const content = (
    <>
      <Cover src={images.track(track)} size={48} />
      <span className="queue-item-text">
        <span className={`queue-item-title${current ? ' playing' : ''}`}>{track.title}</span>
        <span className="queue-item-artist">
          {track.artistName}
          {addedBy && <span className="queue-added-by"> · ajouté par {addedBy}</span>}
        </span>
      </span>
    </>
  )
  return (
    <li>
      {onPlay ? (
        <button className="queue-item" onClick={onPlay} aria-label={`Lire ${track.title}`}>
          {content}
        </button>
      ) : (
        <div className="queue-item">{content}</div>
      )}
    </li>
  )
}

export function QueuePanel() {
  const { current, upNext } = usePlayer()
  const { jam, command } = useJam()

  return (
    <aside className="queue-panel panel">
      <h2>File d'attente</h2>
      <JamSection />
      {jam ? (
        jam.queue[jam.index] ? (
          <>
            <h3>En cours de lecture</h3>
            <ul>
              <QueueItem track={jam.queue[jam.index].track} current addedBy={jam.queue[jam.index].addedBy.displayName} />
            </ul>
            {jam.index + 1 < jam.queue.length && (
              <>
                <h3>Suivant dans la Jam</h3>
                <ul>
                  {jam.queue.slice(jam.index + 1).map((e) => (
                    <QueueItem
                      key={e.id}
                      track={e.track}
                      addedBy={e.addedBy.displayName}
                      onPlay={() => command({ type: 'jump', entryId: e.id })}
                    />
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <p className="muted">La file de la Jam est vide : lancez un titre ou ajoutez-en avec « … ».</p>
        )
      ) : current ? (
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
