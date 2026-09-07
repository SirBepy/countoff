import { useRef, useState } from 'react'
import { beatAt, centreCol, doingAt, facingAt, focusAt, frontRow, occupantAt, standingAt } from '../lib/floor'
import { beatDuration, beatToTime } from '../lib/grid'
import { shapeCycle } from '../lib/moves'
import { beginGesture, endGesture, flash, placeFocusKey, placeMovement, setFocus, useStore } from '../lib/store'
import type { FloorSize, MoveShape, Person, Project } from '../lib/types'

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/** Centre of a cell as a percentage, so a puck sits in the middle of its square. */
const centre = (index: number, of: number) => `${((index + 0.5) / of) * 100}%`

/**
 * The dancer's disc, phase-locked to the beat once at mount rather than on every audio
 * tick: rewriting `animation-delay` sixty times a second restarts the figure sixty
 * times a second, which reads as a stutter. The block is the React key, so a new block
 * is a new mount and a fresh lock. Seeking inside one block therefore leaves the loop
 * where it was, which is invisible on a decorative figure, and is exactly why a turn is
 * derived per frame instead of being an animation.
 */
function ShapedDisc({
  person,
  shape,
  duration,
  delay,
}: {
  person: Person
  shape?: MoveShape
  /** One cycle in seconds. Zero for a held pose, which is a ring rather than motion. */
  duration: number
  delay: number
}) {
  const [locked] = useState(delay)
  const running = !!shape && duration > 0
  return (
    <span
      className={`disc${shape ? ` sh-${shape}` : ''}`}
      style={
        {
          background: person.colour,
          '--ring': person.colour,
          animationName: running ? `mv-${shape}` : undefined,
          animationDuration: running ? `${duration}s` : undefined,
          animationDelay: running ? `${locked}s` : undefined,
          animationIterationCount: running ? 'infinite' : undefined,
        } as React.CSSProperties
      }
    >
      {person.initials}
      <i className="nose" />
    </span>
  )
}

interface Props {
  project: Project
  /** Audio time the floor is showing; everything on it is derived from this. */
  time: number
  /** Read-only in rehearse, where a stray drag would edit the choreography mid-run. */
  editable?: boolean
  /** Off while aiming a drag, where a puck that will not hold still is a nuisance. */
  animate?: boolean
  /** Names the move under each puck. Off on the rehearse mini-map, where the stage is
   *  288-340px wide: the pill grows the puck enough to collide with the chair, and the
   *  move name is already the largest thing on that screen. */
  moveLabels?: boolean
  onPick?: (personId: string) => void
  onMenu?: (personId: string, x: number, y: number) => void
  onFocusMenu?: (x: number, y: number) => void
}

export default function FloorStage({
  project,
  time,
  editable = true,
  animate = true,
  moveLabels = true,
  onPick,
  onMenu,
  onFocusMenu,
}: Props) {
  const stage = useRef<HTMLDivElement>(null)
  const viewAs = useStore((s) => s.viewAs)
  const floor = project.floor
  const focus = project.focus
  const chair = focusAt(project, time)

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

  /** With no keyframes the chair is a fixed prop, so a drag just moves it. Once it has
   *  any, a drag says where it must be on the count under the playhead, which is the
   *  rule a puck drag already follows. */
  function moveChair(col: number, row: number, key: string) {
    if (focus.kind !== 'person') return
    if (!focus.keys?.length) return setFocus({ ...focus, col, row }, key)
    const here = beatAt(project, time)
    if (!here) return
    placeFocusKey(here.segment.id, here.beat, { col, row }, key)
  }

  /** Dragging a puck writes where that person must be on the count under the playhead. */
  function walkTo(personId: string, col: number, row: number, key: string) {
    const here = beatAt(project, time)
    if (!here) return
    if (chair && Math.round(chair.col) === col && Math.round(chair.row) === row) return
    // One person per cell: an occupied square refuses rather than stacking two pucks.
    if (occupantAt(project, time, { col, row }, personId)) return
    placeMovement(personId, here.segment.id, here.beat, { col, row }, undefined, key)
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

      {focus.kind === 'audience' || !chair ? (
        <div className="stage-audience">AUDIENCE</div>
      ) : (
        <div
          className="stage-focus"
          style={{ left: centre(chair.col, floor.cols), top: centre(chair.row, floor.rows) }}
          title={`${focus.name || 'Front'} - drag to move who everyone is dancing to`}
          onPointerDown={drag('focus', moveChair)}
          onContextMenu={(e) => {
            e.preventDefault()
            if (editable) onFocusMenu?.(e.clientX, e.clientY)
          }}
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
        // The others stay drawn when reading as one dancer, only dimmed: knowing who you
        // are lining up next to is most of what a spot on the floor means.
        const mine = viewAs === person.id
        const doing = animate ? doingAt(project, person.id, time) : null
        const move = doing?.move ?? null
        // A walk beats the figure - nobody body-rolls across the floor - but never the
        // facing, because which way they point is a state and not something they do.
        const shape = walking ? undefined : move?.shape
        const facing = animate ? facingAt(project, person.id, time) : null
        // Negative, so the figure starts where its block did rather than where the eye
        // arrived, the same trick the walk interpolation plays with `progress`.
        const delay = doing?.block ? beatToTime(doing.segment, doing.block.startBeat) - time : 0
        return (
          <div
            key={person.id}
            className={`puck${walking ? ' walking' : ''}${mine ? ' mine' : ''}${viewAs && !mine ? ' other' : ''}${
              facing?.away ? ' facing-away' : ''
            }`}
            style={{ left: centre(at.col, floor.cols), top: centre(at.row, floor.rows) }}
            title={`${person.name}${move ? ` is on ${move.name}` : ''} - drag to say where they are on this count`}
            onPointerDown={(e) => {
              onPick?.(person.id)
              drag(`walk-${person.id}`, (col, row, key) => walkTo(person.id, col, row, key))(e)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              onMenu?.(person.id, e.clientX, e.clientY)
            }}
          >
            <span className="turner" style={{ transform: `rotate(${facing?.deg ?? 0}deg)` }}>
              <ShapedDisc
                key={`${doing?.block?.id ?? ''}:${shape ?? ''}`}
                person={person}
                shape={shape}
                duration={shape && doing ? shapeCycle(shape, move!.beats) * beatDuration(doing.segment.bpm) : 0}
                delay={delay}
              />
            </span>
            <span className="nm">{person.name}</span>
            {moveLabels && move && !walking && (
              <span className="mvn" style={{ background: person.colour }}>
                {move.name}
              </span>
            )}
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
