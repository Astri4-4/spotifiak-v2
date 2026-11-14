import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { images, quiz, social, type QuizState } from '../api'
import { useCurrentUser } from '../auth/context'
import { useCollection } from '../collection/context'
import { Cover } from '../components/Cover'
import { MobileHeader } from '../components/Mobile'
import { PersonAvatar } from '../components/PersonAvatar'
import { useFetch, useIsMobile } from '../hooks'
import { usePlayer } from '../player/context'

/** Blind test between friends: create a game or join one with its code. */
export function QuizPage() {
  const { id } = useParams()
  return id ? <QuizGame id={id.toUpperCase()} /> : <QuizHome />
}

function Title() {
  const isMobile = useIsMobile()
  return isMobile ? <MobileHeader title="Blind test" /> : <h1 className="greeting">Blind test</h1>
}

function QuizHome() {
  const navigate = useNavigate()
  const { notify } = useCollection()
  const [code, setCode] = useState('')

  const create = async () => {
    try {
      navigate(`/quiz/${(await quiz.create()).id}`)
    } catch (err) {
      notify((err as Error).message)
    }
  }

  return (
    <div className="page">
      <div className="page-inner quiz">
        <Title />
        <p className="muted">
          10 extraits tirés de ce que vous écoutez, entre amis. Trouve le titre le plus vite possible : une bonne réponse
          rapporte jusqu'à 1000 points.
        </p>
        <button className="pill-button" onClick={() => void create()}>
          Créer une partie
        </button>
        <form
          className="quiz-join"
          onSubmit={(e) => {
            e.preventDefault()
            const c = code.trim().split('/').pop()
            if (c) navigate(`/quiz/${c.toUpperCase()}`)
          }}
        >
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code de la partie" aria-label="Code de la partie" />
          <button className="pill-button outline" disabled={!code.trim()}>
            Rejoindre
          </button>
        </form>
      </div>
    </div>
  )
}

/** The game's state as received, with when, to count the time left locally. */
function useGame(id: string) {
  const [state, setState] = useState<{ game: QuizState; at: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ended, setEnded] = useState(false)

  useEffect(() => {
    let events: EventSource | null = null
    let cancelled = false
    quiz
      .join(id)
      .then((game) => {
        if (cancelled) return
        setState({ game, at: performance.now() })
        events = new EventSource(quiz.eventsUrl(id), { withCredentials: true })
        events.addEventListener('state', (e) => setState({ game: JSON.parse((e as MessageEvent<string>).data) as QuizState, at: performance.now() }))
        events.addEventListener('end', () => {
          events?.close()
          setEnded(true)
        })
      })
      .catch((err: Error) => setError(err.message))
    return () => {
      cancelled = true
      events?.close()
    }
  }, [id])

  return { game: state?.game ?? null, receivedAt: state?.at ?? 0, error, ended }
}

function useRemaining(ms: number, receivedAt: number) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), 100)
    return () => clearInterval(t)
  }, [])
  return Math.max(0, ms - (now - receivedAt))
}

/** Plays the round's clip from its start; it keeps going during the reveal. */
function useClip(game: QuizState | null) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [blocked, setBlocked] = useState(false)
  const player = usePlayer()
  const playing = useRef(player.playing)
  playing.current = player.playing
  const toggle = useRef(player.toggle)
  toggle.current = player.toggle

  const active = game && (game.phase === 'countdown' || game.phase === 'question' || game.phase === 'reveal')
  const key = active ? `${game.id}/${game.index}` : null
  const clipStart = game?.round?.clipStart ?? 0
  const startNow = game?.phase === 'question'

  // Loaded during the countdown, so it starts with the round.
  useEffect(() => {
    if (!key || !game) return
    if (playing.current) toggle.current()
    const el = new Audio(quiz.clipUrl(game.id, game.index))
    el.preload = 'auto'
    el.addEventListener('loadedmetadata', () => (el.currentTime = clipStart), { once: true })
    audio.current = el
    return () => {
      el.pause()
      el.removeAttribute('src')
      el.load()
      audio.current = null
    }
  }, [key])

  useEffect(() => {
    const el = audio.current
    if (!el || !startNow) return
    el.play().then(
      () => setBlocked(false),
      () => setBlocked(true),
    )
  }, [startNow, key])

  const unblock = () => {
    void audio.current?.play().then(() => setBlocked(false))
  }
  return { blocked, unblock }
}

