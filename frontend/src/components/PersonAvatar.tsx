import type { Person } from '../api'

/** A person's initial in a colored circle (accounts have no pictures). */
export function PersonAvatar({ person, size = 40 }: { person: Pick<Person, 'displayName'>; size?: number }) {
  return (
    <span className="avatar-initial person-avatar" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {person.displayName.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}
