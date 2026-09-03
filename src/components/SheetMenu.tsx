import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { addComment, duplicateBlock, removeBlocks, restackBlock, set, uid, useStore } from '../lib/store'
import { isComment, type Project } from '../lib/types'

/** Keeps the card off the screen edge it was opened against. */
const EDGE = 8

interface Props {
  project: Project
  onEditMove: (moveId: string) => void
}

export default function SheetMenu({ project, onEditMove }: Props) {
  const menu = useStore((s) => s.sheetMenu)
  const el = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState({ dx: 0, dy: 0 })
  const close = () => set({ sheetMenu: null }, false)

  // Measured rather than guessed: the item list changes height between the block
  // and bare-counts menus, and a phone has no room to spare below the fold.
  useLayoutEffect(() => {
    setOffset({ dx: 0, dy: 0 })
    if (!menu || !el.current) return
    const rect = el.current.getBoundingClientRect()
    setOffset({
      dx: Math.min(0, window.innerWidth - EDGE - rect.right),
      dy: Math.min(0, window.innerHeight - EDGE - rect.bottom),
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const onDown = (e: PointerEvent) => {
      if (el.current?.contains(e.target as Node)) return
      // Swallowed, so the tap that dismisses never also selects the counts beneath.
      e.stopPropagation()
      close()
    }
    window.addEventListener('keydown', onKey)
    // Capture, so the tap that dismisses never also lands on the sheet underneath.
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  if (!menu) return null
  const block = menu.blockId ? project.blocks.find((b) => b.id === menu.blockId) : undefined
  const move = block?.moveId ? project.moves.find((m) => m.id === block.moveId) : undefined
  const beats = menu.defaultBeats ?? 4

  const item = (icon: string, label: string, run: () => void, danger = false) => (
    <button className={`sheet-menu-item${danger ? ' danger' : ''}`} onClick={run}>
      <i className={`ph ${icon} i`} /> {label}
    </button>
  )

  return (
    <div
      ref={el}
      className="sheet-menu"
      style={{ left: menu.x + offset.dx, top: menu.y + offset.dy }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {block ? (
        <>
          <div className="sheet-menu-head">{move?.name ?? (block.note || 'Comment')}</div>
          {item('ph-pencil-simple', isComment(block) ? 'Edit text' : block.note ? 'Edit note' : 'Add note', () =>
            set({ editingBlockNoteId: block.id, sheetMenu: null }, false),
          )}
          {move && item('ph-person-simple-walk', 'Edit move', () => (close(), onEditMove(move.id)))}
          {item('ph-copy', 'Duplicate', () => (duplicateBlock(block.id), close()))}
          {item('ph-arrow-up', 'Bring to front', () => (restackBlock(block.id, 'front'), close()))}
          {item('ph-arrow-down', 'Send to back', () => (restackBlock(block.id, 'back'), close()))}
          {item('ph-trash', 'Delete', () => (removeBlocks([block.id]), close()), true)}
        </>
      ) : (
        <>
          <div className="sheet-menu-head">Count {menu.startBeat + 1}</div>
          {item('ph-chat-text', 'Add a comment', () => addComment(menu.segmentId, menu.startBeat, beats))}
          {item('ph-person-simple-walk', 'Pick a move', () =>
            set(
              {
                selection: { segmentId: menu.segmentId, startBeat: menu.startBeat, beats },
                libraryOpen: true,
                sheetMenu: null,
              },
              false,
            ),
          )}
          {item('ph-plus', 'New move here', () => {
            const id = uid()
            set(
              {
                activeMoveId: id,
                pendingPlacement: { segmentId: menu.segmentId, startBeat: menu.startBeat },
                sheetMenu: null,
              },
              false,
            )
            onEditMove(id)
          })}
        </>
      )}
    </div>
  )
}
