import { useMemo, useState } from 'react'
import { alternateSelection, fillSelection } from '../lib/arrange'
import { useClip } from '../lib/clips'
import { flash, set, uid, useStore } from '../lib/store'
import type { Move, Project } from '../lib/types'

interface Props {
  project: Project
  onEditMove: (moveId: string) => void
}

export default function MoveLibrary({ project, onEditMove }: Props) {
  const [query, setQuery] = useState('')
  const selection = useStore((s) => s.selection)
  const activeMoveId = useStore((s) => s.activeMoveId)

  const moves = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? project.moves.filter((m) => m.name.toLowerCase().includes(q) || m.note?.toLowerCase().includes(q))
      : project.moves
    return [...list].sort((a, b) => a.beats - b.beats || a.name.localeCompare(b.name))
  }, [project.moves, query])

  function place(move: Move) {
    if (!selection) {
      flash('Select some counts on the sheet first')
      return
    }
    set({ activeMoveId: move.id }, false)
    fillSelection(selection, move.id)
  }

  function alternate(move: Move) {
    if (!selection || !activeMoveId || activeMoveId === move.id) {
      flash('Place one move first, then shift-click a second to alternate them')
      return
    }
    alternateSelection(selection, activeMoveId, move.id)
  }

  function newMove() {
    const id = uid()
    set({ activeMoveId: id }, false)
    onEditMove(id)
  }

  return (
    <>
      <div className="panel-head">
        <i className="ph ph-person-simple-walk i" /> Moves
        <div className="spacer" />
        <button className="ghost icon" onClick={newMove} title="Add your own move">
          <i className="ph ph-plus" />
        </button>
      </div>

      <div style={{ padding: '8px 10px' }}>
        <input placeholder="Search moves..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="scroll">
        <div className="move-list">
          {moves.map((move) => (
            <MoveCard
              key={move.id}
              move={move}
              active={move.id === activeMoveId}
              onPlace={(shift) => (shift ? alternate(move) : place(move))}
              onEdit={() => onEditMove(move.id)}
            />
          ))}
          {!moves.length && <p className="hint">Nothing matches. Hit + to add a move of your own.</p>}
        </div>
      </div>

      <div className="hint" style={{ borderTop: '1px solid var(--line-soft)' }}>
        Drag across counts to select, then click a move to fill the selection with repeats.
        <br />
        <kbd>Shift</kbd>+click a second move to alternate A B A B.
      </div>
    </>
  )
}

function MoveCard({
  move,
  active,
  onPlace,
  onEdit,
}: {
  move: Move
  active: boolean
  onPlace: (shift: boolean) => void
  onEdit: () => void
}) {
  const clip = useClip(move.id, move.hasClip)

  return (
    <div className={`move-card${active ? ' sel' : ''}`} onClick={(e) => onPlace(e.shiftKey)} title={move.note ?? move.name}>
      {clip ? (
        <video className="move-thumb" src={clip} muted loop playsInline onMouseEnter={(e) => e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />
      ) : (
        <div className="move-thumb">
          <i className="ph ph-person-simple-tai-chi" />
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div className="move-name">{move.name}</div>
        {move.note && <div className="move-note">{move.note}</div>}
      </div>
      <div className="row" style={{ gap: 4 }}>
        <span className={`beat-badge e${move.energy}`}>{move.beats}</span>
        <button
          className="ghost icon"
          style={{ width: 24, height: 24 }}
          title="Edit move, record a clip"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
        >
          <i className="ph ph-pencil-simple" />
        </button>
      </div>
    </div>
  )
}
