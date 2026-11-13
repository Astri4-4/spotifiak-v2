import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Download } from '../api'
import { Cover } from '../components/Cover'
import { MobileHeader } from '../components/Mobile'
import { DOWNLOADS_EVENT, downloadStatusText, isSettled } from '../downloads'
import { useIsMobile } from '../hooks'
import { DownloadIcon } from '../icons'

const ACTIVE_POLL_MS = 2000

/** The user's downloads: waiting, downloading (with progress), done or failed. */
export function DownloadsPage() {
  const [downloads, setDownloads] = useState<Download[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isMobile = useIsMobile()

  const load = useCallback(
    () =>
      api
        .downloads()
        .then((list) => {
          setDownloads(list)
          setError(null)
        })
        .catch((err: Error) => setError(err.message)),
    [],
  )

  useEffect(() => {
    void load()
    const onStart = () => void load()
    window.addEventListener(DOWNLOADS_EVENT, onStart)
    return () => window.removeEventListener(DOWNLOADS_EVENT, onStart)
  }, [load])

  // Live progress while anything is on its way.
  const active = downloads?.some((d) => !isSettled(d)) ?? false
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => void load(), ACTIVE_POLL_MS)
    return () => clearInterval(timer)
  }, [active, load])

  const act = async (action: () => Promise<unknown>) => {
    try {
      await action()
    } catch (err) {
      setError((err as Error).message)
    }
    void load()
  }

  const finished = downloads?.filter((d) => isSettled(d)).length ?? 0

  return (
    <div className="page">
      <div className="page-inner">
        {isMobile ? <MobileHeader title="Téléchargements" /> : <h1 className="greeting">Téléchargements</h1>}
        {error && <p className="error">{error}</p>}
        {downloads && downloads.length === 0 && (
          <div className="empty-state">
            <DownloadIcon size={48} />
            <h2>Aucun téléchargement</h2>
            <p>Cherchez un titre, un album ou un artiste et téléchargez-le depuis l'onglet Deezer.</p>
            <Link to="/search" className="pill-button">
              Rechercher
            </Link>
          </div>
        )}
        {finished > 0 && (
          <div className="downloads-actions">
            <button className="pill-button small outline" onClick={() => void act(api.clearFinishedDownloads)}>
              Effacer les terminés
            </button>
          </div>
        )}
        {downloads && downloads.length > 0 && (
          <ul className="downloads-list">
            {downloads.map((d) => (
              <DownloadRow
                key={d.id}
                download={d}
                onRetry={() => void act(() => api.retryDownload(d.id))}
                onRemove={() => void act(() => api.removeDownload(d.id))}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function DownloadRow({ download: d, onRetry, onRemove }: { download: Download; onRetry: () => void; onRemove: () => void }) {
  const settled = isSettled(d)
  const link = d.albumId ? `/album/${d.albumId}` : null
  const title = link && d.ready ? <Link to={link}>{d.title}</Link> : d.title
  return (
    <li className={`download-row ${d.status}`}>
      <Cover src={d.coverUrl} size={56} />
      <div className="download-text">
        <span className="download-title">{title}</span>
        <span className="download-subtitle">
          {d.type === 'album' ? 'Album' : 'Titre'} • {d.artist}
        </span>
        <span className="download-status" role="status">
          {downloadStatusText(d)}
        </span>
        {!settled && (
          <span
            className="download-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={d.progress}
            aria-label={`Progression de ${d.title}`}
          >
            <span style={{ width: `${d.status === 'queued' ? 0 : d.progress}%` }} />
          </span>
        )}
      </div>
      <div className="download-buttons">
        {(d.status === 'failed' || d.status === 'partial') && (
          <button className="pill-button small outline" onClick={onRetry}>
            Réessayer
          </button>
        )}
        <button
          className="icon-button"
          onClick={onRemove}
          aria-label={settled ? `Retirer ${d.title} de la liste` : `Annuler le téléchargement de ${d.title}`}
          title={settled ? 'Retirer de la liste' : 'Annuler'}
        >
          ✕
        </button>
      </div>
    </li>
  )
}
