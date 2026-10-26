import { images, type MosaicCover } from '../api'
import { HeartFilledIcon, NoteIcon } from '../icons'
import { Cover } from './Cover'

interface Sized {
  size?: number
  className?: string
}

/** 2×2 grid of four album covers, one cover with fewer, a note icon when empty (like Spotify). */
export function PlaylistCover({ covers, size, className = '', quality = 'sm' }: Sized & { covers: MosaicCover[]; quality?: 'sm' | 'md' | 'lg' }) {
  const style = size ? { width: size, height: size } : undefined
  if (covers.length >= 4) {
    return (
      <div className={`cover mosaic ${className}`} style={style}>
        {covers.slice(0, 4).map((c) => (
          <Cover key={c.trackId} src={images.mosaic(c)} quality={quality === 'lg' ? 'md' : 'sm'} />
        ))}
      </div>
    )
  }
  if (covers.length) return <Cover src={images.mosaic(covers[0])} size={size} quality={quality} className={className} />
  return (
    <div className={`cover cover-placeholder ${className}`} style={style}>
      <NoteIcon size={size && size < 64 ? 20 : 48} />
    </div>
  )
}

export function LikedCover({ size, className = '' }: Sized) {
  const style = size ? { width: size, height: size } : undefined
  return (
    <div className={`cover liked-cover ${className}`} style={style}>
      <HeartFilledIcon size={size && size < 64 ? Math.round(size / 3) : 64} />
    </div>
  )
}
