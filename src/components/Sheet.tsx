import { useMemo } from 'react'
import { useAudio } from '../lib/audio'
import { sheetBlocks, type SheetBlock } from '../lib/cast'
import { rowCount, segmentEnd, timeToBeat } from '../lib/grid'
import { useStore } from '../lib/store'
import { type Project } from '../lib/types'
import SegmentHeader from './SegmentHeader'
import SheetMenu from './SheetMenu'
import SheetRow from './SheetRow'

/**
 * Greedy lane per block so overlaps stack rather than hide each other. Assigned
 * across the whole segment, so a block spanning two rows keeps one lane in both.
 * Keyed by `key`, not `id`: a default block split by someone's override draws as
 * several pieces that all carry the id of the one block they came from.
 */
function assignLanes(blocks: SheetBlock[]) {
  const laneEnd: number[] = []
  const lane = new Map<string, number>()
  for (const b of [...blocks].sort((a, c) => a.startBeat - c.startBeat)) {
    let i = laneEnd.findIndex((endsAt) => endsAt <= b.startBeat)
    if (i < 0) i = laneEnd.length
    laneEnd[i] = b.startBeat + b.beats
    lane.set(b.key, i)
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
  const viewAs = useStore((s) => s.viewAs)

  // Playback re-renders this tree every animation frame, so the lens and the lanes are
  // cached against the blocks themselves rather than recomputed per tick.
  const resolved = useMemo(
    () => sheetBlocks(project, viewAs),
    [project.blocks, project.groups, project.people, viewAs],
  )
  const bySegment = useMemo(() => {
    const map = new Map<string, { blocks: SheetBlock[]; lanes: Map<string, number> }>()
    for (const seg of project.segments) {
      const blocks = resolved.filter((b) => b.segmentId === seg.id)
      map.set(seg.id, { blocks, lanes: assignLanes(blocks) })
    }
    return map
  }, [project.segments, resolved])

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
                blocks={bySegment.get(seg.id)!.blocks}
                lanes={bySegment.get(seg.id)!.lanes}
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
