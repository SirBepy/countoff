import { useState } from 'react'
import { audio, useAudio } from '../lib/audio'
import { formatTime } from '../lib/grid'
import { useMenuFit } from '../lib/menuFit'
import {
  FLOOR_MAX,
  FLOOR_MIN,
  WALK_MAX,
  beatAt,
  freeCell,
  initialsFrom,
  nextColour,
  standingAt,
} from '../lib/floor'
import {
  addPerson,
  flash,
  placeMovement,
  removeMovement,
  removePerson,
  set,
  setFloorSize,
  setFocus,
  setWalkCounts,
  uid,
  updatePerson,
} from '../lib/store'
import type { Project } from '../lib/types'
import FloorStage, { defaultFocusCell } from './FloorStage'
import MovementTimeline from './MovementTimeline'

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/** 1 fits the whole medley; the top end puts a couple of bars across the screen. */
const ZOOM_MAX = 60

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <span className="step">
      <button className="ghost icon" onClick={() => onChange(clamp(value - 1, min, max))} disabled={value <= min}>
        <i className="ph ph-minus" />
      </button>
      <b>{value}</b>
      <button className="ghost icon" onClick={() => onChange(clamp(value + 1, min, max))} disabled={value >= max}>
        <i className="ph ph-plus" />
      </button>
    </span>
  )
}

