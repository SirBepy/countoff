import { useMemo, useRef, useState } from 'react'
import { alternateSelection, fillSelection } from '../lib/arrange'
import { countAtPoint } from '../lib/sheetHit'
import { flash, set, uid, updateProject, useStore } from '../lib/store'
import { isComment, type Move, type Project } from '../lib/types'
import { setDropTarget } from '../lib/sheetGestures'

interface Props {
  project: Project
  onEditMove: (moveId: string) => void
}

/** Exact-length matches first, then unused before used; within a group, manual
 *  `order` wins, else beats/name. No `fitBeats` keeps the plain order. */
function sortMoves(moves: Move[], usedIds: Set<string>, fitBeats?: number) {
  return [...moves].sort((a, b) => {
    const fitA = a.beats === fitBeats
    const fitB = b.beats === fitBeats
    if (fitA !== fitB) return fitA ? -1 : 1
    const usedA = usedIds.has(a.id)
    const usedB = usedIds.has(b.id)
    if (usedA !== usedB) return usedA ? 1 : -1
    if (a.order == null && b.order == null) return a.beats - b.beats || a.name.localeCompare(b.name)
    if (a.order == null) return 1
    if (b.order == null) return -1
    return a.order - b.order
  })
}

/** Extracts a YouTube video id from a watch or short link so the card can show its
 * thumbnail; null for any other URL or a malformed one, never throws. */
export function youtubeThumb(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const id = host === 'youtu.be' ? u.pathname.slice(1) : host.endsWith('youtube.com') ? u.searchParams.get('v') : null
    return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null
  } catch {
    return null
  }
}

