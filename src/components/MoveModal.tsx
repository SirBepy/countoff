import { useEffect, useState } from 'react'
import { fillSelection } from '../lib/arrange'
import { MOVE_SHAPES, MOVE_TURNS, SHAPE_META, turnKeepsFacing } from '../lib/moves'
import { flash, getState, removeMove, set, upsertMove } from '../lib/store'
import type { Move, MoveShape, MoveTurn, Project } from '../lib/types'

const BEAT_OPTIONS = [1, 2, 4, 8, 16]

/** The chips run at a fixed 128 BPM rather than the open song's tempo: this is a picker,
 *  and a shape chosen against a ballad would look like a different shape on the floor. */
const DEMO_BEAT = 60 / 128

const shapeDemo = (shape: MoveShape): React.CSSProperties =>
  ({
    background: 'var(--accent)',
    '--ring': 'var(--accent)',
    animationName: SHAPE_META[shape].cycle ? `mv-${shape}` : undefined,
    animationDuration: `${SHAPE_META[shape].cycle * DEMO_BEAT}s`,
    animationIterationCount: 'infinite',
  }) as React.CSSProperties

const turnDemo = (deg: MoveTurn): React.CSSProperties => ({
  animationName: `mv-demo-turn-${deg > 0 ? 'r' : 'l'}${Math.abs(deg)}`,
  animationDuration: turnKeepsFacing(deg) ? '2.4s' : '3.6s',
  animationTimingFunction: 'ease-in-out',
  animationIterationCount: 'infinite',
})

interface Props {
  project: Project
  moveId: string
  onClose: () => void
}

export default function MoveModal({ project, moveId, onClose }: Props) {
  const existing = project.moves.find((m) => m.id === moveId)
  const [draft, setDraft] = useState<Move>(
    existing ?? { id: moveId, name: '', beats: 4, energy: 2, note: '' },
  )

  const patch = (p: Partial<Move>) => setDraft((d) => ({ ...d, ...p }))

  // Abandoning the modal must not leave the counts armed for the next move saved.
  useEffect(() => () => set({ pendingPlacement: null }, false), [])

  function save() {
    if (!draft.name.trim()) {
      flash('Give the move a name')
      return
    }
    const move = { ...draft, name: draft.name.trim(), builtin: existing?.builtin }
    upsertMove(move, `move-${move.id}`)
    const at = getState().pendingPlacement
    if (at) fillSelection({ ...at, beats: move.beats }, move.id)
    onClose()
  }

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header>
          <i className="ph ph-person-simple-walk i" />
          {existing ? 'Edit move' : 'New move'}
          <div className="spacer" />
          <button className="ghost icon" onClick={onClose}>
            <i className="ph ph-x" />
          </button>
        </header>

        <div className="content">
          <div className="field">
            <label>Name</label>
            <input autoFocus value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Hip bump right" />
          </div>

          <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>How many beats</label>
              <div className="row">
                {BEAT_OPTIONS.map((b) => (
                  <button key={b} className={draft.beats === b ? 'on' : ''} onClick={() => patch({ beats: b })}>
                    {b}
                  </button>
                ))}
              </div>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Energy</label>
              <div className="row">
                {([1, 2, 3] as const).map((e) => (
                  <button key={e} className={draft.energy === e ? 'on' : ''} onClick={() => patch({ energy: e })}>
                    {['Chill', 'Medium', 'Big'][e - 1]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="field">
            <label>Shape on the floor</label>
            <div className="reads-pick">
              {MOVE_SHAPES.map((shape) => (
                <button
                  key={shape}
                  className={draft.shape === shape ? 'on' : ''}
                  title={`Like ${SHAPE_META[shape].example}`}
                  onClick={() => patch({ shape })}
                >
                  <span className="box">
                    <span className={`disc sh-${shape}`} style={shapeDemo(shape)}>
                      <i className="nose" />
                    </span>
                  </span>
                  {SHAPE_META[shape].label}
                </button>
              ))}
              <button className={draft.shape ? '' : 'on'} onClick={() => patch({ shape: undefined })}>
                <span className="box none">nothing</span>
                None
              </button>
            </div>
          </div>

          <div className="field">
            <label>Turn</label>
            <div className="reads-pick">
              {MOVE_TURNS.map(({ deg, label, hint }) => (
                <button
                  key={deg}
                  className={`${turnKeepsFacing(deg) ? 'keeps' : ''}${draft.turn === deg ? ' on' : ''}`}
                  title={hint}
                  onClick={() => patch({ turn: deg })}
                >
                  <span className="box">
                    <span className="turner" style={turnDemo(deg)}>
                      <span className="disc" style={{ background: 'var(--accent)', '--ring': 'var(--accent)' } as React.CSSProperties}>
                        <i className="nose" />
                      </span>
                    </span>
                  </span>
                  {label}
                </button>
              ))}
              <button className={draft.turn ? '' : 'on'} onClick={() => patch({ turn: undefined })}>
                <span className="box none">nothing</span>
                None
              </button>
            </div>
            <p className="hint">
              A half turn leaves the dancer facing away until another turn brings them round. The floor and their lane in
              the timeline both chase anyone still carrying one.
            </p>
          </div>

          <div className="field">
            <label>Note for the dancers</label>
            <input value={draft.note ?? ''} onChange={(e) => patch({ note: e.target.value })} placeholder="Step out, tap foot in" />
          </div>
        </div>

        <footer>
          {existing && (
            <button
              className="ghost"
              style={{ color: 'var(--danger)', marginRight: 'auto' }}
              onClick={() => {
                removeMove(draft.id)
                onClose()
              }}
            >
              <i className="ph ph-trash i" /> Delete move
            </button>
          )}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </footer>
      </div>
    </div>
  )
}
