import { useEffect, useState } from 'react'
import { api, type ScanMode, type ScanStatus } from '../api'
import { useCurrentUser } from '../auth/context'
import { Duplicates } from '../components/Duplicates'
import { formatAddedAt } from '../format'
import { CheckIcon, RefreshIcon } from '../icons'

// Poll fast while something runs, slowly otherwise (a periodic scan may start any time).
const POLL_ACTIVE_MS = 1000
const POLL_IDLE_MS = 5000

const nf = new Intl.NumberFormat('fr-FR')

function formatDuration(ms: number) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

function useScanStatus() {
  const [status, setStatus] = useState<ScanStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const s = await api.scanStatus()
        if (cancelled) return
        setStatus(s)
        setError(null)
        timer = setTimeout(poll, s.running || s.enrichment.running ? POLL_ACTIVE_MS : POLL_IDLE_MS)
      } catch (err) {
        if (cancelled) return
        setError((err as Error).message)
        timer = setTimeout(poll, POLL_IDLE_MS)
      }
    }
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [tick])

  // Re-poll immediately after starting a scan.
  return { status, error, refresh: () => setTick((t) => t + 1) }
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const percent = total ? Math.min(100, (done / total) * 100) : 0
  return (
    <div className="scan-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <div className="scan-bar-fill" style={{ width: `${percent}%` }} />
    </div>
  )
}

type StepState = 'done' | 'active' | 'pending' | 'skipped'

function Step({ state, title, children }: { state: StepState; title: string; children?: React.ReactNode }) {
  return (
    <li className={`scan-step ${state}`}>
      <span className="scan-step-marker">{state === 'done' ? <CheckIcon size={20} /> : <span />}</span>
      <div className="scan-step-body">
        <div className="scan-step-title">{title}</div>
        {children && <div className="scan-step-detail">{children}</div>}
      </div>
    </li>
  )
}

const PHASE_ORDER = ['listing', 'indexing', 'cleanup'] as const

function stepState(status: ScanStatus, phase: (typeof PHASE_ORDER)[number]): StepState {
  if (!status.running) return 'done'
  const current = PHASE_ORDER.indexOf(status.phase ?? 'listing')
  const index = PHASE_ORDER.indexOf(phase)
  return index < current ? 'done' : index === current ? 'active' : 'pending'
}

function Indexing({ status, now }: { status: ScanStatus; now: number }) {
  const p = status.progress
  if (!p) return null
  const elapsed = now - new Date(p.startedAt).getTime()
  const rate = elapsed > 2000 ? p.done / (elapsed / 1000) : 0
  const remaining = rate > 0 ? ((p.total - p.done) / rate) * 1000 : null

  return (
    <>
      <ProgressBar done={p.done} total={p.total} />
      <div className="scan-numbers">
        <span>
          {nf.format(p.done)} / {nf.format(p.total)} fichiers
          {p.total > 0 && ` · ${Math.floor((p.done / p.total) * 100)} %`}
        </span>
        <span className="muted">
          {rate > 0 && `${rate.toFixed(1)} fichiers/s`}
          {remaining != null && p.done < p.total && ` · environ ${formatDuration(remaining)} restantes`}
        </span>
      </div>
    </>
  )
}

function Enrichment({ status }: { status: ScanStatus }) {
  const e = status.enrichment
  if (!e.enabled) return <span className="muted">Désactivé (DEEZER_ENRICH=false)</span>
  if (!e.running && !e.albums.total && !e.artists.total) return <span className="muted">Rien à chercher</span>
  return (
    <>
      <div className="scan-sub">
        <span>
          Albums : {nf.format(e.albums.done)} / {nf.format(e.albums.total)}
        </span>
        <span className="muted">{nf.format(e.albums.matched)} trouvés</span>
      </div>
      <ProgressBar done={e.albums.done} total={e.albums.total} />
      <div className="scan-sub">
        <span>
          Artistes : {nf.format(e.artists.done)} / {nf.format(e.artists.total)}
        </span>
        <span className="muted">{nf.format(e.artists.matched)} trouvés</span>
      </div>
      <ProgressBar done={e.artists.done} total={e.artists.total} />
    </>
  )
}

