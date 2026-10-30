export function formatDuration(sec: number | null | undefined) {
  if (sec == null || !Number.isFinite(sec)) return '-:--'
  const s = Math.floor(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "1 h 12 min", "34 min 5 s" — the album header style. */
export function formatTotalDuration(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h ? `${h} h ${m} min` : `${m} min ${s} s`
}

const DAY_MS = 86_400_000

/** "il y a 3 jours" for recent dates, "12 oct. 2026" otherwise, like Spotify. */
export function formatAddedAt(iso: string) {
  const date = new Date(iso)
  const days = Math.floor((Date.now() - date.getTime()) / DAY_MS)
  if (days < 1) return "aujourd'hui"
  if (days < 30) return `il y a ${days} jour${days > 1 ? 's' : ''}`
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function pluralize(n: number, word: string) {
  return `${n} ${word}${n > 1 ? 's' : ''}`
}

/** "21 oct." this year, "21 oct. 2025" before, like Spotify's episode dates. */
export function formatEpisodeDate(iso: string) {
  const date = new Date(iso)
  const thisYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: thisYear ? undefined : 'numeric' })
}

/** "1 h 12 min", "34 min": episode lengths and time left. */
export function formatListenTime(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h ? `${h} h ${m} min` : `${Math.max(1, m)} min`
}

/** "à l'instant", "il y a 5 min", "il y a 2 h", "il y a 3 j": friend activity and notifications. */
export function formatAgo(iso: string, now = Date.now()) {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  if (minutes < 24 * 60) return `il y a ${Math.floor(minutes / 60)} h`
  return `il y a ${Math.floor(minutes / (24 * 60))} j`
}
