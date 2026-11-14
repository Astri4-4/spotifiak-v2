import { useEffect, useRef, useState } from 'react'
import { api, type Lyrics, type Track } from '../api'
import { useFetch } from '../hooks'
import { usePlayer, useProgress } from '../player/context'
import { QuoteDialog } from './QuoteDialog'

// Lines light up slightly early, like a karaoke prompt.
const LEAD_SEC = 0.3

/** The line being sung at `time`: the last one started; null before the first or unsynced. */
function currentLine(lyrics: Lyrics, time: number): number | null {
  if (!lyrics.synced) return null
  // Lines are sorted by time: find the first one still to come.
  let low = 0
  let high = lyrics.lines.length
  while (low < high) {
    const mid = (low + high) >> 1
    if ((lyrics.lines[mid].time ?? 0) <= time) low = mid + 1
    else high = mid
  }
  return low === 0 ? null : low - 1
}

/**
 * A track's lyrics. Synced ones follow the music: the current line is lit and kept in view,
 * and clicking a line plays from there. Each line can be quoted to friends ("Citer").
 */
export function LyricsView({ track }: { track: Track }) {
  const { data, error } = useFetch(() => api.lyrics(track.id), [track.id])
  const { currentTime } = useProgress()
  const { seek } = usePlayer()
  const lineRefs = useRef<(HTMLElement | null)[]>([])
  const current = data ? currentLine(data, currentTime + LEAD_SEC) : null
  const [quoting, setQuoting] = useState<{ text: string; time: number | null } | null>(null)

  useEffect(() => {
    if (current !== null) lineRefs.current[current]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [current])

  if (error) return <p className="lyrics-message">Paroles indisponibles</p>
  if (!data) return <p className="lyrics-message" aria-busy="true" />
  if (data.lines.every((l) => !l.text)) {
    return <p className="lyrics-message">{data.instrumental ? 'Titre instrumental' : 'Pas de paroles pour ce titre'}</p>
  }

  return (
    <div className={`lyrics${data.synced ? ' synced' : ''}`}>
      {data.lines.map((line, i) => {
        const text = line.text || '♪'
        const quote = line.text && (
          <button
            className="lyrics-quote"
            onClick={() => setQuoting({ text: line.text, time: line.time })}
            aria-label={`Citer « ${line.text} » à un ami`}
            title="Citer à un ami"
          >
            ❝
          </button>
        )
        if (!data.synced || line.time === null) {
          return (
            <div key={i} className="lyrics-row">
              <p className="lyrics-line">{text}</p>
              {quote}
            </div>
          )
        }
        const state = i === current ? ' current' : current !== null && i < current ? ' past' : ''
        const time = line.time
        return (
          <div key={i} className="lyrics-row">
            <button
              ref={(el) => {
                lineRefs.current[i] = el
              }}
              className={`lyrics-line${state}`}
              onClick={() => seek(time)}
              aria-current={i === current ? 'true' : undefined}
            >
              {text}
            </button>
            {quote}
          </div>
        )
      })}
      {data.source === 'lrclib' && <p className="lyrics-credit">Paroles : LRCLIB</p>}
      {quoting && <QuoteDialog track={track} quote={quoting.text} position={quoting.time} onClose={() => setQuoting(null)} />}
    </div>
  )
}
