import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface PopoverMenuProps {
  /** The element the menu opens next to. */
  anchor: HTMLElement
  onClose: () => void
  children: ReactNode
  label: string
}

const MARGIN = 8

/**
 * A menu rendered in a portal with fixed positioning, so scrolling panels don't clip
 * it. It opens below the anchor, or above when there isn't room (e.g. near the player).
 */
export function PopoverMenu({ anchor, onClose, children, label }: PopoverMenuProps) {
  const menu = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' })

  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect()
    const m = menu.current!.getBoundingClientRect()
    const below = a.bottom + MARGIN + m.height <= window.innerHeight
    setStyle({
      top: below ? a.bottom + 4 : Math.max(MARGIN, a.top - m.height - 4),
      left: Math.max(MARGIN, Math.min(a.right - m.width, window.innerWidth - m.width - MARGIN)),
    })
  }, [anchor])

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node
      if (!menu.current?.contains(target) && !anchor.contains(target)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // The page scrolling under a fixed menu would detach it from its anchor.
    const onScroll = () => onClose()
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    document.getElementById('main-view')?.addEventListener('scroll', onScroll)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      document.getElementById('main-view')?.removeEventListener('scroll', onScroll)
    }
  }, [anchor, onClose])

  return createPortal(
    <div ref={menu} className="menu popover" role="menu" aria-label={label} style={style}>
      {children}
    </div>,
    document.body,
  )
}
