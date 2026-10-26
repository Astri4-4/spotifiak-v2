import { useState } from 'react'
import { api } from '../api'
import { NoteIcon, UserIcon } from '../icons'

interface CoverProps {
  trackId: string | null
  size?: number | string
  round?: boolean
  className?: string
  onLoad?: (img: HTMLImageElement) => void
}

export function Cover({ trackId, size, round = false, className = '', onLoad }: CoverProps) {
  const [failed, setFailed] = useState(false)
  const src = api.coverUrl(trackId)
  const style = size ? { width: size, height: size } : undefined
  const classes = `cover${round ? ' round' : ''} ${className}`

  if (!src || failed) {
    const Icon = round ? UserIcon : NoteIcon
    return (
      <div className={`${classes} cover-placeholder`} style={style}>
        <Icon size={24} />
      </div>
    )
  }

  return (
    <img
      className={classes}
      style={style}
      src={src}
      alt=""
      loading="lazy"
      // Needed to read pixels for the header gradient color.
      crossOrigin="anonymous"
      onError={() => setFailed(true)}
      onLoad={(e) => onLoad?.(e.currentTarget)}
    />
  )
}
