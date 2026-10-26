import { useCallback, useEffect, useState } from 'react'

interface FetchState<T> {
  key: string
  data: T | null
  error: string | null
}

/** Loads data for a page; reloads when `deps` change and never returns stale results. */
export function useFetch<T>(load: () => Promise<T>, deps: unknown[]) {
  const key = JSON.stringify(deps)
  const [state, setState] = useState<FetchState<T>>({ key: '', data: null, error: null })

  useEffect(() => {
    let cancelled = false
    load()
      .then((data) => !cancelled && setState({ key, data, error: null }))
      .catch((err: Error) => !cancelled && setState({ key, data: null, error: err.message }))
    return () => {
      cancelled = true
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  return state.key === key ? state : { data: null, error: null }
}

const DEFAULT_COLOR = '83, 83, 83'

/**
 * Average color of an image, darkened like Spotify's header gradients.
 * Returns an "r, g, b" string for use in rgba().
 */
export function useDominantColor() {
  const [color, setColor] = useState(DEFAULT_COLOR)

  const fromImage = useCallback((img: HTMLImageElement) => {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 16
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0, 16, 16)
      const pixels = ctx.getImageData(0, 0, 16, 16).data
      let r = 0
      let g = 0
      let b = 0
      for (let i = 0; i < pixels.length; i += 4) {
        r += pixels[i]
        g += pixels[i + 1]
        b += pixels[i + 2]
      }
      const n = pixels.length / 4
      // Keep it dark enough for white text.
      const scale = Math.min(1, 150 / Math.max(r / n, g / n, b / n, 1))
      setColor([r, g, b].map((c) => Math.round((c / n) * scale)).join(', '))
    } catch {
      // Cross-origin image without CORS headers: keep the default.
    }
  }, [])

  return { color, fromImage }
}
