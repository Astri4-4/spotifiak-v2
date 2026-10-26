import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PlusIcon } from '../icons'

interface DialogProps {
  title: string
  onClose: () => void
  children: ReactNode
}

/** Modal like Spotify's "Edit details": dark card over a dimmed page. */
export function Dialog({ title, onClose, children }: DialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header className="dialog-header">
          <h2>{title}</h2>
          <button className="icon-button dialog-close" onClick={onClose} aria-label="Fermer">
            <PlusIcon style={{ transform: 'rotate(45deg)' }} />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  )
}
