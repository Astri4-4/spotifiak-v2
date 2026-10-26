import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  spotify,
  type ApiError,
  type MissingTrack,
  type SpotifyImport,
  type SpotifyPlaylist,
  type SpotifyStatus,
} from '../api'
import { useCurrentUser } from '../auth/context'
import { useCollection } from '../collection/context'
import { LikedCover } from '../components/CollectionCovers'
import { formatAddedAt } from '../format'
import { NoteIcon, RefreshIcon } from '../icons'

// Imports waiting for downloads only change when a scan runs, so a slow poll is enough.
const POLL_ACTIVE_MS = 2000
const POLL_WAITING_MS = 10_000

const nf = new Intl.NumberFormat('fr-FR')
const titles = (n: number) => `${nf.format(n)} titre${n > 1 ? 's' : ''}`

/** Spotify's CDN sends no CORS headers, so a plain <img> rather than <Cover>. */
function SpotifyImage({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div className="cover cover-placeholder" style={{ width: 48, height: 48 }}>
        <NoteIcon size={20} />
      </div>
    )
  }
  return <img className="cover" src={src} alt="" width={48} height={48} loading="lazy" onError={() => setFailed(true)} />
}

function SetupHelp({ status }: { status: SpotifyStatus }) {
  const isAdmin = useCurrentUser().role === 'admin'
  if (!isAdmin) {
    return <p className="muted">L'import Spotify n'est pas encore configuré. Demandez à un administrateur de l'activer.</p>
  }
  return (
    <div className="spotify-setup">
      <p>L'import Spotify demande une application développeur Spotify :</p>
      <ol>
        <li>
          Sur <span className="white">developer.spotify.com/dashboard</span>, créez une application (le compte qui la crée
          doit être Premium) avec l'API « Web API ».
        </li>
        <li>
          Ajoutez l'URI de redirection{' '}
          <code>{status.redirectUri ?? 'http://127.0.0.1:8080/api/spotify/callback'}</code>. En HTTP, Spotify exige{' '}
          <code>127.0.0.1</code> et refuse <code>localhost</code>.
        </li>
        <li>
          Dans « User Management », ajoutez l'email Spotify de chaque personne qui importera ses playlists (5 au maximum
          en mode développement).
        </li>
        <li>
          Renseignez <code>SPOTIFY_CLIENT_ID</code>, <code>SPOTIFY_CLIENT_SECRET</code> et{' '}
          <code>SPOTIFY_REDIRECT_URI</code> dans <code>.env</code>, puis redémarrez l'API.
        </li>
      </ol>
    </div>
  )
}

function statusLabel(imp: SpotifyImport) {
  switch (imp.status) {
    case 'running':
      return 'Analyse en cours…'
    case 'waiting':
      return 'Téléchargement des titres manquants…'
    case 'failed':
      return `Échec : ${imp.error ?? 'erreur inconnue'}`
    default:
      return 'Terminé'
  }
}

function MissingList({ importId }: { importId: string }) {
  const [tracks, setTracks] = useState<MissingTrack[] | null>(null)
  useEffect(() => {
    spotify.missing(importId).then(setTracks).catch(() => setTracks([]))
  }, [importId])
  if (!tracks) return null
  return (
    <ul className="missing-list">
      {tracks.map((t) => (
        <li key={t.id}>
          <span className="missing-title">{t.title}</span>
          <span className="muted">
            {t.artist}
            {t.album && ` • ${t.album}`}
          </span>
          <span className={`missing-status ${t.status}`}>{t.status === 'queued' ? 'En téléchargement' : 'Introuvable'}</span>
        </li>
      ))}
    </ul>
  )
}

