import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, images } from '../api'
import { useCollection } from '../collection/context'
import { startDownload } from '../downloads'
import { useFetch } from '../hooks'
import { Cover } from './Cover'

/** What to download next: albums to finish, and friends' artists' top tracks the library lacks. */
export function DownloadSuggestions() {
  const { data } = useFetch(() => api.suggestions(), [])
  const { notify } = useCollection()
  // Started from here: hidden from the suggestions (the list above shows them now).
  const [started, setStarted] = useState<Set<string>>(new Set())
  if (!data) return null
  const albums = data.albums.filter((a) => !started.has(a.link))
  const tracks = data.tracks.filter((t) => !started.has(t.link) && !t.download)
  if (!albums.length && !tracks.length) return null

  const download = async (links: string[]) => {
    setStarted((prev) => new Set([...prev, ...links]))
    for (const link of links) {
      try {
        await startDownload(link)
      } catch (err) {
        notify((err as Error).message)
      }
    }
  }

  return (
    <section className="downloads-suggestions">
      {albums.length > 0 && (
        <>
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
        </>
      )}
      {tracks.length > 0 && (
        <>
          <div className="shelf-header">
            <h2 className="section-title">Les artistes de tes amis</h2>
            <button className="pill-button small outline" onClick={() => void download(tracks.map((t) => t.link))}>
              Tout télécharger
            </button>
          </div>
          <ul>
            {tracks.map((t) => (
              <li key={t.id} className="suggestion-row">
                <Cover src={t.album.cover_medium} size={56} />
                <span className="download-text">
                  <span className="download-title">{t.title}</span>
                  <span className="download-subtitle">
                    {t.artist.name}
                    {t.fans.length > 0 && ` • aimé par ${t.fans.join(' et ')}`}
                  </span>
                </span>
                <button className="pill-button small outline" onClick={() => void download([t.link])} aria-label={`Télécharger ${t.title}`}>
                  Télécharger
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
