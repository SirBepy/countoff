import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { audio, useAudio } from '../lib/audio'
import { beatDuration, beatToTime, countsInRow, rowCount, segmentEnd, timeToBeat } from '../lib/grid'
import { addLyricAt, lyricsBetween } from '../lib/lrc'
import { MARKER_COLOUR } from '../lib/markers'
import { beatAtPoint, beatInRow, rowRects } from '../lib/sheetHit'
import { beginGesture, endGesture, removeBlocks, set, updateBlock, updateSegment, useStore } from '../lib/store'
import { isComment, type Block, type Project, type Segment } from '../lib/types'
import SegmentHeader from './SegmentHeader'
import SheetMenu from './SheetMenu'

/** Sideways travel, in px, before a gesture on the sheet counts as a drag rather
 * than the start of a scroll. Matches MoveLibrary's own pick-up threshold. */
const DRAG_SLOP = 8

/** Hold before a finger picks a block up, or opens the menu on bare counts. */
const HOLD_MS = 260
const MENU_HOLD_MS = 500

/**
 * Transient drag highlights: they change every frame of a gesture and are never
 * project data, so they live outside the undo-tracked store.
 */
function transient<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  const subscribe = (cb: () => void) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }
  return {
    set(next: T) {
      value = next
      listeners.forEach((l) => l())
    },
    use: () => useSyncExternalStore(subscribe, () => value),
  }
}

/** Preview of where a move-card drag from the rail would land, set by MoveLibrary. */
const dropState = transient<{ segmentId: string; startBeat: number; beats: number } | null>(null)
const dragState = transient<string | null>(null)
export const setDropTarget = dropState.set

/**
 * Greedy lane per block so overlaps stack rather than hide each other. Assigned
 * across the whole segment, so a block spanning two rows keeps one lane in both.
 */
function assignLanes(blocks: Block[]) {
  const laneEnd: number[] = []
  const lane = new Map<string, number>()
  for (const b of [...blocks].sort((a, c) => a.startBeat - c.startBeat)) {
    let i = laneEnd.findIndex((endsAt) => endsAt <= b.startBeat)
    if (i < 0) i = laneEnd.length
    laneEnd[i] = b.startBeat + b.beats
    lane.set(b.id, i)
  }
  return lane
}

interface Props {
  project: Project
  onEditLyrics: (segmentId: string) => void
  onEditMarker: (id: string) => void
  onEditMove: (moveId: string) => void
  selectedSegmentId: string | null
  onSelectSegment: (id: string) => void
}

export default function Sheet({
  project,
  onEditLyrics,
  onEditMarker,
  onEditMove,
  selectedSegmentId,
  onSelectSegment,
}: Props) {
  const { time } = useAudio()
  const selection = useStore((s) => s.selection)

  // Playback re-renders this tree every animation frame, so lanes are cached
  // against the blocks themselves rather than recomputed per tick.
  const lanes = useMemo(() => {
    const bySegment = new Map<string, Map<string, number>>()
    for (const seg of project.segments) {
      bySegment.set(
        seg.id,
        assignLanes(project.blocks.filter((b) => b.segmentId === seg.id)),
      )
    }
    return bySegment
  }, [project.segments, project.blocks])

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
                lanes={lanes.get(seg.id)!}
                onEditMarker={onEditMarker}
                selection={selection?.segmentId === seg.id ? selection : null}
              />
            ))}
            {!rows && <p className="hint">This song has no room after its "1". Move the cut or the anchor.</p>}
          </section>
        )
      })}
      <SheetMenu project={project} onEditMove={onEditMove} />
    </div>
  )
}

interface RowProps {
  project: Project
  segment: Segment
  row: number
  end: number
  nowBeat: number | null
  lanes: Map<string, number>
  onEditMarker: (id: string) => void
  selection: { startBeat: number; beats: number } | null
}