function LastScan({ status }: { status: ScanStatus }) {
  const r = status.lastResult
  if (!status.lastFinishedAt) return <p className="muted">Aucun scan terminé depuis le démarrage du serveur.</p>
  return (
    <>
      <p className="muted">
        Scan {status.lastMode === 'full' ? 'complet' : 'rapide'} terminé {formatAddedAt(status.lastFinishedAt)} à{' '}
        {new Date(status.lastFinishedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}, en{' '}
        {formatDuration(status.lastDurationMs ?? 0)}
      </p>
      {status.lastError && <p className="error">Échec : {status.lastError}</p>}
      {r && (
        <div className="scan-tiles">
          {(
            [
              ['Fichiers', r.files],
              ['Vérifiés', r.checked],
              ['Ajoutés', r.added],
              ['Mis à jour', r.updated],
              ['Supprimés', r.removed],
              ['Échecs', r.failed],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className={`scan-tile${label === 'Échecs' && value > 0 ? ' warn' : ''}`}>
              <div className="scan-tile-value">{nf.format(value)}</div>
              <div className="scan-tile-label">{label}</div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export function ScanPage() {
  const isAdmin = useCurrentUser().role === 'admin'
  const { status, error, refresh } = useScanStatus()
  const [starting, setStarting] = useState(false)
  // Clock ticking every second so elapsed time and ETA move between polls.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const start = async (mode: ScanMode) => {
    setStarting(true)
    try {
      await api.startScan(mode)
    } finally {
      setStarting(false)
      refresh()
    }
  }

  const busy = !status || status.running || starting

  return (
    <div className="page">
      <div className="page-gradient" />
      <div className="page-inner scan-page">
        <h1 className="greeting">Analyse de la bibliothèque</h1>

        {isAdmin && (
          <div className="scan-actions">
            <button className="pill-button" onClick={() => void start('quick')} disabled={busy}>
              Scan rapide
            </button>
            <button className="pill-button outline" onClick={() => void start('full')} disabled={busy}>
              Scan complet
            </button>
            <span className="muted scan-help">
              Le scan rapide détecte les fichiers ajoutés ou supprimés. Le scan complet revérifie aussi chaque fichier
              existant.
            </span>
          </div>
        )}

        {error && <p className="error">API injoignable : {error}</p>}

        {status && (
          <>
            <section className="scan-card">
              <header className="scan-card-header">
                <h2>
                  {status.running && <RefreshIcon className="spin" size={20} />}
                  {status.running ? `Scan ${status.mode === 'full' ? 'complet' : 'rapide'} en cours` : 'Aucun scan en cours'}
                </h2>
                {status.running && status.lastStartedAt && (
                  <span className="muted">
                    depuis {formatDuration(Math.max(0, now - new Date(status.lastStartedAt).getTime()))}
                  </span>
                )}
              </header>

              {status.running ? (
                <ol className="scan-steps">
                  <Step state={stepState(status, 'listing')} title="Liste des dossiers">
                    {nf.format(status.dirsListed)} dossiers parcourus
                  </Step>
                  <Step state={stepState(status, 'indexing')} title="Lecture des fichiers">
                    {status.phase === 'indexing' && <Indexing status={status} now={now} />}
                  </Step>
                  <Step state={stepState(status, 'cleanup')} title="Nettoyage" />
                </ol>
              ) : (
                <LastScan status={status} />
              )}
            </section>

            <section className="scan-card">
              <header className="scan-card-header">
                <h2>
                  {status.enrichment.running && <RefreshIcon className="spin" size={20} />}
                  Pochettes et photos Deezer
                </h2>
                {!status.enrichment.running && status.enrichment.lastFinishedAt && (
                  <span className="muted">
                    terminé {formatAddedAt(status.enrichment.lastFinishedAt)}
                    {status.enrichment.lastFailed > 0 && ` · ${status.enrichment.lastFailed} échecs`}
                  </span>
                )}
              </header>
              <Enrichment status={status} />
            </section>

            {isAdmin && <Duplicates scanning={status.running} />}
          </>
        )}
      </div>
    </div>
  )
}