function ImportRow({ imp }: { imp: SpotifyImport }) {
  const [open, setOpen] = useState(false)
  const c = imp.counts
  const processed = imp.total - c.pending
  const missing = c.queued + c.not_found
  const target = imp.liked ? '/collection/tracks' : imp.playlistId && `/playlist/${imp.playlistId}`

  return (
    <li className="import-row">
      <div className="import-row-head">
        <div>
          <div className="import-name">
            {target ? <Link to={target}>{imp.name}</Link> : imp.name}
            {imp.playlistId === null && !imp.liked && <span className="muted"> (playlist supprimée)</span>}
          </div>
          <div className={`import-status ${imp.status}`}>
            {(imp.status === 'running' || imp.status === 'waiting') && <RefreshIcon className="spin" size={14} />}
            {statusLabel(imp)} <span className="muted">· {formatAddedAt(imp.createdAt)}</span>
          </div>
        </div>
        {missing > 0 && (
          <button className="text-button" onClick={() => setOpen(!open)}>
            {open ? 'Masquer' : 'Titres manquants'}
          </button>
        )}
      </div>
      <div className="scan-bar">
        <div className="scan-bar-fill" style={{ width: `${imp.total ? (c.matched / imp.total) * 100 : 0}%` }} />
      </div>
      <div className="scan-numbers">
        <span>
          {nf.format(c.matched)} / {nf.format(imp.total)} titres dans la bibliothèque
          {imp.status === 'running' && imp.total > 0 && ` · ${nf.format(processed)} analysés`}
        </span>
        <span className="muted">
          {c.queued > 0 && `${nf.format(c.queued)} en téléchargement`}
          {c.queued > 0 && c.not_found > 0 && ' · '}
          {c.not_found > 0 && `${nf.format(c.not_found)} introuvables`}
        </span>
      </div>
      {open && <MissingList importId={imp.id} />}
    </li>
  )
}

// The API answers 409 when the Spotify connection is missing or expired.
const SPOTIFY_NOT_CONNECTED = 409

