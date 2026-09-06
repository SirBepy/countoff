import { useEffect, useState } from 'react'
import { tagLabel } from '../lib/cast'
import { useMenuFit } from '../lib/menuFit'
import { addComment, duplicateBlock, removeBlocks, restackBlock, set, setBlockCast, uid, useStore } from '../lib/store'
import { isComment, type Project } from '../lib/types'
import CastPicker from './CastPicker'

interface Props {
  project: Project
  onEditMove: (moveId: string) => void
}

export default function SheetMenu({ project, onEditMove }: Props) {
  const menu = useStore((s) => s.sheetMenu)
  const [castFor, setCastFor] = useState<string | null>(null)
  const { ref: el, offset } = useMenuFit<HTMLDivElement>(menu)
  const close = () => set({ sheetMenu: null }, false)

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

  // Outlives the menu it was opened from: picking who a move is for takes longer than
  // the tap that dismisses the menu underneath.
  const tagging = castFor ? project.blocks.find((b) => b.id === castFor) : undefined
  const picker = tagging ? (
    <CastPicker
      project={project}
      title="Who does this?"
      subject={`${project.moves.find((m) => m.id === tagging.moveId)?.name ?? 'This block'} - ${tagging.beats} counts`}
      value={tagging.for ?? []}
      overlapping={project.blocks.filter(
        (b) =>
          b.id !== tagging.id &&
          b.segmentId === tagging.segmentId &&
          b.startBeat < tagging.startBeat + tagging.beats &&
          b.startBeat + b.beats > tagging.startBeat,
      )}
      onSave={(ids) => {
        setBlockCast(tagging.id, ids)
        setCastFor(null)
      }}
      onClose={() => setCastFor(null)}
    />
  ) : null

  if (!menu) return picker
  const block = menu.blockId ? project.blocks.find((b) => b.id === menu.blockId) : undefined
  const move = block?.moveId ? project.moves.find((m) => m.id === block.moveId) : undefined
  const beats = menu.defaultBeats ?? 4

  const item = (icon: string, label: string, run: () => void, danger = false) => (
    <button className={`sheet-menu-item${danger ? ' danger' : ''}`} onClick={run}>
      <i className={`ph ${icon} i`} /> {label}
    </button>
  )

  return (
    <>
      {picker}
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
          {!isComment(block) &&
            item('ph-users-three', block.for?.length ? `For ${tagLabel(project, block)}` : 'Who does this?', () => {
              setCastFor(block.id)
              close()
            })}
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
    </>
  )
}
