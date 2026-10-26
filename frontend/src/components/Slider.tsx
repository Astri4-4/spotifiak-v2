import { useRef, useState, type PointerEvent } from 'react'

interface SliderProps {
  value: number
  max: number
  /** Called continuously while dragging when `live`, otherwise once on release. */
  onChange: (value: number) => void
  live?: boolean
  label: string
  /** Lets the parent show the dragged position (e.g. the elapsed time). */
  onPreview?: (value: number | null) => void
}

export function Slider({ value, max, onChange, live = false, label, onPreview }: SliderProps) {
  const track = useRef<HTMLDivElement>(null)
  const [dragValue, setDragValue] = useState<number | null>(null)

  const valueAt = (e: PointerEvent) => {
    const rect = track.current!.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    return ratio * max
  }

  const update = (v: number) => {
    setDragValue(v)
    onPreview?.(v)
    if (live) onChange(v)
  }

  const onPointerDown = (e: PointerEvent) => {
    if (!max) return
    e.currentTarget.setPointerCapture(e.pointerId)
    update(valueAt(e))
  }

  const onPointerMove = (e: PointerEvent) => {
    if (dragValue !== null) update(valueAt(e))
  }

  const onPointerUp = (e: PointerEvent) => {
    if (dragValue === null) return
    onChange(valueAt(e))
    setDragValue(null)
    onPreview?.(null)
  }

  const shown = dragValue ?? value
  const percent = max ? (shown / max) * 100 : 0

  return (
    <div
      className={`slider${dragValue !== null ? ' dragging' : ''}`}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(shown)}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = max / 20
        if (e.key === 'ArrowRight') onChange(Math.min(max, value + step))
        if (e.key === 'ArrowLeft') onChange(Math.max(0, value - step))
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="slider-track" ref={track}>
        <div className="slider-fill" style={{ width: `${percent}%` }} />
        <div className="slider-thumb" style={{ left: `${percent}%` }} />
      </div>
    </div>
  )
}
