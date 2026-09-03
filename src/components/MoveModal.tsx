import { useEffect, useState } from 'react'
import { fillSelection } from '../lib/arrange'
import { flash, getState, removeMove, set, upsertMove } from '../lib/store'
import type { Move, Project } from '../lib/types'

const BEAT_OPTIONS = [1, 2, 4, 8, 16]

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
            <label>Note for the dancers</label>
            <input value={draft.note ?? ''} onChange={(e) => patch({ note: e.target.value })} placeholder="Step out, tap foot in" />
          </div>

          <div className="field">
            <label>Video link</label>
            <input
              value={draft.videoUrl ?? ''}
              onChange={(e) => patch({ videoUrl: e.target.value || undefined })}
              placeholder="https://youtube.com/watch?v=..."
            />
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
