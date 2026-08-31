import { useEffect, useRef, useSyncExternalStore } from 'react'
import { audio, useAudio } from '../lib/audio'
import { beatDuration, beatToTime, countsInRow, rowCount, segmentEnd, timeToBeat } from '../lib/grid'
import { addLyricAt, lyricsBetween } from '../lib/lrc'
import { MARKER_COLOUR } from '../lib/markers'
import { beatAtPoint, beatInRow, rowRects } from '../lib/sheetHit'
import { beginGesture, endGesture, removeBlocks, set, updateBlock, updateSegment, useStore } from '../lib/store'
import type { Block, Project, Segment } from '../lib/types'
import SegmentHeader from './SegmentHeader'

/** Sideways travel, in px, before a gesture on the sheet counts as a drag rather
 * than the start of a scroll. Matches MoveLibrary's own pick-up threshold. */
const DRAG_SLOP = 8

/**
 * Preview of where a move-card drag from the rail would land, set by MoveLibrary.
 * Lives outside the undo-tracked store since it's a transient UI highlight, never project data.
 */
let dropTarget: { segmentId: string; startBeat: number; beats: number } | null = null
const dropListeners = new Set<() => void>()
export function setDropTarget(target: typeof dropTarget) {
  dropTarget = target
  dropListeners.forEach((l) => l())
}
function useDropTarget() {
  return useSyncExternalStore(
    (cb) => {
      dropListeners.add(cb)
      return () => dropListeners.delete(cb)
    },
    () => dropTarget,
  )
}

interface Props {
  project: Project
  onEditLyrics: (segmentId: string) => void
  onEditMarker: (id: string) => void
  selectedSegmentId: string | null
  onSelectSegment: (id: string) => void
}

export default function Sheet({ project, onEditLyrics, onEditMarker, selectedSegmentId, onSelectSegment }: Props) {
  const { time } = useAudio()
  const selection = useStore((s) => s.selection)

  return (
    <div className="sheet">
      {project.segments.map((seg, i) => {
        const end = segmentEnd(project.segments, i, project.duration)
        const rows = rowCount(seg, end)
        const nowBeat = time >= seg.start && time < end ? timeToBeat(seg, time) : null

        return (
          <section key={seg.id}>
            <SegmentHeader
              segment={seg}
              end={end}
              selected={seg.id === selectedSegmentId}
              onSelect={() => onSelectSegment(seg.id)}
              onEditLyrics={() => onEditLyrics(seg.id)}
              removable={i > 0}
              first={i === 0}
            />
            {Array.from({ length: rows }, (_, r) => (
              <SheetRow
                key={r}
                project={project}
                segment={seg}
                row={r}
                end={end}
                nowBeat={nowBeat}
                onEditMarker={onEditMarker}
                selection={selection?.segmentId === seg.id ? selection : null}
              />
            ))}
            {!rows && <p className="hint">This song has no room after its "1". Move the cut or the anchor.</p>}
          </section>
        )
      })}
    </div>
  )
}

interface RowProps {
  project: Project
  segment: Segment
  row: number
  end: number
  nowBeat: number | null
  onEditMarker: (id: string) => void
  selection: { startBeat: number; beats: number } | null
}

