import { useEffect, useRef, useState } from 'react'
import { setViewAs, useStore } from '../lib/store'
import type { Project } from '../lib/types'

/**
 * Who the app is being read as. Deliberately loud when a dancer is picked: reading one
 * person's sheet while believing it is everybody's is the one mistake here that teaches
 * the wrong moves, so the chip carries their colour and never blends into the bar.
 */
export default function ViewAs({ project, compact = false }: { project: Project; compact?: boolean }) {
  const viewAs = useStore((s) => s.viewAs)
  const [open, setOpen] = useState(false)
  const el = useRef<HTMLDivElement>(null)
  const me = project.people.find((p) => p.id === viewAs) ?? null

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !el.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Nobody to be. The control would offer one option that changes nothing.
  if (project.people.length === 0) return null

  return (
    <div className="view-as-anchor" ref={el}>
      <button
        className={`view-as${me ? ' on' : ''}`}
        onClick={() => setOpen(!open)}
        title={me ? `Reading as ${me.name}. Switch dancer, or go back to everyone.` : 'Read the sheet as one dancer'}
      >
        {me ? (
          <span className="d" style={{ background: me.colour }}>
            {me.initials}
          </span>
        ) : (
          <span className="d all">
            <i className="ph ph-users-three" />
          </span>
        )}
        {!compact && <span className="nm">{me ? me.name : 'Everyone'}</span>}
        <i className="ph ph-caret-down" />
      </button>

      {open && (
        <div className="view-as-menu">
          <div className="view-as-head">Viewing as</div>
          <button
            className={`cast-opt${me ? '' : ' on'}`}
            onClick={() => {
              setViewAs(null)
              setOpen(false)
            }}
          >
            <i className="ph ph-users-three i" />
            <span className="nm">Everyone</span>
            <span className="faint">the whole plan</span>
          </button>
          {project.people.map((p) => (
            <button
              key={p.id}
              className={`cast-opt${viewAs === p.id ? ' on' : ''}`}
              onClick={() => {
                setViewAs(p.id)
                setOpen(false)
              }}
            >
              <span className="d" style={{ background: p.colour }}>
                {p.initials}
              </span>
              <span className="nm">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Offered once to someone opening a shared link who has never said who they are. */
export function WhoAreYou({ project }: { project: Project }) {
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setViewAs(null)}>
      <div className="modal cast-picker">
        <header>
          <i className="ph ph-hand-waving i" />
          Who are you?
        </header>
        <div className="content">
          <div className="faint" style={{ fontSize: 12, marginTop: -4 }}>
            So the sheet can show your moves and your spot. You can change this any time.
          </div>
          {project.people.map((p) => (
            <button key={p.id} className="cast-opt" onClick={() => setViewAs(p.id)}>
              <span className="d" style={{ background: p.colour }}>
                {p.initials}
              </span>
              <span className="nm">{p.name}</span>
            </button>
          ))}
          <div className="cast-sep">Or not on the floor at all</div>
          <button className="cast-opt" onClick={() => setViewAs(null)}>
            <i className="ph ph-users-three i" />
            <span className="nm">I am just watching</span>
          </button>
        </div>
      </div>
    </div>
  )
}
