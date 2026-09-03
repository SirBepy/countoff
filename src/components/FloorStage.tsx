import { useRef } from 'react'
import { beatAt, centreCol, frontRow, occupantAt, standingAt } from '../lib/floor'
import { beginGesture, endGesture, flash, placeMovement, setFocus } from '../lib/store'
import type { FloorSize, Project } from '../lib/types'

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/** Centre of a cell as a percentage, so a puck sits in the middle of its square. */
const centre = (index: number, of: number) => `${((index + 0.5) / of) * 100}%`

interface Props {
  project: Project
  /** Audio time the floor is showing; everything on it is derived from this. */
  time: number
  /** Read-only in rehearse, where a stray drag would edit the choreography mid-run. */
  editable?: boolean
  onPick?: (personId: string) => void
  onMenu?: (personId: string, x: number, y: number) => void
}

export default function FloorStage({ project, time, editable = true, onPick, onMenu }: Props) {
  const stage = useRef<HTMLDivElement>(null)
  const floor = project.floor
  const focus = project.focus

  function cellAt(clientX: number, clientY: number) {
    const rect = stage.current!.getBoundingClientRect()
    return {
      col: clamp(Math.floor(((clientX - rect.left) / rect.width) * floor.cols), 0, floor.cols - 1),
      row: clamp(Math.floor(((clientY - rect.top) / rect.height) * floor.rows), 0, floor.rows - 1),
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

  /** Dragging a puck writes where that person must be on the count under the playhead. */
  function walkTo(personId: string, col: number, row: number, key: string) {
    const here = beatAt(project, time)
    if (!here) return
    if (focus.kind === 'person' && focus.col === col && focus.row === row) return
    // One person per cell: an occupied square refuses rather than stacking two pucks.
    if (occupantAt(project, time, { col, row }, personId)) return
    placeMovement(personId, here.segment.id, here.beat, { col, row }, key)
  }

  return (
    <div
      ref={stage}
      className={`stage${editable ? '' : ' static'}`}
      style={{ aspectRatio: `${floor.cols} / ${floor.rows}` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="stage-grid" style={{ '--cols': floor.cols, '--rows': floor.rows } as React.CSSProperties}>
        {Array.from({ length: floor.cols * floor.rows }, (_, i) => (
          <span key={i} />
        ))}
      </div>

      {focus.kind === 'audience' ? (
        <div className="stage-audience">AUDIENCE</div>
      ) : (
        <div
          className="stage-focus"
          style={{ left: centre(focus.col, floor.cols), top: centre(focus.row, floor.rows) }}
          title={`${focus.name || 'Front'} - drag to move who everyone is dancing to`}
          onPointerDown={drag('focus', (col, row, key) => setFocus({ ...focus, col, row }, key))}
        >
          <i className="ph ph-armchair" />
          <span>{focus.name || 'Front'}</span>
        </div>
      )}

      <svg className="stage-trails" viewBox={`0 0 ${floor.cols} ${floor.rows}`} preserveAspectRatio="none">
        {project.people.map((person) => {
          const at = standingAt(project, person.id, time)
          if (!at?.from) return null
          return (
            <line
              key={person.id}
              x1={at.from.col + 0.5}
              y1={at.from.row + 0.5}
              x2={at.col + 0.5}
              y2={at.row + 0.5}
              stroke={person.colour}
              strokeWidth={0.06}
              strokeDasharray="0.2 0.2"
            />
          )
        })}
      </svg>

      {project.people.map((person) => {
        const at = standingAt(project, person.id, time)
        if (!at) return null
        const walking = at.progress < 1
        return (
          <div
            key={person.id}
            className={`puck${walking ? ' walking' : ''}`}
            style={{ left: centre(at.col, floor.cols), top: centre(at.row, floor.rows) }}
            title={`${person.name} - drag to say where they are on this count`}
            onPointerDown={(e) => {
              onPick?.(person.id)
              drag(`walk-${person.id}`, (col, row, key) => walkTo(person.id, col, row, key))(e)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              onMenu?.(person.id, e.clientX, e.clientY)
            }}
          >
            <span className="disc" style={{ background: person.colour }}>
              {person.initials}
            </span>
            <span className="nm">{person.name}</span>
          </div>
        )
      })}

      {editable && !beatAt(project, time) && (
        <div className="stage-empty" onPointerDown={() => flash('No song here to stand on')}>
          Nothing to stand on before the first song
        </div>
      )}
    </div>
  )
}

/** Where a chair goes when the focus first switches to one person: front and centre. */
export const defaultFocusCell = (floor: FloorSize) => ({ col: centreCol(floor), row: frontRow(floor) })
