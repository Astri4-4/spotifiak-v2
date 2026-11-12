import { useEffect } from 'react'
import { api, type Download } from '../api'
import { useCollection } from '../collection/context'
import { DOWNLOADS_EVENT, isSettled } from '../downloads'

const ACTIVE_POLL_MS = 4000

function message(d: Download) {
  if (d.status === 'failed') return `Échec du téléchargement : ${d.title}`
  if (d.status === 'partial') return `${d.title} : ${d.downloaded} titre${d.downloaded > 1 ? 's' : ''} sur ${d.size} téléchargés`
  return `${d.title} est prêt à écouter`
}

/** Shows a toast when one of the user's downloads is ready (or failed), while any is on its way. */
export function DownloadWatcher() {
  const { notify } = useCollection()

  useEffect(() => {
    let known = new Map<string, Download>()
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const check = async () => {
      clearTimeout(timer)
      try {
        const list = await api.downloads()
        if (stopped) return
        for (const d of list) {
          const before = known.get(d.id)
          if (before && !isSettled(before) && isSettled(d)) notify(message(d))
        }
        known = new Map(list.map((d) => [d.id, d]))
        if (list.some((d) => !isSettled(d))) timer = setTimeout(() => void check(), ACTIVE_POLL_MS)
      } catch {
        // Looked at again when the next download starts.
      }
    }

    const kick = () => void check()
    window.addEventListener(DOWNLOADS_EVENT, kick)
    void check()
    return () => {
      stopped = true
      clearTimeout(timer)
      window.removeEventListener(DOWNLOADS_EVENT, kick)
    }
  }, [notify])

  return null
}
