import { api, type Download } from './api'

/** Fired when a download starts: the downloads page and the watcher look again right away. */
export const DOWNLOADS_EVENT = 'spotifiak:downloads'

/** Queues a Deezer link (track, album, or an artist's discography). */
export async function startDownload(url: string) {
  const { downloads } = await api.download(url)
  window.dispatchEvent(new Event(DOWNLOADS_EVENT))
  return downloads
}

/** Nothing more will happen to it: failed, or finished and found in the library. */
export const isSettled = (d: Download) => d.status === 'failed' || d.ready

/** Where it stands, in a few words. */
export function downloadStatusText(d: Download) {
  switch (d.status) {
    case 'queued':
      return 'En attente'
    case 'downloading':
      return d.size > 1 ? `${d.progress} % • ${d.downloaded}/${d.size} titres` : `${d.progress} %`
    case 'done':
      return d.ready ? 'Terminé' : 'Ajout à la bibliothèque…'
    case 'partial':
      return `${d.downloaded} titre${d.downloaded > 1 ? 's' : ''} sur ${d.size}${d.ready ? '' : ' • ajout à la bibliothèque…'}`
    case 'failed':
      return d.error ?? 'Échec'
  }
}
