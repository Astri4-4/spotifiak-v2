import { useState } from 'react'
import { api, type DuplicateGroup } from '../api'
import { formatDuration, pluralize } from '../format'

const KEEP_ALL = ''

function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`
}

/** Finds copies of the same track and deletes the extra files, keeping the chosen one. */
export function Duplicates({ scanning }: { scanning: boolean }) {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  // Kept copy per group (keyed by its best copy's id); KEEP_ALL leaves the group alone.
  const [keep, setKeep] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ removed: number; failed: { path: string; error: string }[] } | null>(null)

  const search = async () => {
    setBusy(true)
    setError(null)
    try {
      const found = await api.duplicates()
      setGroups(found)
      // Keep earlier choices (e.g. "Tout garder") across a reload; the best copy otherwise.
      setKeep((prev) =>
        Object.fromEntries(
          found.map((g) => {
            const key = g.tracks[0].id
            const choice = prev[key]
            return [key, choice === KEEP_ALL || g.tracks.some((t) => t.id === choice) ? choice : key]
          }),
        ),
      )
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const selection = (groups ?? [])
    .map((g) => ({ keepId: keep[g.tracks[0].id], ids: g.tracks.map((t) => t.id) }))
    .filter((g) => g.keepId !== KEEP_ALL)
    .map((g) => ({ keepId: g.keepId, removeIds: g.ids.filter((id) => id !== g.keepId) }))
  const fileCount = selection.reduce((n, g) => n + g.removeIds.length, 0)

  const remove = async () => {
    setBusy(true)
    setConfirming(false)
    setError(null)
    try {
      setResult(await api.removeDuplicates(selection))
      await search()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <section className="scan-card">
      <header className="scan-card-header">
        <h2>Doublons</h2>
        {groups && <span className="muted">{pluralize(groups.length, 'titre')} en plusieurs exemplaires</span>}
      </header>

      <div className="scan-actions">
        <button className="pill-button outline" onClick={() => void search()} disabled={busy}>
          {groups ? 'Relancer la recherche' : 'Rechercher les doublons'}
        </button>
        {groups && groups.length > 0 && !confirming && (
          <button className="pill-button" onClick={() => setConfirming(true)} disabled={busy || scanning || !fileCount}>
            Supprimer {pluralize(fileCount, 'fichier')}
          </button>
        )}
        {confirming && (
          <>
            <button className="pill-button danger" onClick={() => void remove()} disabled={busy || scanning}>
              Confirmer la suppression
            </button>
            <button className="pill-button outline" onClick={() => setConfirming(false)}>
              Annuler
            </button>
          </>
        )}
        <span className="muted scan-help">
          Même titre et même artiste, à 3 secondes près. Le meilleur fichier est présélectionné (FLAC, puis meilleur débit).
          Les autres sont supprimés du disque ; leurs likes et playlists passent sur le fichier gardé.
          {scanning && ' Attendez la fin du scan pour supprimer.'}
        </span>
      </div>

      {error && <p className="error">{error}</p>}
      {result && (
        <p className={result.failed.length ? 'error' : 'muted'}>
          {pluralize(result.removed, 'fichier')} supprimé{result.removed > 1 ? 's' : ''}
          {result.failed.length > 0 && ` · ${result.failed.length} échec(s) : ${result.failed[0].error}`}
        </p>
      )}
      {groups?.length === 0 && <p className="muted">Aucun doublon trouvé.</p>}

      {groups && groups.length > 0 && (
        <ul className="dup-groups">
          {groups.map((g) => {
            const key = g.tracks[0].id
            const name = `dup-${key}`
            return (
              <li key={key} className="dup-group">
                <div className="dup-title">
                  <strong>{g.tracks[0].title}</strong> <span className="muted">· {g.tracks[0].artistName}</span>
                </div>
                {g.tracks.map((t) => (
                  <label key={t.id} className={`dup-copy${keep[key] === t.id ? ' kept' : ''}`}>
                    <input type="radio" name={name} checked={keep[key] === t.id} onChange={() => setKeep({ ...keep, [key]: t.id })} />
                    <span className="dup-meta">
                      {t.format}
                      {t.bitrateKbps != null && ` · ${t.bitrateKbps} kb/s`} · {formatSize(t.fileSize)} · {formatDuration(t.durationSec)}
                      {t.album && ` · ${t.album.title}`}
                    </span>
                    <span className="dup-path muted" title={t.path}>
                      {t.path}
                    </span>
                  </label>
                ))}
                <label className="dup-copy">
                  <input type="radio" name={name} checked={keep[key] === KEEP_ALL} onChange={() => setKeep({ ...keep, [key]: KEEP_ALL })} />
                  <span className="muted">Tout garder</span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
