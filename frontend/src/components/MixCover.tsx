import type { MixSummary } from '../api'
import { PlaylistCover } from './CollectionCovers'

/** A mix's cover: its tracks' mosaic with the mix's name across the bottom, like Spotify's. */
export function MixCover({ mix, className = '', quality = 'md' }: { mix: MixSummary; className?: string; quality?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={`mix-cover ${mix.kind} ${className}`}>
      <PlaylistCover covers={mix.covers} quality={quality} />
      <span className="mix-cover-label">{mix.kind === 'blend' ? 'Entre amis' : mix.kind === 'radio' ? 'Radio' : mix.title}</span>
    </div>
  )
}
