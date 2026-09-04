import { beatToTime, blocksInSegment, segmentAt, timeToBeat } from './grid'
import type { Block, Move, Project, Segment } from './types'

export interface NowState {
  segment: Segment | null
  beat: number
  countInRow: number
  block: Block | null
  move: Move | null
  next: Move | null
  beatsUntilNext: number
}

/** Everything the transport and the rehearse screen need for one instant. */
export function nowState(project: Project, time: number): NowState {
  const segment = project.segments.length ? segmentAt(project.segments, time) : null
  if (!segment) {
    return { segment: null, beat: 0, countInRow: 0, block: null, move: null, next: null, beatsUntilNext: 0 }
  }

  const beat = timeToBeat(segment, time)
  const blocksIn = (seg: Segment) => blocksInSegment(project, seg.id)
  const blocks = blocksIn(segment)

  const block = blocks.find((b) => beat >= b.startBeat && beat < b.startBeat + b.beats) ?? null
  let upcoming = blocks.find((b) => b.startBeat > (block ? block.startBeat : beat)) ?? null
  let untilNext = upcoming ? upcoming.startBeat - beat : 0

  const nextSegment = project.segments[project.segments.indexOf(segment) + 1] ?? null
  if (!upcoming && nextSegment) {
    const ahead = blocksIn(nextSegment)[0] ?? null
    if (ahead) {
      upcoming = ahead
      // Distance stays in THIS song's counts, which is what a dancer is counting through
      // the cut; the next song's tempo only decides where its first block lands in time.
      untilNext = timeToBeat(segment, beatToTime(nextSegment, ahead.startBeat)) - beat
    }
  }

  const find = (id: string | undefined) => project.moves.find((m) => m.id === id) ?? null

  return {
    segment,
    beat,
    countInRow: ((Math.floor(beat) % segment.countsPerRow) + segment.countsPerRow) % segment.countsPerRow,
    block,
    move: find(block?.moveId),
    next: find(upcoming?.moveId),
    beatsUntilNext: upcoming ? Math.max(0, Math.ceil(untilNext)) : 0,
  }
}
