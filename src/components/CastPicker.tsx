import { useState } from 'react'
import { inTag, isFor, taggedPeople } from '../lib/cast'
import { addGroup, uid } from '../lib/store'
import type { Project } from '../lib/types'

interface Props {
  project: Project
  title: string
  /** What is being tagged, for the subtitle: "Running man, counts 1 to 8". */
  subject: string
  value: string[]
  onSave: (ids: string[]) => void
  onClose: () => void
  /** Counts this placement covers, so the picker can say who keeps the default instead. */
  overlapping?: { for?: string[] }[]
}

/**
 * Names who a block or a clip is for. Picking nobody means everyone, which is the same
 * thing an untagged placement has always said.
 */
export default function CastPicker({ project, title, subject, value, onSave, onClose, overlapping = [] }: Props) {
  const [picked, setPicked] = useState<string[]>(value)
  const [naming, setNaming] = useState(false)
  const [groupName, setGroupName] = useState('')

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const chosen = taggedPeople(project, { for: picked })

  // The people this override would leave on the default, which is the blacklist nobody
  // has to maintain: it falls out of the pick rather than being typed alongside it.
  // Someone with their own move over these counts is not one of them, and neither is
  // anyone when there is no default here to fall back to.
  const keepingDefault = project.people.filter(
    (p) =>
      !chosen.some((c) => c.id === p.id) &&
      overlapping.some((o) => !o.for?.length) &&
      !overlapping.some((o) => o.for?.length && isFor(project, o, p.id)),
  )

  function saveGroup() {
    const name = groupName.trim()
    if (!name || chosen.length === 0) return
    const id = uid()
    addGroup({ id, name, members: chosen.map((p) => p.id) })
    setPicked([id])
    setGroupName('')
    setNaming(false)
  }

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal cast-picker">
        <header>
          <i className="ph ph-users-three i" />
          {title}
          <div className="spacer" />
          <button className="ghost icon" onClick={onClose}>
            <i className="ph ph-x" />
          </button>
        </header>

        <div className="content">
          <div className="faint" style={{ fontSize: 12, marginTop: -4 }}>
            {subject}
          </div>

          <button className={`cast-opt${picked.length === 0 ? ' on' : ''}`} onClick={() => setPicked([])}>
            <span className="box">{picked.length === 0 && <i className="ph ph-check" />}</span>
            <i className="ph ph-users-three i" />
            <span className="nm">Everyone</span>
            <span className="faint">default</span>
          </button>

          {project.groups.length > 0 && (
            <>
              <div className="cast-sep">Groups</div>
              {project.groups.map((g) => (
                <button key={g.id} className={`cast-opt${picked.includes(g.id) ? ' on' : ''}`} onClick={() => toggle(g.id)}>
                  <span className="box">{picked.includes(g.id) && <i className="ph ph-check" />}</span>
                  <i className="ph ph-user-circle-gear i" />
                  <span className="nm">{g.name}</span>
                  <span className="faint">{g.members.length}</span>
                </button>
              ))}
            </>
          )}

          <div className="cast-sep">Dancers</div>
          {project.people.length === 0 && <div className="hint">Add the cast on the floor first.</div>}
          {project.people.map((p) => {
            const viaGroup = picked.find((t) => t !== p.id && inTag(project, t, p.id))
            return (
              <button key={p.id} className={`cast-opt${picked.includes(p.id) ? ' on' : ''}`} onClick={() => toggle(p.id)}>
                <span className="box">{(picked.includes(p.id) || viaGroup) && <i className="ph ph-check" />}</span>
                <span className="d" style={{ background: p.colour }}>
                  {p.initials}
                </span>
                <span className="nm">{p.name}</span>
                {viaGroup && (
                  <span className="faint">via {project.groups.find((g) => g.id === viaGroup)?.name ?? 'a group'}</span>
                )}
              </button>
            )
          })}

          {keepingDefault.length > 0 && (
            <div className="cast-derived">
              <i className="ph ph-magic-wand i" />
              {keepingDefault.length === 1
                ? `${keepingDefault[0].name} keeps the default on these counts.`
                : `The other ${keepingDefault.length} keep the default on these counts.`}{' '}
              Nothing to exclude by hand.
            </div>
          )}

          {/* Only worth offering once the pick names people directly: a pick that is
              already one group would just save that same group again. */}
          {chosen.length > 1 &&
            picked.some((id) => project.people.some((p) => p.id === id)) &&
            (naming ? (
              <div className="row" style={{ gap: 6 }}>
                <input
                  autoFocus
                  value={groupName}
                  placeholder="e.g. Bridesmaids"
                  onChange={(e) => setGroupName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveGroup()}
                />
                <button className="primary" onClick={saveGroup}>
                  Save group
                </button>
              </div>
            ) : (
              <button className="ghost" onClick={() => setNaming(true)}>
                <i className="ph ph-bookmark-simple i" /> Save these {chosen.length} as a group
              </button>
            ))}
        </div>

        <footer>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => onSave(picked)}>
            {picked.length === 0 ? 'Everyone does this' : `Only these ${chosen.length}`}
          </button>
        </footer>
      </div>
    </div>
  )
}
