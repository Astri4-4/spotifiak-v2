import { useState, type DragEvent } from 'react'

/**
 * Drag and drop to reorder a list (playlist rows, the queue): spread `handlers(i)` on
 * row i and add `classes(i)` to its class name. onMove(from, before) moves row `from`
 * before row `before` (length = to the end); without onMove, rows don't drag.
 */
export function useReorder(length: number, onMove?: (from: number, before: number) => void) {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropBefore, setDropBefore] = useState<number | null>(null)

  const reset = () => {
    setDragFrom(null)
    setDropBefore(null)
  }

  const handlers = (i: number) =>
    onMove && {
      draggable: true,
      onDragStart: (e: DragEvent) => {
        setDragFrom(i)
        e.dataTransfer.effectAllowed = 'move'
      },
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (dragFrom === null) return
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        // Upper half of a row drops before it, lower half after it.
        setDropBefore(e.clientY < rect.top + rect.height / 2 ? i : i + 1)
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        if (dragFrom !== null && dropBefore !== null && dropBefore !== dragFrom && dropBefore !== dragFrom + 1) {
          onMove(dragFrom, dropBefore)
        }
        reset()
      },
      onDragEnd: reset,
    }

  const classes = (i: number) =>
    (dragFrom === i ? ' dragging' : '') +
    (dropBefore === i ? ' drop-before' : dropBefore === i + 1 && i === length - 1 ? ' drop-after' : '')

  return { handlers, classes }
}