function Playlists({ onImported, onDisconnected }: { onImported: () => void; onDisconnected: () => void }) {
  const [data, setData] = useState<{ likedTotal: number; playlists: SpotifyPlaylist[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const { notify, refreshPlaylists } = useCollection()

  const load = useCallback(() => {
    spotify
      .playlists()
      .then(setData)
      .catch((err: ApiError) => {
        setError(err.message)
        // Connection revoked or expired: back to the "Connecter Spotify" button.
        if (err.status === SPOTIFY_NOT_CONNECTED) onDisconnected()
      })
  }, [onDisconnected])
  useEffect(load, [load])

  const start = async (key: string, run: () => Promise<unknown>, label: string) => {
    setBusy(key)
    try {
      await run()
      notify(`Import de « ${label} » lancé`)
      refreshPlaylists()
      onImported()
      load()
    } catch (err) {
      notify((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Chargement de vos playlists Spotify…</p>

  // Importable first; Spotify hides the tracks of playlists you only follow.
  const playlists = [...data.playlists].sort((a, b) => Number(b.importable) - Number(a.importable))

  return (
    <ul className="spotify-playlists">
      <li className="spotify-playlist">
        <LikedCover size={48} />
        <div className="spotify-playlist-text">
          <span className="spotify-playlist-name">Titres likés</span>
          <span className="muted">{titles(data.likedTotal)} · ajoutés à vos Titres likés</span>
        </div>
        <button
          className="pill-button small"
          disabled={busy !== null || data.likedTotal === 0}
          onClick={() => void start('liked', spotify.importLiked, 'Titres likés')}
        >
          Importer
        </button>
      </li>
      {playlists.map((p) => (
        <li key={p.id} className={`spotify-playlist${p.importable ? '' : ' disabled'}`}>
          <SpotifyImage src={p.image} />
          <div className="spotify-playlist-text">
            <span className="spotify-playlist-name">{p.name}</span>
            <span className="muted">
              {p.importable
                ? `${p.owner} · ${titles(p.total)}`
                : `${p.owner} · Spotify ne donne accès qu'à vos propres playlists`}
            </span>
          </div>
          {p.importedPlaylistId && (
            <Link to={`/playlist/${p.importedPlaylistId}`} className="text-button">
              Voir
            </Link>
          )}
          {p.importable && (
            <button
              className={`pill-button small${p.importedPlaylistId ? ' outline' : ''}`}
              disabled={busy !== null || p.total === 0}
              onClick={() => void start(p.id, () => spotify.importPlaylist(p.id, p.name), p.name)}
            >
              {p.importedPlaylistId ? 'Réimporter' : 'Importer'}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

function Imports({ version }: { version: number }) {
  const [imports, setImports] = useState<SpotifyImport[] | null>(null)
  const { refreshPlaylists, refreshLikes } = useCollection()
  const matchedTotal = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const list = await spotify.imports().catch(() => null)
      if (cancelled) return
      if (list) {
        setImports(list)
        // New matches: refresh the library sidebar and likes so they show up.
        const matched = list.reduce((n, i) => n + i.counts.matched, 0)
        if (matchedTotal.current !== null && matched !== matchedTotal.current) {
          refreshPlaylists()
          refreshLikes()
        }
        matchedTotal.current = matched
      }
      const active = list?.some((i) => i.status === 'running')
      const waiting = list?.some((i) => i.status === 'waiting')
      if (active || waiting) timer = setTimeout(poll, active ? POLL_ACTIVE_MS : POLL_WAITING_MS)
    }
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [version, refreshPlaylists, refreshLikes])

  if (!imports?.length) return null
  return (
    <section className="scan-card">
      <h2 className="settings-title">Imports</h2>
      <ul className="import-list">
        {imports.map((imp) => (
          <ImportRow key={imp.id} imp={imp} />
        ))}
      </ul>
    </section>
  )
}

export function SpotifyImportPage() {
  const [status, setStatus] = useState<SpotifyStatus | null>(null)
  const [params, setParams] = useSearchParams()
  // Coming back from Spotify: the outcome is in the URL.
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(() => {
    const error = params.get('error')
    if (error) return { ok: false, text: error }
    return params.get('connected') ? { ok: true, text: 'Compte Spotify connecté' } : null
  })
  const [importsVersion, setImportsVersion] = useState(0)
  const [statusVersion, setStatusVersion] = useState(0)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    spotify.status().then(setStatus).catch(() => {})
  }, [statusVersion])

  // The banner was read from the URL; clean it so a reload doesn't show it again.
  useEffect(() => {
    if (params.has('error') || params.has('connected')) setParams({}, { replace: true })
  }, [params, setParams])

  const connect = async () => {
    setConnecting(true)
    try {
      window.location.href = (await spotify.authorizeUrl()).url
    } catch (err) {
      setBanner({ ok: false, text: (err as Error).message })
      setConnecting(false)
    }
  }

  const reloadStatus = useCallback(() => setStatusVersion((v) => v + 1), [])

  const disconnect = async () => {
    await spotify.disconnect()
    reloadStatus()
  }

  return (
    <div className="page">
      <div className="page-gradient" style={{ '--header-color': '30, 215, 96' } as React.CSSProperties} />
      <div className="page-inner settings-page">
        <h1 className="greeting">Importer depuis Spotify</h1>

        {banner && <p className={banner.ok ? 'form-success' : 'error'}>{banner.text}</p>}

        {status && !status.configured && (
          <section className="scan-card">
            <SetupHelp status={status} />
          </section>
        )}

        {status?.configured && !status.account && (
          <section className="scan-card">
            <p className="spotify-intro">
              Connectez votre compte Spotify pour retrouver vos playlists. Les titres déjà dans votre bibliothèque sont
              ajoutés tout de suite, les autres sont téléchargés via deemix puis ajoutés à leur place dans la playlist.
            </p>
            <button className="auth-submit spotify-connect" onClick={() => void connect()} disabled={connecting}>
              Connecter Spotify
            </button>
          </section>
        )}

        {status?.account && (
          <>
            <section className="scan-card">
              <header className="scan-card-header">
                <h2>Vos playlists Spotify</h2>
                <span className="muted">
                  {status.account.displayName ?? status.account.spotifyUserId} ·{' '}
                  <button className="text-link" onClick={() => void disconnect()}>
                    Déconnecter
                  </button>
                </span>
              </header>
              <Playlists onImported={() => setImportsVersion((v) => v + 1)} onDisconnected={reloadStatus} />
            </section>
            <Imports version={importsVersion} />
          </>
        )}
      </div>
    </div>
  )
}
