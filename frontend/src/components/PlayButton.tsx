import type { MouseEvent } from 'react'
import { PauseIcon, PlayIcon } from '../icons'

interface PlayButtonProps {
  playing: boolean
  onClick: () => void
  size?: 'md' | 'lg'
  className?: string
}

export function PlayButton({ playing, onClick, size = 'md', className = '' }: PlayButtonProps) {
  const handle = (e: MouseEvent) => {
    // Cards are links; the button must not navigate.
    e.preventDefault()
    e.stopPropagation()
    onClick()
  }
  const Icon = playing ? PauseIcon : PlayIcon
  return (
    <button
      className={`play-button play-button-${size} ${className}`}
      onClick={handle}
      aria-label={playing ? 'Pause' : 'Lecture'}
    >
      <Icon size={size === 'lg' ? 24 : 20} />
    </button>
  )
}
