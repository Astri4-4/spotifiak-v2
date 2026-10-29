import { images, type JamEntry, type Track } from '../api'
import { useJam } from '../jam/context'
import { usePlayer } from '../player/context'
import { Cover } from './Cover'
import { JamSection } from './Jam'
import { useReorder } from './useReorder'

interface QueueItemProps {
  track: Track
  current?: boolean
  /** In a Jam: who added it. */
  addedBy?: string
  onPlay?: () => void
  /** Drag and drop props and classes from useReorder. */
  drag?: object
  dragClass?: string
}

function QueueItem({ track, current = false, addedBy, onPlay, drag, dragClass = '' }: QueueItemProps) {
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
    <li className={dragClass.trim() || undefined} {...drag}>
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

/** Entries of the Jam that can be dragged to reorder them, within this list. */
function JamList({ title, list, showAddedBy }: { title: string; list: JamEntry[]; showAddedBy: boolean }) {
  const { command } = useJam()
  const reorder = useReorder(list.length, (from, before) =>
    command({ type: 'move', entryId: list[from].id, beforeEntryId: list[before]?.id ?? null }),
  )
  if (!list.length) return null
  return (
    <>
      <h3>{title}</h3>
      <ul className="queue-list">
        {list.map((e, i) => (
          <QueueItem
            key={e.id}
            track={e.track}
            addedBy={showAddedBy ? e.addedBy.displayName : undefined}
            onPlay={() => command({ type: 'jump', entryId: e.id })}
            drag={reorder.handlers(i)}
            dragClass={reorder.classes(i)}
          />
        ))}
      </ul>
    </>
  )
}

function UpNext() {
  const { upNext, moveInQueue } = usePlayer()
  const reorder = useReorder(upNext.length, moveInQueue)
  if (!upNext.length) return null
  return (
    <>
      <h3>Suivant</h3>
      <ul className="queue-list">
        {upNext.map((t, i) => (
          <QueueItem key={`${t.id}-${i}`} track={t} drag={reorder.handlers(i)} dragClass={reorder.classes(i)} />
        ))}
      </ul>
    </>
  )
}

export function QueuePanel() {
  const { current } = usePlayer()
  const { jam } = useJam()

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
            {/* What people add plays first, then the rest of what was launched. */}
            <JamList title="Suivant dans la file" list={jam.queue.slice(jam.index + 1)} showAddedBy />
            <JamList
              title={jam.fallbackName ? `Ensuite, depuis « ${jam.fallbackName} »` : 'Ensuite'}
              list={jam.fallback}
              showAddedBy={false}
            />
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
          <UpNext />
        </>
      ) : (
        <p className="muted">Ajoutez des titres à votre file d'attente en lançant un album ou un artiste.</p>
      )}
    </aside>
  )
}
