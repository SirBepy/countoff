import { useState } from 'react'
import { audio, useAudio } from '../lib/audio'
import { beatToTime, formatTime, segmentAt, timeToBeat } from '../lib/grid'
import {
  entrances,
  formationAtTime,
  freeCell,
  initialsFrom,
  nextColour,
  onFloor,
  orderedFormations,
  waitingOff,
} from '../lib/floor'
import {
  addFormation,
  addPerson,
  clearSpot,
  flash,
  removeFormation,
  removePerson,
  set,
  setFocus,
  setSpot,
  uid,
  updateFormation,
  updatePerson,
  useStore,
} from '../lib/store'
import type { Formation, Project } from '../lib/types'
import CastTimeline from './CastTimeline'
import FloorStage, { DEFAULT_FOCUS_CELL } from './FloorStage'

/** Where a formation sits, said the way the sheet says it. */
function position(project: Project, formation: Formation) {
  const segment = project.segments.find((s) => s.id === formation.segmentId)
  if (!segment) return { song: 'Deleted song', bar: 0, count: 0 }
  return {
    song: segment.name,
    bar: Math.floor(formation.startBeat / segment.countsPerRow) + 1,
    count: (formation.startBeat % segment.countsPerRow) + 1,
  }
}

export default function Floor({ project }: { project: Project }) {
  const { time } = useAudio()
  const pickedId = useStore((s) => s.floorFormationId)
  const [tab, setTab] = useState<'floor' | 'timeline'>('floor')
  const [castOpen, setCastOpen] = useState(false)
  const [newName, setNewName] = useState('')

  const placed = orderedFormations(project)
  const selected =
    placed.find((p) => p.formation.id === pickedId)?.formation ?? formationAtTime(project, time) ?? placed[0]?.formation ?? null

  function pick(formation: Formation) {
    set({ floorFormationId: formation.id }, false)
    const segment = project.segments.find((s) => s.id === formation.segmentId)
    if (segment) audio.seek(beatToTime(segment, formation.startBeat))
  }

  /** Drops a formation at the playhead, carrying the previous one's positions forward. */
  function addHere() {
    const at = audio.el.currentTime
    const segment = segmentAt(project.segments, at)
    if (!segment) return flash('No song here to hang a formation on')
    const startBeat = Math.max(0, Math.round(timeToBeat(segment, at)))
    const clash = project.formations.find((f) => f.segmentId === segment.id && f.startBeat === startBeat)
    if (clash) {
      pick(clash)
      return flash('There is already a formation on this count')
    }
    const previous = formationAtTime(project, at)
    const id = uid()
    addFormation({
      id,
      segmentId: segment.id,
      startBeat,
      name: `Formation ${project.formations.length + 1}`,
      spots: previous ? previous.spots.map((s) => ({ ...s })) : [],
    })
    set({ floorFormationId: id }, false)
  }

  function addToCast() {
    const name = newName.trim()
    if (!name) return
    addPerson({ id: uid(), name, initials: initialsFrom(name), colour: nextColour(project.people) })
    setNewName('')
  }

  function walkOn(personId: string) {
    if (!selected) return
    const cell = freeCell(selected, project.focus.kind === 'person' ? project.focus : undefined)
    setSpot(selected.id, personId, cell.col, cell.row)
  }

  const nudge = (by: number) =>
    selected && updateFormation(selected.id, { startBeat: Math.max(0, selected.startBeat + by) })

  const here = selected ? position(project, selected) : null
  const walkingOn = selected ? entrances(project, selected) : { in: [], out: [] }

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
          <i className="ph ph-map-pin i" /> {project.formations.length} formations
        </span>
        <div className="spacer" />
        <div className="seg-toggle">
          <button className={tab === 'floor' ? 'on' : ''} onClick={() => setTab('floor')}>
            Floor
          </button>
          <button className={tab === 'timeline' ? 'on' : ''} onClick={() => setTab('timeline')}>
            Who is in when
          </button>
        </div>
        <button onClick={() => setCastOpen(true)} title="Add, rename, recolour or remove people">
          <i className="ph ph-user-list i" /> Cast
        </button>
        <button className="primary" onClick={addHere} title="Add a formation on the count at the playhead">
          <i className="ph ph-plus i" /> Formation here
        </button>
      </div>

      <div className="floor-rail">
        {placed.length === 0 && <span className="hint">Play to the count where the first shape happens, then hit "Formation here".</span>}
        {placed.map(({ formation, time: at }) => {
          const p = position(project, formation)
          return (
            <button
              key={formation.id}
              className={`f-chip${formation.id === selected?.id ? ' on' : ''}`}
              onClick={() => pick(formation)}
            >
              <span className="n">{formation.name}</span>
              <span className="t">
                {p.song} · bar {p.bar}.{p.count} · {formatTime(at)}
              </span>
              <span className="c">{formation.spots.length} on the floor</span>
            </button>
          )
        })}
      </div>

      <div className="floor-body">
        <div className="floor-main">
          {tab === 'timeline' ? (
            <CastTimeline project={project} />
          ) : selected ? (
            <FloorStage project={project} formation={selected} />
          ) : (
            <p className="hint">No formations yet. Nothing to stand on.</p>
          )}
        </div>

        {tab === 'floor' && selected && (
          <aside className="floor-side">
            <div className="field">
              <label>Formation name</label>
              <input
                value={selected.name}
                onChange={(e) => updateFormation(selected.id, { name: e.target.value }, `f-name-${selected.id}`)}
              />
            </div>

            <div className="field">
              <label>
                Starts at {here!.song} · bar {here!.bar}, count {here!.count}
              </label>
              <div className="nudge">
                <button onClick={() => nudge(-1)} title="One count earlier">
                  <i className="ph ph-minus i" />
                </button>
                <button onClick={() => nudge(1)} title="One count later">
                  <i className="ph ph-plus i" />
                </button>
                <button className="ghost" onClick={() => removeFormation(selected.id)} title="Delete this formation">
                  <i className="ph ph-trash i" /> Delete
                </button>
              </div>
            </div>

            <div className="lbl">On the floor · {onFloor(project, selected).length}</div>
            <div className="chips">
              {onFloor(project, selected).map((person) => (
                <span
                  key={person.id}
                  className={`p-chip${walkingOn.in.includes(person.id) ? ' entering' : ''}`}
                  title={walkingOn.in.includes(person.id) ? `${person.name} walks on here` : person.name}
                >
                  <span className="d" style={{ background: person.colour }}>
                    {person.initials}
                  </span>
                  {person.name}
                  <button className="x" onClick={() => clearSpot(selected.id, person.id)} title="Take off the floor">
                    <i className="ph ph-x" />
                  </button>
                </span>
              ))}
              {!onFloor(project, selected).length && <span className="hint">Empty floor.</span>}
            </div>

            <div className="lbl">Waiting off</div>
            <div className="chips">
              {waitingOff(project, selected).map((person) => (
                <button key={person.id} className="p-chip off" onClick={() => walkOn(person.id)} title="Bring on here">
                  <span className="d" style={{ background: person.colour }}>
                    {person.initials}
                  </span>
                  {person.name}
                  <i className="ph ph-plus" />
                </button>
              ))}
              {!project.people.length && <span className="hint">No cast yet. Add people first.</span>}
            </div>

            <div className="lbl">Everyone faces</div>
            <div className="focus-pick">
              <button
                className={project.focus.kind === 'audience' ? 'on' : ''}
                onClick={() => setFocus({ kind: 'audience' })}
              >
                <i className="ph ph-users i" /> A crowd
              </button>
              <button
                className={project.focus.kind === 'person' ? 'on' : ''}
                onClick={() => setFocus({ kind: 'person', name: '', ...(selected ? freeCell(selected) : DEFAULT_FOCUS_CELL) })}
              >
                <i className="ph ph-armchair i" /> One person
              </button>
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
          </aside>
        )}
      </div>

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
              <div className="field">
                <label>Add someone</label>
                <div className="row">
                  <input
                    autoFocus
                    style={{ flex: 1 }}
                    value={newName}
                    placeholder="Name"
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addToCast()}
                  />
                  <button className="primary" onClick={addToCast}>
                    <i className="ph ph-plus i" /> Add
                  </button>
                </div>
              </div>

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
                    title="Remove, and take them off every formation"
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