function QuizGame({ id }: { id: string }) {
  const me = useCurrentUser()
  const navigate = useNavigate()
  const { notify } = useCollection()
  const { game, receivedAt, error, ended } = useGame(id)
  const remaining = useRemaining(game?.remainingMs ?? 0, receivedAt)
  const clip = useClip(ended ? null : game)

  if (error || ended) {
    return (
      <div className="page">
        <div className="page-inner quiz">
          <Title />
          <div className="empty-state">
            <h2>{ended ? 'La partie est terminée' : error}</h2>
            <button className="pill-button" onClick={() => navigate('/quiz')}>
              Nouvelle partie
            </button>
          </div>
        </div>
      </div>
    )
  }
  if (!game) return <div className="page" />

  const isHost = game.host.id === me.id
  const run = (action: Promise<unknown>) => action.catch((err: Error) => notify(err.message))
  const leave = () => {
    void quiz.leave(id).catch(() => {})
    navigate('/quiz')
  }
  const ranking = [...game.players].sort((a, b) => b.score - a.score)
  const round = game.round

  return (
    <div className="page">
      <div className="page-inner quiz">
        <Title />
        <div className="quiz-bar">
          <span className="muted">
            Code <strong className="quiz-code">{game.id}</strong>
          </span>
          {game.phase !== 'lobby' && game.phase !== 'over' && (
            <span className="muted">
              Manche {game.index + 1} / {game.roundCount}
            </span>
          )}
          <button className="pill-button small outline" onClick={leave}>
            {isHost ? 'Terminer' : 'Quitter'}
          </button>
        </div>

        {game.phase === 'lobby' && (
          <Lobby game={game} isHost={isHost} onStart={() => void run(quiz.start(id))} />
        )}

        {game.phase === 'countdown' && <div className="quiz-countdown">{Math.ceil(remaining / 1000) || 'Go'}</div>}

        {(game.phase === 'question' || game.phase === 'reveal' || game.phase === 'over') && round && (
          <>
            {game.phase === 'question' && (
              <div className="quiz-timer" aria-label={`${Math.ceil(remaining / 1000)} secondes`}>
                <div style={{ width: `${(remaining / 20000) * 100}%` }} />
              </div>
            )}
            {clip.blocked && (
              <button className="pill-button" onClick={clip.unblock}>
                Activer le son
              </button>
            )}
            {round.track && (
              <div className="quiz-reveal">
                <Cover src={images.track(round.track)} size={96} />
                <div>
                  <strong>{round.track.title}</strong>
                  <span className="muted">{round.track.artistName}</span>
                  {round.mine !== null && (
                    <span className={round.mine === round.answer ? 'quiz-good' : 'quiz-bad'}>
                      {round.mine === round.answer
                        ? `+${round.results.find((r) => r.userId === me.id)?.points ?? 0} points`
                        : 'Raté'}
                    </span>
                  )}
                  {round.mine === null && <span className="quiz-bad">Pas de réponse</span>}
                </div>
              </div>
            )}
            {game.phase !== 'over' && (
              <div className="quiz-choices">
                {round.choices.map((c, i) => {
                  const pickers = round.results.filter((r) => r.choice === i).map((r) => game.players.find((p) => p.id === r.userId))
                  const state =
                    round.answer !== null ? (i === round.answer ? 'right' : round.mine === i ? 'wrong' : '') : round.mine === i ? 'picked' : ''
                  return (
                    <button
                      key={i}
                      className={`quiz-choice ${state}`}
                      disabled={round.mine !== null || game.phase !== 'question'}
                      onClick={() => void run(quiz.answer(id, game.index, i))}
                    >
                      <strong>{c.title}</strong>
                      <span>{c.artist}</span>
                      {pickers.length > 0 && (
                        <span className="quiz-pickers">
                          {pickers.map((p) => p && <PersonAvatar key={p.id} person={p} size={22} />)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
            {game.phase === 'question' && (
              <p className="muted">
                {round.answered.length} / {game.players.length} ont répondu
              </p>
            )}
          </>
        )}

        {game.phase === 'over' && (
          <div className="quiz-over">
            <h2>{ranking[0]?.id === me.id ? 'Tu as gagné 🏆' : `${ranking[0]?.displayName} gagne 🏆`}</h2>
            {isHost ? (
              <button className="pill-button" onClick={() => void run(quiz.start(id))}>
                Revanche
              </button>
            ) : (
              <p className="muted">L'hôte peut lancer une revanche</p>
            )}
          </div>
        )}

        {game.phase !== 'lobby' && (
          <ol className="quiz-scores">
            {ranking.map((p, i) => (
              <li key={p.id} className={p.id === me.id ? 'me' : undefined}>
                <span className="quiz-rank">{i + 1}</span>
                <PersonAvatar person={p} size={32} />
                <span className="quiz-name">{p.displayName}</span>
                <strong>{p.score}</strong>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

function Lobby({ game, isHost, onStart }: { game: QuizState; isHost: boolean; onStart: () => void }) {
  const { notify } = useCollection()
  const { data: friends } = useFetch(() => social.friends(), [])
  const [invited, setInvited] = useState<Set<string>>(new Set())
  const link = `${location.origin}/quiz/${game.id}`
  const inGame = new Set(game.players.map((p) => p.id))
  const invitable = friends?.friends.filter((f) => !inGame.has(f.id)) ?? []

  const invite = async (userId: string) => {
    setInvited((prev) => new Set([...prev, userId]))
    try {
      await quiz.invite(game.id, [userId])
    } catch (err) {
      notify((err as Error).message)
    }
  }

  return (
    <>
      <section>
        <h2 className="section-title">Joueurs</h2>
        <ul className="quiz-players">
          {game.players.map((p) => (
            <li key={p.id}>
              <PersonAvatar person={p} size={48} />
              <span>{p.displayName}</span>
            </li>
          ))}
        </ul>
      </section>
      <div className="quiz-actions">
        {isHost ? (
          <button className="pill-button" onClick={onStart}>
            Lancer la partie
          </button>
        ) : (
          <p className="muted">En attente de {game.host.displayName}…</p>
        )}
        <button
          className="pill-button outline"
          onClick={() => void navigator.clipboard.writeText(link).then(() => notify('Lien copié'))}
        >
          Copier le lien
        </button>
      </div>
      {invitable.length > 0 && (
        <section>
          <h2 className="section-title">Défier des amis</h2>
          <ul>
            {invitable.map((f) => (
              <li key={f.id} className="quiz-friend">
                <PersonAvatar person={f} size={36} />
                <span className="quiz-name">{f.displayName}</span>
                <button className="pill-button small outline" disabled={invited.has(f.id)} onClick={() => void invite(f.id)}>
                  {invited.has(f.id) ? 'Invité' : 'Inviter'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
