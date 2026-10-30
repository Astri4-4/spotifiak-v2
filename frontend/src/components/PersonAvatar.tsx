import { useState } from 'react'
import { images } from '../api'

type AvatarPerson = { id: string; displayName: string; avatarUpdatedAt?: string | null }

/** A person's profile picture, or their initial in a colored circle without one. */
export function PersonAvatar({ person, size = 40 }: { person: AvatarPerson; size?: number }) {
  const src = images.avatar(person)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const style = { width: size, height: size, fontSize: size * 0.42 }
  if (src && failedSrc !== src) {
    return <img className="avatar-initial person-avatar" src={src} alt="" style={style} onError={() => setFailedSrc(src)} />
  }
  return (
    <span className="avatar-initial person-avatar" style={style} aria-hidden="true">
      {person.displayName.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}