export default function MoveLibrary({ project, onEditMove }: Props) {
  const [query, setQuery] = useState('')
  const selection = useStore((s) => s.selection)
  const activeMoveId = useStore((s) => s.activeMoveId)
  const railRef = useRef<HTMLDivElement>(null)

  // Comment blocks carry no move, so they count towards nothing in the rail.
  const placed = useMemo(() => project.blocks.filter((b) => !isComment(b)), [project.blocks])
  const usedIds = useMemo(() => new Set(placed.map((b) => b.moveId!)), [placed])
  const useCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of placed) m.set(b.moveId!, (m.get(b.moveId!) ?? 0) + 1)
    return m
  }, [placed])

  const sorted = useMemo(() => sortMoves(project.moves, usedIds, selection?.beats), [project.moves, usedIds, selection?.beats])
  const moves = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? sorted.filter((m) => m.name.toLowerCase().includes(q) || m.note?.toLowerCase().includes(q)) : sorted
  }, [sorted, query])

  function place(move: Move) {
    if (!selection) {
      flash('Select some counts on the sheet first')
      return
    }
    set({ activeMoveId: move.id, libraryOpen: false }, false)
    fillSelection(selection, move.id)
  }

  function alternate(move: Move) {
    if (!selection || !activeMoveId || activeMoveId === move.id) {
      flash('Place one move first, then shift-click a second to alternate them')
      return
    }
    set({ libraryOpen: false }, false)
    alternateSelection(selection, activeMoveId, move.id)
  }

  function dropOnSheet(move: Move, clientX: number, clientY: number) {
    const drop = countAtPoint(project, clientX, clientY)
    if (!drop) return false
    set({ activeMoveId: move.id, libraryOpen: false }, false)
    fillSelection({ segmentId: drop.segmentId, startBeat: drop.startBeat, beats: move.beats }, move.id)
    return true
  }

  function overRail(clientX: number, clientY: number) {
    const rect = railRef.current?.getBoundingClientRect()
    return !!rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  }

  function reorderInRail(moveId: string, clientY: number) {
    const full = sortMoves(project.moves, usedIds)
    const dragIdx = full.findIndex((m) => m.id === moveId)
    if (dragIdx < 0) return
    const [dragged] = full.splice(dragIdx, 1)

    const cards = Array.from(railRef.current?.querySelectorAll<HTMLElement>('.move-card') ?? [])
    let insertAt = full.length
    for (const card of cards) {
      const id = card.dataset.moveId
      const idx = full.findIndex((m) => m.id === id)
      if (idx < 0) continue
      if (clientY < card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2) {
        insertAt = idx
        break
      }
    }
    full.splice(insertAt, 0, dragged)
    updateProject({ moves: full.map((m, i) => ({ ...m, order: i })) })
  }

  function startDrag(move: Move, downEvent: React.PointerEvent<HTMLElement>, fromHandle: boolean) {
    const originX = downEvent.clientX
    const originY = downEvent.clientY
    // A finger swiping the rail is scrolling, not dragging, so touch only picks a
    // card up from the grip. A mouse cannot scroll by dragging, so it grabs anywhere.
    const canDrag = fromHandle || downEvent.pointerType === 'mouse'
    let moved = false
    let ghost: HTMLDivElement | null = null

    const onMove = (ev: PointerEvent) => {
      if (!canDrag) return
      if (!moved) {
        if (Math.hypot(ev.clientX - originX, ev.clientY - originY) < 5) return
        moved = true
        ghost = document.createElement('div')
        ghost.className = 'move-drag-ghost'
        ghost.textContent = move.name
        document.body.appendChild(ghost)
      }
      ghost!.style.left = `${ev.clientX}px`
      ghost!.style.top = `${ev.clientY}px`
      const drop = countAtPoint(project, ev.clientX, ev.clientY)
      setDropTarget(drop ? { segmentId: drop.segmentId, startBeat: drop.startBeat, beats: move.beats } : null)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', cleanup)
      setDropTarget(null)
      ghost?.remove()
    }
    const onUp = (ev: PointerEvent) => {
      cleanup()
      if (!moved) {
        ev.shiftKey ? alternate(move) : place(move)
        return
      }
      if (dropOnSheet(move, ev.clientX, ev.clientY)) return
      if (overRail(ev.clientX, ev.clientY)) reorderInRail(move.id, ev.clientY)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', cleanup)
  }

  return (
    <>
      <div className="rail-grab" />
      <div className="panel-head">
        <span className="rail-title">
          {selection ? `Fill ${selection.beats} ${selection.beats === 1 ? 'count' : 'counts'}` : 'Moves'}
        </span>
        <div className="spacer" />
        <button
          className="ghost icon"
          onClick={() => {
            const id = uid()
            set({ activeMoveId: id }, false)
            onEditMove(id)
          }}
          title="Add your own move"
        >
          <i className="ph ph-plus" />
        </button>
        <button className="ghost icon rail-close" onClick={() => set({ libraryOpen: false }, false)} title="Close">
          <i className="ph ph-x" />
        </button>
      </div>

      <div style={{ padding: '0 12px 10px' }}>
        <input placeholder="Search moves" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="scroll">
        <div className="move-list" ref={railRef}>
          {moves.map((move) => (
            <MoveCard
              key={move.id}
              move={move}
              active={move.id === activeMoveId}
              used={usedIds.has(move.id)}
              useCount={useCounts.get(move.id) ?? 0}
              fits={!!selection && move.beats === selection.beats}
              onStartDrag={(e, fromHandle) => startDrag(move, e, fromHandle)}
              onEdit={() => onEditMove(move.id)}
            />
          ))}
          {!moves.length && <p className="hint">Nothing matches. Hit + to add a move of your own.</p>}
        </div>
      </div>

      <div className="hint" style={{ borderTop: '1px solid var(--line-soft)' }}>
        {selection ? (
          <>Tap a move to fill the selection with repeats, or drag its handle onto an exact count.</>
        ) : (
          <>Tap a count on the sheet, or its row number for a whole 8, then pick a move here.</>
        )}
        <span className="only-wide">
          {' '}
          <kbd>Shift</kbd>+click a second move to alternate A B A B.
        </span>
      </div>
    </>
  )
}

function MoveCard({
  move,
  active,
  used,
  useCount,
  fits,
  onStartDrag,
  onEdit,
}: {
  move: Move
  active: boolean
  used: boolean
  useCount: number
  fits: boolean
  onStartDrag: (e: React.PointerEvent<HTMLElement>, fromHandle: boolean) => void
  onEdit: () => void
}) {
  const thumb = youtubeThumb(move.videoUrl)

  return (
    <div
      className={`move-card${active ? ' sel' : ''}${used ? ' used' : ''}${fits ? ' fits' : ''}`}
      data-move-id={move.id}
      onPointerDown={(e) => onStartDrag(e, false)}
      title={move.note ?? move.name}
    >
      {thumb ? (
        <a className="move-thumb" href={move.videoUrl} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => e.stopPropagation()}>
          <img src={thumb} alt="" />
        </a>
      ) : move.videoUrl ? (
        <a className="move-thumb" href={move.videoUrl} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => e.stopPropagation()}>
          <i className="ph ph-link" />
        </a>
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
        {useCount > 0 && <span className="use-count">x{useCount}</span>}
        <span
          className="move-grip"
          title="Drag onto a count to place it, or up and down to reorder"
          onPointerDown={(e) => onStartDrag(e, true)}
        >
          <i className="ph ph-dots-six-vertical" />
        </span>
        <span className={`beat-badge e${move.energy}`}>{move.beats}</span>
        <button
          className="ghost sm icon"
          title="Edit move, add a video link"
          onPointerDown={(e) => e.stopPropagation()}
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
