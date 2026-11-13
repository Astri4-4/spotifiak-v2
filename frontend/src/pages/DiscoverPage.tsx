import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, images, type DeezerTrack } from '../api'
import { useCollection } from '../collection/context'
import { Cover } from '../components/Cover'
import { MobileHeader } from '../components/Mobile'
import { startDownload } from '../downloads'
import { useFetch, useIsMobile } from '../hooks'
import { PauseIcon, PlayIcon } from '../icons'
import { usePlayer } from '../player/context'

/**
 * Music outside the library: new artists close to what the user plays, albums to finish, and the
 * artists friends love. Each track has Deezer's 30 s preview, to listen before downloading.
 */
export function DiscoverPage() {
  const { data, error } = useFetch(() => api.suggestions(), [])
  const { notify } = useCollection()
  const isMobile = useIsMobile()
  const preview = usePreview()
  // Started from here: hidden from the suggestions (the Downloads page follows them).
  const [started, setStarted] = useState<Set<string>>(new Set())

  const download = async (links: string[]) => {
    setStarted((prev) => new Set([...prev, ...links]))
    for (const link of links) {
      try {
        await startDownload(link)
      } catch (err) {
        notify((err as Error).message)
      }
    }
    notify(links.length > 1 ? `${links.length} téléchargements lancés` : 'Téléchargement lancé')
  }

  const forYou = data?.forYou.filter((t) => !started.has(t.link) && !t.download) ?? []
  const albums = data?.albums.filter((a) => !started.has(a.link)) ?? []
  const friends = data?.tracks.filter((t) => !started.has(t.link) && !t.download) ?? []

  const trackRow = (t: DeezerTrack, detail: string) => (
    <li key={t.id} className="suggestion-row">
      <PreviewButton track={t} preview={preview} />
      <span className="download-text">
        <span className="download-title">{t.title}</span>
        <span className="download-subtitle">
          {t.artist.name} • {detail}
        </span>
      </span>
      <button className="pill-button small outline" onClick={() => void download([t.link])} aria-label={`Télécharger ${t.title}`}>
        Télécharger
      </button>
    </li>
  )

  return (
    <div className="page">
      <div className="page-inner">
        {isMobile ? <MobileHeader title="Découvrir" /> : <h1 className="greeting">Découvrir</h1>}
        {error && <p className="error">{error}</p>}
        {!data && !error && <p className="muted">Recherche de nouveautés pour toi… (ça peut prendre une minute la première fois de la journée)</p>}
        {data && !forYou.length && !albums.length && !friends.length && (
          <div className="empty-state">
            <h2>Rien de nouveau pour l'instant</h2>
            <p>Écoute quelques titres : les suggestions viennent de ce que tu écoutes dans Spotifiak.</p>
          </div>
        )}

        {forYou.length > 0 && (
          <section>
            <div className="shelf-header">
              <h2 className="section-title">Nouveaux artistes pour toi</h2>
              <button className="pill-button small outline" onClick={() => void download(forYou.map((t) => t.link))}>
                Tout télécharger
              </button>
            </div>
            <ul>{forYou.map((t) => trackRow(t, `parce que tu écoutes ${t.because}`))}</ul>
          </section>
        )}

        {albums.length > 0 && (
          <section>
            <h2 className="section-title">Albums à compléter</h2>
            <ul>
              {albums.map(({ album, have, total, link }) => (
                <li key={album.id} className="suggestion-row">
                  <Cover src={images.album(album)} size={56} />
                  <span className="download-text">
                    <Link to={`/album/${album.id}`} className="download-title">
                      {album.title}
                    </Link>
                    <span className="download-subtitle">
                      {album.artist.name} • {have} titres sur {total}
                    </span>
                  </span>
                  <button className="pill-button small outline" onClick={() => void download([link])}>
                    Compléter
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {friends.length > 0 && (
          <section>
            <div className="shelf-header">
              <h2 className="section-title">Les artistes de tes amis</h2>
              <button className="pill-button small outline" onClick={() => void download(friends.map((t) => t.link))}>
                Tout télécharger
              </button>
            </div>
            <ul>{friends.map((t) => trackRow(t, t.fans.length ? `aimé par ${t.fans.join(' et ')}` : 'dans les goûts de tes amis'))}</ul>
          </section>
        )}
      </div>
    </div>
  )
}

type Preview = ReturnType<typeof usePreview>

/** One 30 s preview at a time, pausing the main player while it plays. */
function usePreview() {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playingId, setPlayingId] = useState<number | null>(null)
  const player = usePlayer()
  useEffect(() => () => audio.current?.pause(), [])
  const toggle = (track: DeezerTrack) => {
    audio.current?.pause()
    if (playingId === track.id || !track.preview) {
      setPlayingId(null)
      return
    }
    if (player.playing) player.toggle()
    const el = new Audio(track.preview)
    el.onended = () => setPlayingId(null)
    void el.play().catch(() => setPlayingId(null))
    audio.current = el
    setPlayingId(track.id)
  }
  return { playingId, toggle }
}

function PreviewButton({ track, preview }: { track: DeezerTrack; preview: Preview }) {
  const playing = preview.playingId === track.id
  return (
    <button
      className="preview-button"
      onClick={() => preview.toggle(track)}
      disabled={!track.preview}
      aria-label={playing ? `Arrêter l'extrait de ${track.title}` : `Écouter un extrait de ${track.title}`}
      title={track.preview ? undefined : "Pas d'extrait"}
    >
      <Cover src={track.album.cover_medium} size={56} />
      {track.preview && <span className="preview-icon">{playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}</span>}
    </button>
  )
}
