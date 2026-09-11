import { FLOOR_MAX, FLOOR_MIN } from '../lib/floor'
import { setFloorSize, setFocus } from '../lib/store'
import type { Project } from '../lib/types'
import { defaultFocusCell } from './FloorStage'
import { Stepper } from './Floor'

interface Props {
  project: Project
  onClose: () => void
}

/** Floor size, who the dancers face, and the chair's name. Gated on `setupOpen` in Floor. */
export default function FloorSetupModal({ project, onClose }: Props) {
  const floor = project.floor
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header>
          <i className="ph ph-grid-four i" />
          Floor
          <div className="spacer" />
          <button className="ghost icon" onClick={onClose}>
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
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}
