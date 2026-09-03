import { useRef } from 'react'
import { CENTRE_COL, FLOOR_COLS, FLOOR_ROWS, FRONT_ROW, entrances, spotFor } from '../lib/floor'
import { beginGesture, endGesture, setFocus, setSpot } from '../lib/store'
import type { Formation, Project } from '../lib/types'

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/** Centre of a cell as a percentage, so a puck sits in the middle of its square. */
const centre = (index: number, of: number) => `${((index + 0.5) / of) * 100}%`

interface Props {
  project: Project
  formation: Formation
  /** Read-only on the timeline's preview, where dragging would edit the wrong formation. */
  editable?: boolean
}

export default function FloorStage({ project, formation, editable = true }: Props) {
  const stage = useRef<HTMLDivElement>(null)
  const { in: walkingOn } = entrances(project, formation)
  const focus = project.focus

  function cellAt(clientX: number, clientY: number) {
    const rect = stage.current!.getBoundingClientRect()
    return {
      col: clamp(Math.floor(((clientX - rect.left) / rect.width) * FLOOR_COLS), 0, FLOOR_COLS - 1),
      row: clamp(Math.floor(((clientY - rect.top) / rect.height) * FLOOR_ROWS), 0, FLOOR_ROWS - 1),
    }
  }

  /** One gesture is one undo step, however many cells the pointer crosses on the way. */
  function drag(gestureKey: string, apply: (col: number, row: number, key: string) => void) {
    return (e: React.PointerEvent) => {
      if (!editable || e.button === 2) return
      e.preventDefault()
      e.stopPropagation()
      beginGesture(gestureKey)
      const move = (ev: PointerEvent) => {
        const { col, row } = cellAt(ev.clientX, ev.clientY)
        apply(col, row, gestureKey)
      }
      const stop = () => {
        endGesture()
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', stop)
        window.removeEventListener('pointercancel', stop)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', stop)
      window.addEventListener('pointercancel', stop)
    }
  }

  return (
    <div ref={stage} className={`stage${editable ? '' : ' static'}`}>
      <div className="stage-grid" style={{ '--cols': FLOOR_COLS, '--rows': FLOOR_ROWS } as React.CSSProperties}>
        {Array.from({ length: FLOOR_COLS * FLOOR_ROWS }, (_, i) => (
          <span key={i} />
        ))}
      </div>

      {focus.kind === 'audience' ? (
        <div className="stage-audience">AUDIENCE</div>
      ) : (
        <div
          className="stage-focus"
          style={{ left: centre(focus.col, FLOOR_COLS), top: centre(focus.row, FLOOR_ROWS) }}
          title={`${focus.name || 'Front'} - drag to move who everyone is dancing to`}
          onPointerDown={drag('focus', (col, row, key) => setFocus({ ...focus, col, row }, key))}
        >
          <i className="ph ph-armchair" />
          <span>{focus.name || 'Front'}</span>
        </div>
      )}

      {project.people.map((person) => {
        const spot = spotFor(formation, person.id)
        if (!spot) return null
        return (
          <div
            key={person.id}
            className={`puck${walkingOn.includes(person.id) ? ' entering' : ''}`}
            style={{ left: centre(spot.col, FLOOR_COLS), top: centre(spot.row, FLOOR_ROWS) }}
            title={`${person.name} - drag to move. Dropping on someone swaps the two.`}
            onPointerDown={drag(`spot-${formation.id}-${person.id}`, (col, row, key) =>
              setSpot(formation.id, person.id, col, row, key),
            )}
          >
            <span className="disc" style={{ background: person.colour }}>
              {person.initials}
            </span>
            <span className="nm">{person.name}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Where a chair goes when the focus first switches to one person: front and centre. */
export const DEFAULT_FOCUS_CELL = { col: CENTRE_COL, row: FRONT_ROW }
