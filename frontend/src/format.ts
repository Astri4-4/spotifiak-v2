export function formatDuration(sec: number | null) {
  if (sec == null) return ''
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}
