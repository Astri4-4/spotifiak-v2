import { usePlayer } from './PlayerContext'

export function PlayerBar() {
  const { current, playing, toggle } = usePlayer()

  return (
    <footer className="player-bar">
      {current ? (
        <div className="now-playing">
          {current.cover && <img src={current.cover} alt="" />}
          <div>
            <div className="title">{current.title}</div>
            <div className="artist">{current.artist}</div>
          </div>
        </div>
      ) : (
        <div className="now-playing muted">Nothing playing</div>
      )}
      <button className="play-button" onClick={toggle} disabled={!current}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <div />
    </footer>
  )
}