function SheetRow({ project, segment, row, end, nowBeat, lanes, onEditMarker, selection }: RowProps) {
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
  const rowLanes = blocks.reduce((n, b) => Math.max(n, (lanes.get(b.id) ?? 0) + 1), 1)
  const el = useRef<HTMLDivElement>(null)
  const follow = useStore((s) => s.follow)
  const editingLyricId = useStore((s) => s.editingLyricId)
  const editingBlockNoteId = useStore((s) => s.editingBlockNoteId)
  const draggingId = dragState.use()
  const dropTarget = dropState.use()
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

  const openBlockMenu = (block: Block, x: number, y: number) =>
    set({ sheetMenu: { x, y, segmentId: segment.id, startBeat: block.startBeat, blockId: block.id } }, false)

  /** A comment or a picked move covers the selection when the menu opened inside
   * it, else up to four counts, never running past the end of the row. */
  function openCountsMenu(beat: number, x: number, y: number) {
    const inSelection = !!selection && beat >= selection.startBeat && beat < selection.startBeat + selection.beats
    const defaultBeats = inSelection ? selection!.beats : Math.max(1, Math.min(4, rowStart + visibleCount - beat))
    set({ sheetMenu: { x, y, segmentId: segment.id, startBeat: beat, defaultBeats } }, false)
  }

  function menuAtPoint(clientX: number, clientY: number) {
    const rows = rowRects(segment.id)
    if (!rows.length) return
    openCountsMenu(beatAtPoint(segment, end, rows, clientX, clientY), clientX, clientY)
  }

  function startSelect(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button === 2 || (e.target as HTMLElement).closest('.block')) return
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

    // The phone has no right-click, so a hold on bare counts is what opens the menu.
    let menuTimer = 0

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - originX
      const dy = ev.clientY - originY
      if (Math.hypot(dx, dy) > DRAG_SLOP) clearTimeout(menuTimer)
      if (!committed && isScrollish(dx, dy)) return
      const beat = beatAtPoint(segment, end, rows, ev.clientX, ev.clientY)
      commit(Math.min(anchor, beat), Math.abs(beat - anchor) + 1)
    }
    // The browser fires pointercancel the moment it claims the gesture for a
    // scroll, which is the cleanest possible signal to stand down.
    const stop = () => {
      clearTimeout(menuTimer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', stop)
    }
    const onUp = (ev: PointerEvent) => {
      stop()
      if (!committed && Math.hypot(ev.clientX - originX, ev.clientY - originY) < DRAG_SLOP) commit(anchor, 1)
    }
    if (touch) {
      menuTimer = window.setTimeout(() => {
        stop()
        navigator.vibrate?.(8)
        openCountsMenu(anchor, originX, originY)
      }, MENU_HOLD_MS)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', stop)
  }

  /**
   * Both axes come from the pointer's own position rather than a horizontal delta,
   * which is what lets a block travel into another row instead of stopping at the edge.
   */
  function dragBlock(block: Block, e: React.PointerEvent, mode: 'move' | 'resize') {
    e.stopPropagation()
    if (e.button === 2) return
    const rows = rowRects(segment.id)
    if (!rows.length) return
    const offset = beatAtPoint(segment, end, rows, e.clientX, e.clientY) - block.startBeat
    const originX = e.clientX
    const originY = e.clientY
    const gestureKey = `block-${mode}-${block.id}`
    // The grip and the mouse drag on contact. A finger on the block body has to
    // hold first, so a swipe down a wide block still scrolls the sheet.
    const held = mode === 'resize' || e.pointerType === 'mouse'
    let started = false
    let moved = false

    // touch-action is fixed for the life of a gesture, so an armed drag has to
    // refuse the scroll itself rather than by restyling the block.
    const refuseScroll = (ev: TouchEvent) => ev.preventDefault()

    const arm = () => {
      if (started) return
      started = true
      beginGesture(gestureKey)
      dragState.set(block.id)
      window.addEventListener('touchmove', refuseScroll, { passive: false })
      if (!held) navigator.vibrate?.(8)
    }
    if (held) {
      e.preventDefault()
      arm()
    }
    const holdTimer = held ? 0 : window.setTimeout(arm, HOLD_MS)

    const onMove = (ev: PointerEvent) => {
      if (!started) {
        const dx = ev.clientX - originX
        const dy = ev.clientY - originY
        if (Math.hypot(dx, dy) < DRAG_SLOP) return
        clearTimeout(holdTimer)
        // A vertical swipe that beat the hold is a scroll; let the sheet have it.
        if (isScrollish(dx, dy)) return stop()
        arm()
      }
      moved = true
      const beat = beatAtPoint(segment, end, rows, ev.clientX, ev.clientY)
      if (mode === 'move') updateBlock(block.id, { startBeat: Math.max(0, beat - offset) }, gestureKey)
      else updateBlock(block.id, { beats: Math.max(1, beat - block.startBeat + 1) }, gestureKey)
    }
    const stop = () => {
      clearTimeout(holdTimer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('touchmove', refuseScroll)
      if (started) {
        endGesture()
        dragState.set(null)
      }
    }
    const onUp = (ev: PointerEvent) => {
      stop()
      if (!moved && mode === 'move') openBlockMenu(block, ev.clientX, ev.clientY)
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
          style={{ gridTemplateColumns: `repeat(${perRow}, 1fr)`, '--lanes': rowLanes } as React.CSSProperties}
          onPointerDown={startSelect}
          onContextMenu={(e) => {
            e.preventDefault()
            menuAtPoint(e.clientX, e.clientY)
          }}
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
            const comment = isComment(block)
            const visStart = Math.max(block.startBeat, rowStart)
            const visEnd = Math.min(block.startBeat + block.beats, rowEnd)
            const isHead = block.startBeat >= rowStart
            const isTail = block.startBeat + block.beats <= rowEnd
            const now = nowBeat !== null && nowBeat >= block.startBeat && nowBeat < block.startBeat + block.beats
            const editing = editingBlockNoteId === block.id
            const label = comment ? block.note || 'Comment' : (move?.name ?? '?')
            return (
              <div
                key={block.id}
                data-block-id={block.id}
                className={`block ${comment ? 'comment' : `e${move?.energy ?? 2}`}${now ? ' now' : ''}${
                  editing ? ' editing-note' : ''
                }${draggingId === block.id ? ' dragging' : ''}`}
                style={
                  {
                    left: `${((visStart - rowStart) / perRow) * 100}%`,
                    width: `${((visEnd - visStart) / perRow) * 100}%`,
                    borderTopLeftRadius: isHead ? 6 : 0,
                    borderBottomLeftRadius: isHead ? 6 : 0,
                    borderTopRightRadius: isTail ? 6 : 0,
                    borderBottomRightRadius: isTail ? 6 : 0,
                    '--lane': lanes.get(block.id) ?? 0,
                  } as React.CSSProperties
                }
                title={`${label} - ${block.beats} beats. Tap for the menu, hold to drag, drag the right edge to stretch.`}
                onPointerDown={(e) => isHead && !editing && dragBlock(block, e, 'move')}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  openBlockMenu(block, e.clientX, e.clientY)
                }}
              >
                {editing ? (
                  <input
                    autoFocus
                    className="block-note-input"
                    defaultValue={block.note ?? ''}
                    placeholder={comment ? 'Comment' : 'Note'}
                    onBlur={(e) => {
                      const note = e.target.value.trim()
                      // A comment with nothing in it is an invisible obstacle, not a comment.
                      if (comment && !note) removeBlocks([block.id])
                      else updateBlock(block.id, { note: note || undefined }, `block-note-${block.id}`)
                      set({ editingBlockNoteId: null }, false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') e.currentTarget.blur()
                    }}
                  />
                ) : (
                  <>
                    {isHead && <span className="block-name">{label}</span>}
                    {isHead && !comment && block.note && <span className="block-note">{block.note}</span>}
                    {!comment && block.note && <span className="block-note-dot" />}
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
