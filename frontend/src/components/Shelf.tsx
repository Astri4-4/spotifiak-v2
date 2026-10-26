import type { ReactNode } from 'react'

interface ShelfProps {
  title: string
  children: ReactNode
}

export function Shelf({ title, children }: ShelfProps) {
  return (
    <section className="shelf">
      <h2 className="shelf-title">{title}</h2>
      <div className="shelf-row">{children}</div>
    </section>
  )
}
