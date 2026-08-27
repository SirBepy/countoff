import { useEffect, useRef } from 'react'
import { audio, useAudio } from '../lib/audio'
import { COUNTS_PER_ROW, beatDuration, beatToTime, rowCount, segmentEnd, timeToBeat } from '../lib/grid'
import { addLyricAt, lyricsBetween } from '../lib/lrc'
import { MARKER_COLOUR } from '../lib/markers'
import { beginGesture, endGesture, removeBlocks, set, updateBlock, updateSegment, useStore } from '../lib/store'
import type { Block, Project, Segment } from '../lib/types'
import SegmentHeader from './SegmentHeader'

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
            />
            {Array.from({ length: rows }, (_, r) => (
              <SheetRow
                key={r}
                project={project}
                segment={seg}
                row={r}
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
  nowBeat: number | null
  onEditMarker: (id: string) => void
  selection: { startBeat: number; beats: number } | null
}

function SheetRow({ project, segment, row, nowBeat, onEditMarker, selection }: RowProps) {
  const rowStart = row * COUNTS_PER_ROW
  const rowEnd = rowStart + COUNTS_PER_ROW
  const from = beatToTime(segment, rowStart)
  const to = beatToTime(segment, rowEnd)
  const lines = lyricsBetween(segment.lyrics, from, to)
  const blocks = project.blocks.filter(
    (b) => b.segmentId === segment.id && b.startBeat < rowEnd && b.startBeat + b.beats > rowStart,
  )
  const active = nowBeat !== null && nowBeat >= rowStart && nowBeat < rowEnd
  const currentCount = active ? Math.floor(nowBeat! - rowStart) : -1
  const el = useRef<HTMLDivElement>(null)
  const follow = useStore((s) => s.follow)
  const editingLyricId = useStore((s) => s.editingLyricId)

  useEffect(() => {
    if (active && follow && !audio.el.paused) el.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active, follow])

  function beatFromEvent(e: React.PointerEvent<HTMLDivElement> | PointerEvent, container: HTMLElement) {
    const rect = container.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    return rowStart + Math.max(0, Math.min(COUNTS_PER_ROW - 1, Math.floor(ratio * COUNTS_PER_ROW)))
  }

  function startSelect(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('.block')) return
    const container = e.currentTarget
    const anchor = beatFromEvent(e, container)
    set({ selection: { segmentId: segment.id, startBeat: anchor, beats: 1 } })
    audio.seek(beatToTime(segment, anchor))

    const move = (ev: PointerEvent) => {
      const beat = beatFromEvent(ev, container)
      const startBeat = Math.min(anchor, beat)
      set({ selection: { segmentId: segment.id, startBeat, beats: Math.abs(beat - anchor) + 1 } })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function dragBlock(block: Block, e: React.PointerEvent, mode: 'move' | 'resize') {
    e.stopPropagation()
    e.preventDefault()
    const container = (e.currentTarget as HTMLElement).closest('.counts') as HTMLElement
    const rect = container.getBoundingClientRect()
    const beatWidth = rect.width / COUNTS_PER_ROW
    const originX = e.clientX
    const { startBeat, beats } = block
    const gestureKey = `block-${mode}-${block.id}`
    beginGesture(gestureKey)

    const onMove = (ev: PointerEvent) => {
      const delta = Math.round((ev.clientX - originX) / beatWidth)
      if (mode === 'move') updateBlock(block.id, { startBeat: Math.max(0, startBeat + delta) }, gestureKey)
      else updateBlock(block.id, { beats: Math.max(1, beats + delta) }, gestureKey)
    }
    const up = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      endGesture()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  function retimeLyric(index: number) {
    const lyrics = segment.lyrics.map((l) => (l === lines[index] ? { ...l, time: audio.el.currentTime } : l))
    updateSegment(segment.id, { lyrics: lyrics.sort((a, b) => a.time - b.time) })
  }

  function editLyricText(line: (typeof lines)[number], text: string) {
    updateSegment(segment.id, { lyrics: segment.lyrics.map((l) => (l === line ? { ...l, text } : l)) })
  }

  function addLyricHere(e: React.PointerEvent<HTMLDivElement>) {
    if (lines.length) return
    // Mounting the new input's autoFocus mid-gesture races the browser's own
    // mousedown focus resolution, which would otherwise blur it right back out.
    e.preventDefault()
    const id = addLyricAt(beatToTime(segment, beatFromEvent(e, e.currentTarget)))
    if (id) set({ editingLyricId: id }, false)
  }

  return (
    <div ref={el} className={`sheet-row${active ? ' active' : ''}`}>
      <div className="row-no mono">{row + 1}</div>
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

        <div className="counts" onPointerDown={startSelect}>
          {Array.from({ length: COUNTS_PER_ROW }, (_, c) => {
            const beat = rowStart + c
            const inSelection = !!selection && beat >= selection.startBeat && beat < selection.startBeat + selection.beats
            return (
              <div
                key={c}
                className={`count-cell${inSelection ? ' sel' : ''}${currentCount === c ? ' beat' : ''}`}
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
            return (
              <div
                key={block.id}
                className={`block e${move?.energy ?? 2}${now ? ' now' : ''}`}
                style={{
                  left: `${((visStart - rowStart) / COUNTS_PER_ROW) * 100}%`,
                  width: `${((visEnd - visStart) / COUNTS_PER_ROW) * 100}%`,
                  borderTopLeftRadius: isHead ? 6 : 0,
                  borderBottomLeftRadius: isHead ? 6 : 0,
                  borderTopRightRadius: isTail ? 6 : 0,
                  borderBottomRightRadius: isTail ? 6 : 0,
                }}
                title={`${move?.name ?? 'Unknown move'} - ${block.beats} beats. Drag to move, drag the right edge to stretch, right-click to delete.`}
                onPointerDown={(e) => isHead && dragBlock(block, e, 'move')}
                onContextMenu={(e) => {
                  e.preventDefault()
                  removeBlocks([block.id])
                }}
              >
                {isHead && (move?.name ?? '?')}
                {isTail && <span className="grip" onPointerDown={(e) => dragBlock(block, e, 'resize')} />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export const rowDuration = (seg: Segment) => beatDuration(seg.bpm) * COUNTS_PER_ROW
