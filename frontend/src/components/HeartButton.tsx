import { useCollection } from '../collection/context'
import { HeartFilledIcon, HeartIcon } from '../icons'

interface HeartButtonProps {
  trackId: string
  size?: number
  className?: string
}

export function HeartButton({ trackId, size = 16, className = '' }: HeartButtonProps) {
  const { likedIds, toggleLike } = useCollection()
  const liked = likedIds.has(trackId)
  return (
    <button
      className={`heart-button${liked ? ' liked' : ''} ${className}`}
      onClick={(e) => {
        e.stopPropagation()
        toggleLike(trackId)
      }}
      aria-label={liked ? 'Retirer des Titres likés' : 'Ajouter aux Titres likés'}
      aria-pressed={liked}
      title={liked ? 'Retirer des Titres likés' : 'Ajouter aux Titres likés'}
    >
      {liked ? <HeartFilledIcon size={size} /> : <HeartIcon size={size} />}
    </button>
  )
}