export default function Floor({ project }: { project: Project }) {
  const { time, playing } = useAudio()
  const [selected, setSelected] = useState<string | null>(null)
  const [castOpen, setCastOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [menu, setMenu] = useState<{ personId: string; x: number; y: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const { ref: menuEl, offset } = useMenuFit<HTMLDivElement>(menu?.personId)

  const here = beatAt(project, time)
  const floor = project.floor

  /** Every edit lands on the count under the playhead, which is the whole flow. */
  function walk(personId: string, to: { col: number; row: number } | null) {
    if (!here) return flash('No song here to stand on')
    placeMovement(personId, here.segment.id, here.beat, to)
    setSelected(personId)
  }

  function addToCast() {
    const name = newName.trim()
    if (!name) return
    addPerson({ id: uid(), name, initials: initialsFrom(name), colour: nextColour(project.people) })
    setNewName('')
  }

  /** The movement, if any, that lands exactly on the count under the playhead. */
  const stopHere = (personId: string) =>
    here &&
    project.movements.find((m) => m.personId === personId && m.segmentId === here.segment.id && m.beat === here.beat)

  const menuPerson = menu && project.people.find((p) => p.id === menu.personId)

  return (
    <div className="app floor-view">
      <div className="appbar">
        <button className="ghost icon" onClick={() => set({ view: 'sheet' }, false)} title="Back to the sheet">
          <i className="ph ph-caret-left i" />
        </button>
        <div className="brand">
          <span className="dot" /> Floor
        </div>
        <span className="chip only-wide">
          <i className="ph ph-users-three i" /> {project.people.length} in the cast
        </span>
        <span className="chip only-wide">
          <i className="ph ph-footprints i" /> {project.movements.length} movements
        </span>
        <div className="spacer" />
        <button className="ghost icon" onClick={() => setSetupOpen(true)} title="Floor size, walk length and who they face">
          <i className="ph ph-dots-three-vertical i" />
        </button>
        <button className="primary" onClick={() => set({ view: 'rehearse' }, false)} title="Watch it back full screen">
          <i className="ph ph-play i" /> Rehearse
        </button>
      </div>

      <div className="floor-body">
        <aside className="cast-rail">
          <div className="rail-head">
            <i className="ph ph-users-three" /> Cast
            <div className="spacer" />
            <button className="ghost icon" onClick={() => setCastOpen(true)} title="Rename, recolour or remove people">
              <i className="ph ph-pencil-simple" />
            </button>
          </div>

          {project.people.map((person) => {
            const at = standingAt(project, person.id, time)
            return (
              <div
                key={person.id}
                className={`rail-person${at ? '' : ' off'}${person.id === selected ? ' on' : ''}`}
                onClick={() => setSelected(person.id)}
              >
                <span className="disc" style={{ background: person.colour }}>
                  {person.initials}
                </span>
                <span className="nm">{person.name}</span>
                {at ? (
                  <>
                    <span className="st">{at.progress < 1 ? 'walking' : 'on'}</span>
                    <button className="ghost icon" onClick={() => walk(person.id, null)} title="Walk off on this count">
                      <i className="ph ph-sign-out" />
                    </button>
                  </>
                ) : (
                  <button
                    className="ghost icon"
                    onClick={() => walk(person.id, freeCell(project, time, person.id))}
                    title="Bring on for this count"
                  >
                    <i className="ph ph-plus" />
                  </button>
                )}
              </div>
            )
          })}

          <div className="rail-add">
            <input
              value={newName}
              placeholder="Add someone"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addToCast()}
            />
            <button className="ghost icon" onClick={addToCast} title="Add to the cast">
              <i className="ph ph-plus" />
            </button>
          </div>
        </aside>

        <div className="floor-stage-wrap">
          <div className="stage-where">
            {here ? (
              <>
                <i className="ph ph-metronome" /> <b>{here.segment.name}</b> · bar{' '}
                {Math.floor(here.beat / here.segment.countsPerRow) + 1}, count {(here.beat % here.segment.countsPerRow) + 1}
              </>
            ) : (
              <>
                <i className="ph ph-metronome" /> before the first song
              </>
            )}
          </div>
          <FloorStage
            project={project}
            time={time}
            onPick={setSelected}
            onMenu={(personId, x, y) => setMenu({ personId, x, y })}
          />
        </div>
      </div>

      <div className="floor-timeline">
        <div className="tl-head">
          <div className="transport">
            <button className="ghost icon" onClick={() => audio.nudge(-5)} title="Back 5 seconds">
              <i className="ph ph-skip-back" />
            </button>
            <button className="icon" onClick={() => audio.toggle()} title="Play or pause">
              <i className={`ph ${playing ? 'ph-pause' : 'ph-play'}`} />
            </button>
            <button className="ghost icon" onClick={() => audio.nudge(5)} title="On 5 seconds">
              <i className="ph ph-skip-forward" />
            </button>
            <span className="clock">{formatTime(time)}</span>
          </div>

          <span className="tl-field" title="How long a new walk takes, until that one is retimed">
            <span className="lbl">Walk</span>
            <Stepper value={project.walkCounts} min={0} max={WALK_MAX} onChange={setWalkCounts} />
            <span className="unit">counts</span>
          </span>

          <span className="tl-field" title="Zoom the timeline. Ctrl or Cmd and scroll does it too">
            <span className="lbl">Zoom</span>
            <span className="step">
              <button className="ghost icon" onClick={() => setZoom(clamp(zoom / 1.6, 1, ZOOM_MAX))} disabled={zoom <= 1}>
                <i className="ph ph-magnifying-glass-minus" />
              </button>
              <b>{zoom < 1.05 ? 'fit' : `${Math.round(zoom)}×`}</b>
              <button
                className="ghost icon"
                onClick={() => setZoom(clamp(zoom * 1.6, 1, ZOOM_MAX))}
                disabled={zoom >= ZOOM_MAX}
              >
                <i className="ph ph-magnifying-glass-plus" />
              </button>
            </span>
          </span>

          <div className="spacer" />
          <span className="hint only-wide">Click a walk to jump to where it lands, then drag them on the floor.</span>
        </div>
        <MovementTimeline
          project={project}
          time={time}
          playing={playing}
          zoom={zoom}
          onZoom={(z) => setZoom(clamp(z, 1, ZOOM_MAX))}
          selectedId={selected}
          onSelect={setSelected}
        />
      </div>

      {menu && menuPerson && (
        <>
          <div className="mv-menu-back" onPointerDown={() => setMenu(null)} />
          <div className="mv-menu" ref={menuEl} style={{ left: menu.x + offset.dx, top: menu.y + offset.dy }}>
            <div className="mh">{menuPerson.name}</div>
            <button
              className="mi"
              onClick={() => {
                walk(menu.personId, null)
                setMenu(null)
              }}
            >
              <i className="ph ph-sign-out" /> Walk off here
            </button>
            <button
              className="mi danger"
              disabled={!stopHere(menu.personId)}
              onClick={() => {
                const stop = stopHere(menu.personId)
                if (stop) removeMovement(stop.id)
                setMenu(null)
              }}
            >
              <i className="ph ph-trash" /> Drop this stop
            </button>
          </div>
        </>
      )}

      {setupOpen && (
        <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setSetupOpen(false)}>
          <div className="modal">
            <header>
              <i className="ph ph-grid-four i" />
              Floor
              <div className="spacer" />
              <button className="ghost icon" onClick={() => setSetupOpen(false)}>
                <i className="ph ph-x" />
              </button>
            </header>

            <div className="content">
              <div className="field">
                <label>How big the floor is</label>
                <div className="row">
                  <Stepper
                    value={floor.cols}
                    min={FLOOR_MIN}
                    max={FLOOR_MAX}
                    onChange={(cols) => setFloorSize({ ...floor, cols })}
                  />
                  <span className="faint">across</span>
                  <Stepper
                    value={floor.rows}
                    min={FLOOR_MIN}
                    max={FLOOR_MAX}
                    onChange={(rows) => setFloorSize({ ...floor, rows })}
                  />
                  <span className="faint">deep</span>
                </div>
              </div>

              <div className="field">
                <label>Everyone faces</label>
                <div className="focus-pick">
                  <button
                    className={project.focus.kind === 'audience' ? 'on' : ''}
                    onClick={() => setFocus({ kind: 'audience' })}
                  >
                    <i className="ph ph-users i" /> A crowd
                  </button>
                  <button
                    className={project.focus.kind === 'person' ? 'on' : ''}
                    onClick={() => setFocus({ kind: 'person', name: '', ...defaultFocusCell(floor) })}
                  >
                    <i className="ph ph-armchair i" /> One person
                  </button>
                </div>
              </div>

              {project.focus.kind === 'person' && (
                <div className="field">
                  <label>Who they are dancing to</label>
                  <input
                    value={project.focus.name}
                    placeholder="The bride"
                    onChange={(e) =>
                      project.focus.kind === 'person' && setFocus({ ...project.focus, name: e.target.value }, 'focus-name')
                    }
                  />
                </div>
              )}
            </div>

            <footer>
              <button className="primary" onClick={() => setSetupOpen(false)}>
                Done
              </button>
            </footer>
          </div>
        </div>
      )}

      {castOpen && (
        <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setCastOpen(false)}>
          <div className="modal">
            <header>
              <i className="ph ph-user-list i" />
              Cast
              <div className="spacer" />
              <button className="ghost icon" onClick={() => setCastOpen(false)}>
                <i className="ph ph-x" />
              </button>
            </header>

            <div className="content">
              {project.people.map((person) => (
                <div key={person.id} className="cast-row">
                  <input
                    className="ini"
                    value={person.initials}
                    maxLength={2}
                    style={{ background: person.colour }}
                    onChange={(e) => updatePerson(person.id, { initials: e.target.value.toUpperCase() }, `ini-${person.id}`)}
                  />
                  <input
                    value={person.name}
                    onChange={(e) => updatePerson(person.id, { name: e.target.value }, `name-${person.id}`)}
                  />
                  <input
                    type="color"
                    value={person.colour}
                    onChange={(e) => updatePerson(person.id, { colour: e.target.value }, `colour-${person.id}`)}
                  />
                  <button
                    className="ghost icon"
                    onClick={() => removePerson(person.id)}
                    title="Remove, and take their whole path with them"
                  >
                    <i className="ph ph-trash i" />
                  </button>
                </div>
              ))}
              {!project.people.length && <p className="hint">Nobody yet. Add the people who are dancing.</p>}
            </div>

            <footer>
              <button className="primary" onClick={() => setCastOpen(false)}>
                Done
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}
