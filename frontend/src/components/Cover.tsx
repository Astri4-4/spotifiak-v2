import { useState } from 'react'
import { NoteIcon, UserIcon } from '../icons'

type Quality = 'sm' | 'md' | 'lg'

interface CoverProps {
  src: string | null
  size?: number | string
  /** sm for thumbnails, md for cards, lg for page headers. */
  quality?: Quality
  round?: boolean
  className?: string
  onLoad?: (img: HTMLImageElement) => void
}

const DEEZER_SIZES: Record<Quality, number> = { sm: 250, md: 500, lg: 1000 }

// Deezer image URLs embed their size ("…/1000x1000-000000-80-0-0.jpg"); ask for what we display.
function sized(src: string, quality: Quality) {
  const px = DEEZER_SIZES[quality]
  return src.includes('dzcdn.net') ? src.replace(/\/\d+x\d+-/, `/${px}x${px}-`) : src
}

export function Cover({ src, size, quality = 'sm', round = false, className = '', onLoad }: CoverProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const style = size ? { width: size, height: size } : undefined
  const classes = `cover${round ? ' round' : ''} ${className}`

  if (!src || failedSrc === src) {
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
      src={sized(src, quality)}
      alt=""
      loading="lazy"
      // Needed to read pixels for the header gradient color.
      crossOrigin="anonymous"
      onError={() => setFailedSrc(src)}
      onLoad={(e) => onLoad?.(e.currentTarget)}
    />
  )
}
