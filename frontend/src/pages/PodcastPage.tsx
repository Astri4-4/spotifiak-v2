import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { images, podcasts } from '../api'
import { useCollection } from '../collection/context'
import { Cover } from '../components/Cover'
import { EpisodeList } from '../components/EpisodeList'
import { PlayButton } from '../components/PlayButton'
import { pluralize } from '../format'
import { useDominantColor, useFetch } from '../hooks'
import { usePlayer } from '../player/context'
import { progressOf, usePlayEpisode } from '../podcasts'

// Keyed by id so per-podcast state (header color, "plus") starts fresh on navigation.
export function PodcastPage() {
  const { id = '' } = useParams()
  return <PodcastView key={id} id={id} />
}

function PodcastView({ id }: { id: string }) {
  const { data: podcast, error } = useFetch(() => podcasts.get(id), [id])
  const { color, fromImage } = useDominantColor()
  const { podcasts: subscriptions, toggleSubscribe } = useCollection()
  const { current, playing, toggle } = usePlayer()
  const { play } = usePlayEpisode()
  const [aboutOpen, setAboutOpen] = useState(false)

  if (error) return <div className="page page-inner error">Podcast introuvable.</div>
  if (!podcast) return <div className="page" />

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
        <PlayButton size="lg" playing={thisPodcast && playing} onClick={onPlay} />
        <button className="follow-button" onClick={() => toggleSubscribe(podcast)} aria-pressed={subscribed}>
          {subscribed ? 'Abonné' : "S'abonner"}
        </button>
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
        <h2 className="section-title">Tous les épisodes</h2>
        {podcast.episodes.length ? (
          <EpisodeList episodes={podcast.episodes} />
        ) : (
          <p className="muted">Ce flux ne contient aucun épisode.</p>
        )}
        {podcast.episodeCount > podcast.episodes.length && (
          <p className="muted">Les {podcast.episodes.length} épisodes les plus récents sont affichés.</p>
        )}
      </div>
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
