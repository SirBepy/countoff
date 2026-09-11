import { SIDE_META, SIDES } from '../lib/floor'
import { removePerson, updatePerson } from '../lib/store'
import type { Project, Side } from '../lib/types'

interface Props {
  project: Project
  onClose: () => void
}

/** Per-person initials, name, colour, default side, delete. Gated on `castOpen` in Floor. */
export default function CastModal({ project, onClose }: Props) {
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header>
          <i className="ph ph-user-list i" />
          Cast
          <div className="spacer" />
          <button className="ghost icon" onClick={onClose}>
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
              <select
                value={person.side ?? ''}
                title="Their default wing, until one entrance or exit overrides it"
                onChange={(e) =>
                  updatePerson(person.id, { side: (e.target.value || undefined) as Side | undefined }, `side-${person.id}`)
                }
              >
                <option value="">Auto</option>
                {SIDES.map((side) => (
                  <option key={side} value={side}>
                    {SIDE_META[side].label}
                  </option>
                ))}
              </select>
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
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}
