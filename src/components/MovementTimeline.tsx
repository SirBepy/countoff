import { useEffect, useRef, useState } from 'react'
import { audio } from '../lib/audio'
import { beatAt, movementLabel, orderedMovements, stints } from '../lib/floor'
import { beatDuration, formatTime, segmentEnd } from '../lib/grid'
import { useMenuFit } from '../lib/menuFit'
import { beginGesture, endGesture, removeMovement, updateMovement } from '../lib/store'
import type { Movement, Project } from '../lib/types'

interface Props {
  project: Project
  time: number
  playing: boolean
  /** 1 fits the whole track; higher scrolls a wider one under the same lanes. */
  zoom: number
  onZoom: (zoom: number) => void
  selectedId: string | null
  onSelect: (personId: string | null) => void
}

interface MenuAt {
  movement: Movement
  x: number
  y: number
}

/** A drag under this many pixels is a click, so tapping a block seeks instead of retiming it. */
const DRAG_SLOP = 4
/** Keeps the playhead this far off the edge before a follow scroll fires. */
const FOLLOW_EDGE = 80

export default function MovementTimeline({ project, time, playing, zoom, onZoom, selectedId, onSelect }: Props) {
  const duration = project.duration || 1
  const scroll = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<MenuAt | null>(null)
  const { ref: menuEl, offset } = useMenuFit<HTMLDivElement>(menu?.movement.id)
  const pct = (t: number) => `${(t / duration) * 100}%`
  const here = beatAt(project, time)

  /** Time under a client x, measured against the track column rather than the whole lane. */
  function timeAt(clientX: number) {
    const track = scroll.current!.querySelector('.mv-track')!.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - track.left) / track.width) * duration))
  }

  // Zoomed in, the playhead walks off the right edge within seconds; follow it while
  // playing only, or a scrub would fight the scroll it just caused.
  useEffect(() => {
    const box = scroll.current
    const track = box?.querySelector('.mv-track') as HTMLElement | null
    if (!box || !track || !playing) return
    const x = track.offsetLeft + track.offsetWidth * (time / duration)
    if (x < box.scrollLeft + FOLLOW_EDGE || x > box.scrollLeft + box.clientWidth - FOLLOW_EDGE) {
      box.scrollLeft = x - box.clientWidth / 2
    }
  }, [time, duration, playing, zoom])

  function scrub(e: React.PointerEvent) {
    if (e.button === 2) return
    setMenu(null)
    audio.seek(timeAt(e.clientX))
    const move = (ev: PointerEvent) => audio.seek(timeAt(ev.clientX))
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  /**
   * Drags a walk along the track, re-homing it on whichever song it lands in. A click
   * that never moves seeks to where the walk lands, which is where you edit it from.
   */
  function dragBlock(movement: Movement, arrive: number, e: React.PointerEvent) {
    if (e.button === 2) return
    e.stopPropagation()
    setMenu(null)
    onSelect(movement.personId)
    const startX = e.clientX
    const key = `mv-${movement.id}`
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < DRAG_SLOP) return
      if (!moved) beginGesture(key)
      moved = true
      const at = beatAt(project, arrive + (timeAt(ev.clientX) - timeAt(startX)))
      if (at) updateMovement(movement.id, { segmentId: at.segment.id, beat: at.beat }, key)
    }
    const stop = () => {
      if (!moved) audio.seek(arrive)
      endGesture()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const perRow = project.segments[0]?.countsPerRow ?? 8
  const presets = [
    { label: 'Instant', counts: 0 },
    { label: 'Half bar', counts: Math.round(perRow / 2) },
    { label: 'One bar', counts: perRow },
    { label: 'Two bars', counts: perRow * 2 },
  ]
  const menuPerson = menu && project.people.find((p) => p.id === menu.movement.personId)

  return (
    <div
      className="mv"
      onContextMenu={(e) => e.preventDefault()}
      onWheel={(e) => {
        if (!e.ctrlKey && !e.metaKey) return
        e.preventDefault()
        onZoom(zoom * (e.deltaY < 0 ? 1.25 : 0.8))
      }}
    >
      <div className="mv-scroll" ref={scroll}>
        <div className="mv-inner" style={{ width: `calc(var(--who) + (100% - var(--who)) * ${zoom})` }}>
          <div className="mv-lane mv-ruler">
            <div className="mv-who" />
            <div className="mv-track" onPointerDown={scrub}>
              {project.segments.map((seg, i) => {
                const end = segmentEnd(project.segments, i, duration)
                const bar = beatDuration(seg.bpm) * seg.countsPerRow
                const bars = Math.floor((end - seg.anchor) / bar)
                const step = Math.max(1, Math.ceil(bars / (12 * zoom)))
                return (
                  <span key={seg.id} className="mv-seg" style={{ left: pct(seg.start), width: pct(end - seg.start) }}>
                    <b>{seg.name}</b>
                    {Array.from({ length: Math.floor(bars / step) }, (_, n) => {
                      const at = seg.anchor + (n + 1) * step * bar
                      return (
                        <i key={n} className="mv-bar" style={{ left: `${((at - seg.start) / (end - seg.start)) * 100}%` }}>
                          {(n + 1) * step + 1}
                        </i>
                      )
                    })}
                  </span>
                )
              })}
            </div>
          </div>

          {project.people.map((person) => {
            const placed = orderedMovements(project, person.id)
            return (
              <div
                key={person.id}
                className={`mv-lane${person.id === selectedId ? ' on' : ''}`}
                onPointerDown={() => onSelect(person.id)}
              >
                <div className="mv-who">
                  <span className="disc" style={{ background: person.colour }}>
                    {person.initials}
                  </span>
                  <span className="nm">{person.name}</span>
                </div>
                <div className="mv-track" onPointerDown={scrub}>
                  {stints(project, person.id).map((run, i) => (
                    <span
                      key={i}
                      className="mv-hold"
                      style={{ left: pct(run.from), width: pct(run.to - run.from), background: person.colour }}
                    />
                  ))}
                  {placed.map(({ movement, arrive, depart }) => {
                    // The one a drag on the floor would edit, so it is worth outlining.
                    const live = here?.segment.id === movement.segmentId && here?.beat === movement.beat
                    return (
                      <span
                        key={movement.id}
                        className={`mv-walk${movement.to ? '' : ' exit'}${movement.travel === 0 ? ' snap' : ''}${live ? ' live' : ''}`}
                        style={{ left: pct(depart), width: pct(arrive - depart), background: person.colour }}
                        title={`${person.name} is at ${movementLabel(movement)} on ${formatTime(arrive)}. Click to go there, right-click to time it.`}
                        onPointerDown={(e) => dragBlock(movement, arrive, e)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          onSelect(person.id)
                          setMenu({ movement, x: e.clientX, y: e.clientY })
                        }}
                      >
                        <b>{movementLabel(movement)}</b>
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {!project.people.length && <p className="hint">Add someone to the cast and their lane appears here.</p>}

          <div className="mv-playhead" style={{ left: `calc(var(--who) + (100% - var(--who)) * ${time / duration})` }} />
        </div>
      </div>

      {menu && menuPerson && (
        <>
          <div className="mv-menu-back" onPointerDown={() => setMenu(null)} onContextMenu={() => setMenu(null)} />
          <div className="mv-menu" ref={menuEl} style={{ left: menu.x + offset.dx, top: menu.y + offset.dy }}>
            <div className="mh">{menuPerson.name} · walk into place</div>
            {presets.map((preset) => (
              <button
                key={preset.label}
                className={`mi${menu.movement.travel === preset.counts ? ' on' : ''}`}
                onClick={() => {
                  updateMovement(menu.movement.id, { travel: preset.counts })
                  setMenu(null)
                }}
              >
                <i className={`ph ${menu.movement.travel === preset.counts ? 'ph-check' : 'ph-arrow-right'}`} />
                {preset.label}
                <span className="k">{preset.counts}</span>
              </button>
            ))}
            <label className="mi custom">
              <i className="ph ph-pencil-simple" />
              Counts
              <input
                type="number"
                min={0}
                value={menu.movement.travel}
                onChange={(e) => {
                  const travel = Math.max(0, Math.round(Number(e.target.value) || 0))
                  updateMovement(menu.movement.id, { travel }, `travel-${menu.movement.id}`)
                  setMenu({ ...menu, movement: { ...menu.movement, travel } })
                }}
              />
            </label>
            <hr />
            <label className="mi custom">
              <i className="ph ph-note" />
              Note
              <input
                value={menu.movement.note ?? ''}
                placeholder="turn"
                onChange={(e) => {
                  updateMovement(menu.movement.id, { note: e.target.value }, `note-${menu.movement.id}`)
                  setMenu({ ...menu, movement: { ...menu.movement, note: e.target.value } })
                }}
              />
            </label>
            {menu.movement.to && (
              <button
                className="mi"
                onClick={() => {
                  updateMovement(menu.movement.id, { to: null })
                  setMenu(null)
                }}
              >
                <i className="ph ph-sign-out" />
                Walk off here
              </button>
            )}
            <button
              className="mi danger"
              onClick={() => {
                removeMovement(menu.movement.id)
                setMenu(null)
              }}
            >
              <i className="ph ph-trash" />
              Delete movement
            </button>
          </div>
        </>
      )}
    </div>
  )
}
