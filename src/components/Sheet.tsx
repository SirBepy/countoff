import { useEffect, useRef, useState } from 'react'
import { audio, useAudio } from '../lib/audio'
import { COUNTS_PER_ROW, beatDuration, beatToTime, rowCount, segmentEnd, timeToBeat } from '../lib/grid'
import { lyricsBetween } from '../lib/lrc'
import { MARKER_KINDS } from '../lib/markers'
import { removeBlocks, set, updateBlock, updateSegment, useStore } from '../lib/store'
import type { Block, Project, Segment } from '../lib/types'
import SegmentHeader from './SegmentHeader'

interface Props {
  project: Project
  onEditLyrics: (segmentId: string) => void
  selectedSegmentId: string | null
  onSelectSegment: (id: string) => void
}

export default function Sheet({ project, onEditLyrics, selectedSegmentId, onSelectSegment }: Props) {
  const { time } = useAudio()
  const selection = useStore((s) => s.selection)
  const [editingLyric, setEditingLyric] = useState<string | null>(null)

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
                editingLyric={editingLyric}
                setEditingLyric={setEditingLyric}
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
  editingLyric: string | null
  setEditingLyric: (v: string | null) => void
  selection: { startBeat: number; beats: number } | null
}

function SheetRow({ project, segment, row, nowBeat, editingLyric, setEditingLyric, selection }: RowProps) {
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

    const onMove = (ev: PointerEvent) => {
      const delta = Math.round((ev.clientX - originX) / beatWidth)
      if (mode === 'move') updateBlock(block.id, { startBeat: Math.max(0, startBeat + delta) })
      else updateBlock(block.id, { beats: Math.max(1, beats + delta) })
    }
    const up = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', up)
  }

  function retimeLyric(index: number) {
    const lyrics = segment.lyrics.map((l) => (l === lines[index] ? { ...l, time: audio.el.currentTime } : l))
    updateSegment(segment.id, { lyrics: lyrics.sort((a, b) => a.time - b.time) })
  }

  function editLyricText(line: (typeof lines)[number], text: string) {
    updateSegment(segment.id, { lyrics: segment.lyrics.map((l) => (l === line ? { ...l, text } : l)) })
  }

  const lyricKey = (i: number) => `${segment.id}-${row}-${i}`

  return (
    <div ref={el} className={`sheet-row${active ? ' active' : ''}`}>
      <div className="row-no mono">{row + 1}</div>
      <div>
        <div className="row-lyric">
          {lines.length ? (
            lines.map((line, i) =>
              editingLyric === lyricKey(i) ? (
                <input
                  key={lyricKey(i)}
                  autoFocus
                  defaultValue={line.text}
                  style={{ width: 'auto', flex: 1, minWidth: 200 }}
                  onBlur={(e) => {
                    editLyricText(line, e.target.value)
                    setEditingLyric(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditingLyric(null)
                  }}
                />
              ) : (
                <span
                  key={lyricKey(i)}
                  title="Click to edit. Shift-click to retime to the playhead."
                  onClick={(e) => (e.shiftKey ? retimeLyric(i) : setEditingLyric(lyricKey(i)))}
                >
                  {line.text}
                </span>
              ),
            )
          ) : (
            <span className="none">&nbsp;</span>
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
              const meta = MARKER_KINDS[marker.kind]
              return (
                <div
                  key={marker.id}
                  className="count-marker"
                  style={{ left: `${((marker.time - from) / (to - from)) * 100}%`, background: meta.colour }}
                >
                  <span style={{ background: meta.colour }}>{marker.label}</span>
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
