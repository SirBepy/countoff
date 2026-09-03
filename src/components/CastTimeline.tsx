import { audio } from '../lib/audio'
import { formatTime, segmentEnd } from '../lib/grid'
import { orderedFormations, stints } from '../lib/floor'
import { set } from '../lib/store'
import type { Project } from '../lib/types'

interface Props {
  project: Project
}

/** Who is on the floor across the whole track, read straight off the formations.
 *  Not editable: the only way to change it is to change a formation. */
export default function CastTimeline({ project }: Props) {
  const duration = project.duration || 1
  const pct = (t: number) => `${(t / duration) * 100}%`
  const placed = orderedFormations(project)

  if (!project.people.length) return <p className="hint">Add the cast first and this fills itself in.</p>
  if (!placed.length) return <p className="hint">No formations yet, so nobody is on the floor.</p>

  return (
    <div className="cast-timeline">
      <div className="tl-songs">
        {project.segments.map((seg, i) => {
          const end = segmentEnd(project.segments, i, duration)
          return (
            <span key={seg.id} style={{ left: pct(seg.start), width: pct(end - seg.start) }}>
              {seg.name}
            </span>
          )
        })}
      </div>

      {project.people.map((person) => {
        const runs = stints(project, person.id)
        const total = runs.reduce((n, r) => n + (r.to - r.from), 0)
        return (
          <div key={person.id} className="tl-row">
            <div className="tl-who">
              <span className="d" style={{ background: person.colour }}>
                {person.initials}
              </span>
              <span className="tl-name">{person.name}</span>
            </div>
            <div className="tl-track" title={`${person.name} dances for ${formatTime(total)}`}>
              {project.segments.slice(1).map((seg) => (
                <i key={seg.id} className="tl-cut" style={{ left: pct(seg.start) }} />
              ))}
              {runs.map((run, i) => (
                <span
                  key={i}
                  className="tl-bar"
                  style={{ left: pct(run.from), width: pct(run.to - run.from), background: person.colour }}
                />
              ))}
              {placed.map(({ formation, time }) => (
                <button
                  key={formation.id}
                  className="tl-mark"
                  style={{ left: pct(time) }}
                  title={`${formation.name} at ${formatTime(time)}`}
                  onClick={() => {
                    set({ floorFormationId: formation.id, view: 'floor' }, false)
                    audio.seek(time)
                  }}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
