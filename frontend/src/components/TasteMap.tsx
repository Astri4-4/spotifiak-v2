import { social, type Person } from '../api'
import { useCurrentUser } from '../auth/context'
import { useFetch } from '../hooks'

const SIZE = 320
const RADIUS = 120
const NODE = 22

/** Me in the middle, friends around; the thicker the line, the closer two tastes are. */
export function TasteMap() {
  const me = useCurrentUser()
  const { data } = useFetch(() => social.tasteMap(), [])
  if (!data || data.people.length < 2) return null
  const friends = data.people.filter((p) => p.id !== me.id)
  const position = new Map<string, { x: number; y: number }>([[me.id, { x: SIZE / 2, y: SIZE / 2 }]])
  friends.forEach((p, i) => {
    const angle = (2 * Math.PI * i) / friends.length - Math.PI / 2
    position.set(p.id, { x: SIZE / 2 + RADIUS * Math.cos(angle), y: SIZE / 2 + RADIUS * Math.sin(angle) })
  })
  const name = (p: Person) => (p.id === me.id ? 'Toi' : p.displayName)
  const person = new Map(data.people.map((p) => [p.id, p]))
  const mine = data.links.filter((l) => l.a === me.id || l.b === me.id).sort((x, y) => y.similarity - x.similarity)

  return (
    <section className="scan-card">
      <h2 className="settings-title">Carte des goûts</h2>
      <div className="taste-map">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          {data.links.map((l) => {
            const a = position.get(l.a)!
            const b = position.get(l.b)!
            return (
              <line
                key={`${l.a}-${l.b}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className="taste-link"
                strokeWidth={1 + l.similarity * 10}
                strokeOpacity={0.15 + l.similarity * 0.85}
              />
            )
          })}
          {data.people.map((p) => {
            const { x, y } = position.get(p.id)!
            return (
              <g key={p.id} className={p.id === me.id ? 'taste-node me' : 'taste-node'}>
                <circle cx={x} cy={y} r={NODE} />
                <text x={x} y={y} dy="0.35em" textAnchor="middle">
                  {name(p).slice(0, 2).toUpperCase()}
                </text>
                <text x={x} y={y + NODE + 14} textAnchor="middle" className="taste-name">
                  {name(p)}
                </text>
              </g>
            )
          })}
        </svg>
        <ul className="taste-list">
          {mine.map((l) => {
            const friend = person.get(l.a === me.id ? l.b : l.a)!
            return (
              <li key={friend.id}>
                <strong>
                  {friend.displayName} : {Math.round(l.similarity * 100)} %
                </strong>
                {l.artists.length > 0 && <span className="muted"> — {l.artists.join(', ')}</span>}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
