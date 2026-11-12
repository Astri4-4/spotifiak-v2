import { LyricsView } from '../components/Lyrics'
import { usePlayer } from '../player/context'

/** The lyrics of what is playing, in the main view (the player bar's lyrics button). */
export function LyricsPage() {
  const { current } = usePlayer()
  return (
    <div className="lyrics-page">
      {current && !current.episode ? (
        <>
          <header className="lyrics-header">
            <h1>{current.title}</h1>
            <p>{current.artistName}</p>
          </header>
          <LyricsView track={current} />
        </>
      ) : (
        <p className="lyrics-message">Lancez un titre pour voir ses paroles</p>
      )}
    </div>
  )
}
