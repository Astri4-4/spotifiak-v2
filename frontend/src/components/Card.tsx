import { Link } from 'react-router-dom'
import { Cover } from './Cover'
import { PlayButton } from './PlayButton'

interface CardProps {
  to: string
  title: string
  subtitle: string
  image: string | null
  round?: boolean
  playing: boolean
  onPlay: () => void
}

export function Card({ to, title, subtitle, image, round, playing, onPlay }: CardProps) {
  return (
    <Link to={to} className="card">
      <div className="card-cover">
        <Cover src={image} quality="md" round={round} />
        <PlayButton playing={playing} onClick={onPlay} className={playing ? 'visible' : ''} />
      </div>
      <div className="card-title">{title}</div>
      <div className="card-subtitle">{subtitle}</div>
    </Link>
  )
}