function SheetRow({ project, segment, row, end, nowBeat, onEditMarker, selection }: RowProps) {
  const perRow = segment.countsPerRow
  const rowStart = row * perRow
  const rowEnd = rowStart + perRow
  const visibleCount = countsInRow(segment, row, end)
  const from = beatToTime(segment, rowStart)
  const to = beatToTime(segment, rowEnd)
  const lines = lyricsBetween(segment.lyrics, from, to)
  const blocks = project.blocks.filter(
    (b) => b.segmentId === segment.id && b.startBeat < rowEnd && b.startBeat + b.beats > rowStart,
  )
  const active = nowBeat !== null && nowBeat >= rowStart && nowBeat < rowEnd
  const currentCount = active ? Math.floor(nowBeat! - rowStart) : -1
  const rowSelected = !!selection && selection.startBeat < rowEnd && selection.startBeat + selection.beats > rowStart
  const el = useRef<HTMLDivElement>(null)
  const follow = useStore((s) => s.follow)
  const editingLyricId = useStore((s) => s.editingLyricId)
  const editingBlockNoteId = useStore((s) => s.editingBlockNoteId)
  const dropTarget = useDropTarget()
  const drop = dropTarget?.segmentId === segment.id ? dropTarget : null

  useEffect(() => {
    if (active && follow && !audio.el.paused) el.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active, follow])

  function selectRange(startBeat: number, beats: number, seekTo = startBeat) {
    set({ selection: { segmentId: segment.id, startBeat, beats } })
    audio.seek(beatToTime(segment, seekTo))
  }

  /** True while a gesture still looks like the start of a vertical scroll. */
  function isScrollish(dx: number, dy: number) {
    return Math.abs(dx) < DRAG_SLOP || Math.abs(dx) <= Math.abs(dy)
  }

  function startSelect(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('.block')) return
    const rows = rowRects(segment.id)
    if (!rows.length) return
    const anchor = beatAtPoint(segment, end, rows, e.clientX, e.clientY)
    const originX = e.clientX
    const originY = e.clientY
    // A finger on this grid is usually scrolling, and selecting on pointerdown is
    // what made that impossible. Touch commits only on a sideways drag or a lift.
    const touch = e.pointerType !== 'mouse'
    let committed = false

    const commit = (startBeat: number, beats: number) => {
      if (committed) return set({ selection: { segmentId: segment.id, startBeat, beats } })
      committed = true
      selectRange(startBeat, beats, anchor)
    }
    if (!touch) commit(anchor, 1)

    const onMove = (ev: PointerEvent) => {
      if (!committed && isScrollish(ev.clientX - originX, ev.clientY - originY)) return
      const beat = beatAtPoint(segment, end, rows, ev.clientX, ev.clientY)
      commit(Math.min(anchor, beat), Math.abs(beat - anchor) + 1)
    }
    // The browser fires pointercancel the moment it claims the gesture for a
    // scroll, which is the cleanest possible signal to stand down.
    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', stop)
    }
    const onUp = (ev: PointerEvent) => {
      stop()
      if (!committed && Math.hypot(ev.clientX - originX, ev.clientY - originY) < DRAG_SLOP) commit(anchor, 1)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', stop)
  }

  function dragBlock(block: Block, e: React.PointerEvent, mode: 'move' | 'resize') {
    e.stopPropagation()
    const container = (e.currentTarget as HTMLElement).closest('.counts') as HTMLElement
    const beatWidth = container.getBoundingClientRect().width / perRow
    const originX = e.clientX
    const originY = e.clientY
    const { startBeat, beats } = block
    const gestureKey = `block-${mode}-${block.id}`
    // The grip is touch-action:none and always drags; the block body is pan-y, so
    // a swipe down a wide block scrolls the sheet instead of dragging the block.
    const held = mode === 'resize' || e.pointerType === 'mouse'
    let started = held
    let moved = false
    if (held) {
      e.preventDefault()
      beginGesture(gestureKey)
    }

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - originX
      if (!started) {
        if (isScrollish(dx, ev.clientY - originY)) return
        started = true
        beginGesture(gestureKey)
      }
      if (Math.abs(dx) > 4) moved = true
      const delta = Math.round(dx / beatWidth)
      if (mode === 'move') updateBlock(block.id, { startBeat: Math.max(0, startBeat + delta) }, gestureKey)
      else updateBlock(block.id, { beats: Math.max(1, beats + delta) }, gestureKey)
    }
    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', stop)
      if (started) endGesture()
    }
    const onUp = () => {
      stop()
      if (!moved && mode === 'move') set({ editingBlockNoteId: block.id }, false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', stop)
  }

  function retimeLyric(index: number) {
    const lyrics = segment.lyrics.map((l) => (l === lines[index] ? { ...l, time: audio.el.currentTime } : l))
    updateSegment(segment.id, { lyrics: lyrics.sort((a, b) => a.time - b.time) })
  }

  function editLyricText(line: (typeof lines)[number], text: string) {
    updateSegment(segment.id, { lyrics: segment.lyrics.map((l) => (l === line ? { ...l, text } : l)) })
  }

  /** Desktop only: the phone hides this ghost line and adds lyrics from the song menu. */
  function addLyricHere(e: React.PointerEvent<HTMLDivElement>) {
    if (lines.length) return
    // Mounting the new input's autoFocus mid-gesture races the browser's own
    // mousedown focus resolution, which would otherwise blur it right back out.
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const beat = beatInRow(segment, end, { segmentId: segment.id, row, rect }, e.clientX)
    const id = addLyricAt(beatToTime(segment, beat))
    if (id) set({ editingLyricId: id }, false)
  }

  return (
    <div ref={el} className={`sheet-row${active ? ' active' : ''}`}>
      <button
        className={`row-no${rowSelected ? ' sel' : ''}`}
        title="Select this whole count"
        disabled={!visibleCount}
        // Chrome swallows the click of the first tap inside a scroller it has just
        // flung, so this acts on pointerup like the grid beside it. Re-running on
        // the click that sometimes follows picks the same row, so it is harmless.
        onPointerUp={(e) => e.pointerType !== 'mouse' && selectRange(rowStart, visibleCount)}
        onClick={() => selectRange(rowStart, visibleCount)}
      >
        {row + 1}
      </button>
      <div>
        <div className={`row-lyric${lines.length ? '' : ' addable'}`} onPointerDown={addLyricHere}>
          {lines.length ? (
            lines.map((line, i) =>
              editingLyricId === line.id ? (
                <input
                  key={line.id}
                  autoFocus
                  defaultValue={line.text}
                  style={{ width: 'auto', flex: 1, minWidth: 200 }}
                  onBlur={(e) => {
                    editLyricText(line, e.target.value)
                    set({ editingLyricId: null }, false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') set({ editingLyricId: null }, false)
                  }}
                />
              ) : (
                <span
                  key={line.id}
                  title="Click to edit. Shift-click to retime to the playhead."
                  onClick={(e) => (e.shiftKey ? retimeLyric(i) : set({ editingLyricId: line.id }, false))}
                >
                  {line.text}
                </span>
              ),
            )
          ) : (
            <span className="none" title="Click to add a lyric here">
              + Add lyric
            </span>
          )}
        </div>

        <div
          className={`counts${rowSelected ? ' selecting' : ''}`}
          data-segment-id={segment.id}
          data-row={row}
          style={{ gridTemplateColumns: `repeat(${perRow}, 1fr)` }}
          onPointerDown={startSelect}
        >
          {Array.from({ length: visibleCount }, (_, c) => {
            const beat = rowStart + c
            const inSelection = !!selection && beat >= selection.startBeat && beat < selection.startBeat + selection.beats
            const inDrop = !!drop && beat >= drop.startBeat && beat < drop.startBeat + drop.beats
            return (
              <div
                key={c}
                className={`count-cell${inSelection ? ' sel' : ''}${currentCount === c ? ' beat' : ''}${inDrop ? ' drop' : ''}`}
              >
                {c + 1}
              </div>
            )
          })}

          {project.markers
            .filter((m) => m.time >= from && m.time < to)
            .map((marker) => {
              const at = (marker.time - from) / (to - from)
              return (
                <div
                  key={marker.id}
                  // Past three quarters across, the label would run off the row.
                  className={`count-marker${at > 0.72 ? ' flip' : ''}`}
                  style={{ left: `${at * 100}%`, background: MARKER_COLOUR }}
                >
                  <button
                    style={{ background: MARKER_COLOUR }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onEditMarker(marker.id)}
                    title="Edit this marker"
                  >
                    {marker.label}
                  </button>
                </div>
              )
            })}

          {blocks.map((block) => {
            const move = project.moves.find((m) => m.id === block.moveId)
            const visStart = Math.max(block.startBeat, rowStart)
            const visEnd = Math.min(block.startBeat + block.beats, rowEnd)
            const isHead = block.startBeat >= rowStart
            const isTail = block.startBeat + block.beats <= rowEnd
            const now = nowBeat !== null && nowBeat >= block.startBeat && nowBeat < block.startBeat + block.beats
            const editing = editingBlockNoteId === block.id
            return (
              <div
                key={block.id}
                className={`block e${move?.energy ?? 2}${now ? ' now' : ''}${editing ? ' editing-note' : ''}`}
                style={{
                  left: `${((visStart - rowStart) / perRow) * 100}%`,
                  width: `${((visEnd - visStart) / perRow) * 100}%`,
                  borderTopLeftRadius: isHead ? 6 : 0,
                  borderBottomLeftRadius: isHead ? 6 : 0,
                  borderTopRightRadius: isTail ? 6 : 0,
                  borderBottomRightRadius: isTail ? 6 : 0,
                }}
                title={`${move?.name ?? 'Unknown move'} - ${block.beats} beats.${block.note ? ` Note: ${block.note}.` : ''} Drag to move, drag the right edge to stretch, tap to add a note, right-click to delete.`}
                onPointerDown={(e) => isHead && !editing && dragBlock(block, e, 'move')}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (block.note && !window.confirm(`Delete this block and its note "${block.note}"?`)) return
                  removeBlocks([block.id])
                }}
              >
                {editing ? (
                  <input
                    autoFocus
                    className="block-note-input"
                    defaultValue={block.note ?? ''}
                    placeholder="Note"
                    onBlur={(e) => {
                      const note = e.target.value.trim()
                      updateBlock(block.id, { note: note || undefined }, `block-note-${block.id}`)
                      set({ editingBlockNoteId: null }, false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') set({ editingBlockNoteId: null }, false)
                    }}
                  />
                ) : (
                  <>
                    {isHead && <span className="block-name">{move?.name ?? '?'}</span>}
                    {isHead && block.note && <span className="block-note">{block.note}</span>}
                    {block.note && <span className="block-note-dot" />}
                    {isTail && <span className="grip" onPointerDown={(e) => dragBlock(block, e, 'resize')} />}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export const rowDuration = (seg: Segment) => beatDuration(seg.bpm) * seg.countsPerRow
