import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { images, podcasts, type PodcastDetail } from '../api'
import { useCollection } from '../collection/context'
import { Cover } from '../components/Cover'
import { Dialog } from '../components/Dialog'
import { EpisodeList, type EpisodeActions } from '../components/EpisodeList'
import { PlayButton } from '../components/PlayButton'
import { PopoverMenu } from '../components/PopoverMenu'
import { pluralize } from '../format'
import { useDominantColor, useFetch } from '../hooks'
import { MoreIcon } from '../icons'
import { usePlayer } from '../player/context'
import { progressOf, usePlayEpisode } from '../podcasts'

// Keyed by id so per-podcast state (header color, "plus") starts fresh on navigation.
export function PodcastPage() {
  const { id = '' } = useParams()
  return <PodcastView key={id} id={id} />
}

// While videos download, the page reloads this often to show them as they're ready.
const DOWNLOAD_POLL_MS = 3000

function EditDialog({ podcast, onClose, onSaved }: { podcast: PodcastDetail; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(podcast.title)
  const [description, setDescription] = useState(podcast.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await podcasts.update(podcast.id, { title, description })
      onSaved()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog title="Modifier les informations" onClose={onClose}>
      <form className="edit-playlist" onSubmit={onSubmit}>
        <Cover src={images.podcast(podcast)} className="edit-playlist-cover" quality="md" />
        <div className="edit-playlist-fields">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="Ajouter un nom" aria-label="Nom" autoFocus />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            placeholder="Ajouter une description (facultatif)"
            aria-label="Description"
          />
        </div>
        {error && <p className="error edit-playlist-error">{error}</p>}
        <button className="pill-button edit-playlist-save" disabled={busy || !title.trim()}>
          Enregistrer
        </button>
      </form>
    </Dialog>
  )
}

/** Created podcasts: paste a YouTube link, the server downloads its audio. */
function AddVideo({ podcastId, onAdded }: { podcastId: string; onAdded: () => void }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await podcasts.addVideo(podcastId, url)
      setUrl('')
      onAdded()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="add-video">
      <h2 className="section-title">Ajouter une vidéo YouTube</h2>
      <p className="muted">Le son de la vidéo devient un épisode de ce podcast.</p>
      <form onSubmit={onSubmit}>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          aria-label="Lien de la vidéo YouTube"
          required
        />
        <button className="pill-button small" disabled={busy || !url.trim()}>
          Ajouter
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

function PodcastView({ id }: { id: string }) {
  const [version, setVersion] = useState(0)
  const { data: podcast, error } = useFetch(() => podcasts.get(id), [id, version], { keepPrevious: true })
  const { color, fromImage } = useDominantColor()
  const { podcasts: subscriptions, toggleSubscribe, refreshPodcasts, notify } = useCollection()
  const { current, playing, toggle } = usePlayer()
  const { play } = usePlayEpisode()
  const navigate = useNavigate()
  const [aboutOpen, setAboutOpen] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [editing, setEditing] = useState(false)
  const reload = () => setVersion((v) => v + 1)

  const downloading = !!podcast?.episodes.some((e) => e.status === 'queued' || e.status === 'downloading')
  useEffect(() => {
    if (!downloading) return
    const timer = setTimeout(() => setVersion((v) => v + 1), DOWNLOAD_POLL_MS)
    return () => clearTimeout(timer)
  }, [downloading, podcast])

  // The first downloaded video gives a created podcast its artwork: show it in the library too.
  const staleInLibrary = !!podcast?.hasImage && subscriptions.some((p) => p.id === id && !p.hasImage)
  useEffect(() => {
    if (staleInLibrary) refreshPodcasts()
  }, [staleInLibrary, refreshPodcasts])

  if (error) return <div className="page page-inner error">Podcast introuvable.</div>
  if (!podcast) return <div className="page" />

  const actions: EpisodeActions | undefined = podcast.owned
    ? {
        retry: (e) => void podcasts.retry(podcast.id, e.id).then(reload, (err: Error) => notify(err.message)),
        remove: (e) =>
          void podcasts.removeEpisode(podcast.id, e.id).then(() => {
            notify('Épisode retiré du podcast')
            reload()
          }, (err: Error) => notify(err.message)),
      }
    : undefined

  const deletePodcast = async () => {
    setMenuAnchor(null)
    if (!window.confirm(`Supprimer « ${podcast.title} » et le son de ses vidéos ? Cette action est définitive.`)) return
    try {
      await podcasts.remove(podcast.id)
      refreshPodcasts()
      notify('Podcast supprimé')
      navigate('/')
    } catch (err) {
      notify((err as Error).message)
    }
  }

  const subscribed = subscriptions.some((p) => p.id === podcast.id)
  const thisPodcast = current?.episode?.podcastId === podcast.id
  // The big button resumes this podcast, or starts its latest episode not heard yet.
  const onPlay = () => {
    if (thisPodcast) return toggle()
    const episode = podcast.episodes.find((e) => !progressOf(e)?.completed) ?? podcast.episodes[0]
    if (episode) play(episode)
  }

  return (
    <div className="page" style={{ '--header-color': color } as React.CSSProperties}>
      <header className="entity-header">
        <Cover src={images.podcast(podcast)} quality="lg" className="entity-cover" onLoad={fromImage} />
        <div className="entity-info">
          <span className="entity-type">Podcast</span>
          <h1 className={`entity-title${podcast.title.length > 24 ? ' long' : ''}`}>{podcast.title}</h1>
          <div className="entity-meta">
            {podcast.author && <span className="white">{podcast.author}</span>}
            <span className="muted">{pluralize(podcast.episodeCount, 'épisode')}</span>
          </div>
        </div>
      </header>

      <div className="action-bar">
        {podcast.episodes.some((e) => e.status === 'ready') && (
          <PlayButton size="lg" playing={thisPodcast && playing} onClick={onPlay} />
        )}
        <button className="follow-button" onClick={() => toggleSubscribe(podcast)} aria-pressed={subscribed}>
          {subscribed ? 'Abonné' : "S'abonner"}
        </button>
        {podcast.owned && (
          <button
            className="icon-button action-more"
            onClick={(e) => setMenuAnchor(menuAnchor ? null : e.currentTarget)}
            aria-label={`Plus d'options pour ${podcast.title}`}
            aria-haspopup="menu"
          >
            <MoreIcon size={24} />
          </button>
        )}
        {menuAnchor && (
          <PopoverMenu anchor={menuAnchor} onClose={() => setMenuAnchor(null)} label={`Options pour ${podcast.title}`}>
            <button
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setMenuAnchor(null)
                setEditing(true)
              }}
            >
              Modifier les informations
            </button>
            <button role="menuitem" className="menu-item danger" onClick={() => void deletePodcast()}>
              Supprimer
            </button>
          </PopoverMenu>
        )}
      </div>

      <div className="page-inner podcast-page">
        {podcast.description && (
          <section className="podcast-about">
            <h2 className="section-title">À propos</h2>
            <p className={aboutOpen ? 'open' : ''}>{podcast.description}</p>
            {podcast.description.length > 150 && (
              <button className="text-button" onClick={() => setAboutOpen(!aboutOpen)}>
                {aboutOpen ? 'Moins' : 'Plus'}
              </button>
            )}
          </section>
        )}
        {podcast.owned && <AddVideo podcastId={podcast.id} onAdded={reload} />}
        <h2 className="section-title">Tous les épisodes</h2>
        {podcast.episodes.length ? (
          <EpisodeList episodes={podcast.episodes} actions={actions} />
        ) : (
          <p className="muted">
            {podcast.owned ? 'Ajoutez une première vidéo YouTube ci-dessus.' : 'Ce podcast ne contient aucun épisode.'}
          </p>
        )}
        {podcast.episodeCount > podcast.episodes.length && (
          <p className="muted">Les {podcast.episodes.length} épisodes les plus récents sont affichés.</p>
        )}
      </div>

      {editing && (
        <EditDialog
          podcast={podcast}
          onClose={() => setEditing(false)}
          onSaved={() => {
            reload()
            refreshPodcasts()
          }}
        />
      )}
    </div>
  )
}

/** /podcasts/open?feed=… — a podcast from the directory or a pasted RSS address. */
export function OpenPodcastPage() {
  const [params] = useSearchParams()
  const feed = params.get('feed') ?? ''
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    podcasts
      .open(feed)
      .then(({ id }) => !cancelled && navigate(`/podcast/${id}`, { replace: true }))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [feed, navigate])

  return (
    <div className="page page-inner">
      {error ? <p className="error">{error}</p> : <p className="muted">Lecture du flux du podcast…</p>}
    </div>
  )
}
