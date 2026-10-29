import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Cover } from './Cover'
import { PlayButton } from './PlayButton'

interface CardProps {
  to: string
  title: string
  subtitle: string
  image: string | null
  /** Replaces the image (a playlist mosaic). */
  cover?: ReactNode
  round?: boolean
  /** Without onPlay the card only links (podcasts from the directory). */
  playing?: boolean
  onPlay?: () => void
}

export function Card({ to, title, subtitle, image, cover, round, playing, onPlay }: CardProps) {
  return (
    <Link to={to} className="card">
      <div className="card-cover">
        {cover ?? <Cover src={image} quality="md" round={round} />}
        {onPlay && <PlayButton playing={!!playing} onClick={onPlay} className={playing ? 'visible' : ''} />}
      </div>
      <div className="card-title">{title}</div>
      <div className="card-subtitle">{subtitle}</div>
    </Link>
  )
}
