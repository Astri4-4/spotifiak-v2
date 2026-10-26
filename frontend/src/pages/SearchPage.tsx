import { useState, type FormEvent } from 'react'
import { api, type DeezerTrack } from '../api'

function formatDuration(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DeezerTrack[]>([])
  const [error, setError] = useState<string | null>(null)
  const [queued, setQueued] = useState<Set<number>>(new Set())

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setError(null)
    try {
      setResults(await api.search(query))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const onDownload = async (track: DeezerTrack) => {
    try {
      await api.download(track.link)
      setQueued((prev) => new Set(prev).add(track.id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section>
      <form onSubmit={onSubmit} className="search-form">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What do you want to listen to?"
          autoFocus
        />
      </form>
      {error && <p className="error">{error}</p>}
      <ul className="track-list">
        {results.map((track) => (
          <li key={track.id}>
            <img src={track.album.cover_medium} alt="" />
            <div className="track-meta">
              <div className="title">{track.title}</div>
              <div className="artist">
                {track.artist.name} · {track.album.title}
              </div>
            </div>
            <span className="muted">{formatDuration(track.duration)}</span>
            <button onClick={() => onDownload(track)} disabled={queued.has(track.id)}>
              {queued.has(track.id) ? 'Queued' : 'Download'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
