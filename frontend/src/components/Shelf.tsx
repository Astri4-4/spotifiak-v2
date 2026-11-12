import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface ShelfProps {
  title: string
  /** A "Tout afficher" link. */
  more?: string
  children: ReactNode
}

export function Shelf({ title, more, children }: ShelfProps) {
  return (
    <section className="shelf">
      <div className="shelf-header">
        <h2 className="shelf-title">{title}</h2>
        {more && (
          <Link to={more} className="shelf-more">
            Tout afficher
          </Link>
        )}
      </div>
      <div className="shelf-row">{children}</div>
    </section>
  )
}
