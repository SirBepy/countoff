import { blockAt, sheetBlocks } from './cast'
import { beatToTime, segmentAt, timeToBeat } from './grid'
import { stints } from './floor'
import type { Block, Move, MoveTurn, Project, Segment } from './types'

export interface Doing {
  segment: Segment
  block: Block | null
  move: Move | null
}

/**
 * What one dancer is on at `time`, read as themselves so a variant tagged to them wins
 * over the default the rest of the cast is doing. The floor, the cast rail and the
 * rehearse screen all ask this, which is what stops them ever disagreeing about who is
 * doing what on a given count.
 */
export function doingAt(project: Project, personId: string, time: number): Doing | null {
  if (!project.segments.length) return null
  const segment = segmentAt(project.segments, time)
  // The fractional beat, not the rounded one a drop lands on: a figure has to know how
  // far into its block it is, and rounding has already thrown that away.
  const block = blockAt(project, segment.id, timeToBeat(segment, time), personId)
  return { segment, block, move: project.moves.find((m) => m.id === block?.moveId) ?? null }
}

/** One turn a dancer performs, placed in absolute time. */
interface PlacedTurn {
  deg: MoveTurn
  from: number
  to: number
}

/**
 * Every turn one dancer does, in play order. Read through `sheetBlocks` so a variant
 * tagged to them beats the default underneath, and a piece an override has clipped is
 * skipped outright: two counts of a four-count Turn 360 is not half a turn, it is a
 * turn that never happened on those counts.
 */
function turnsFor(project: Project, personId: string): PlacedTurn[] {
  const bySegment = new Map(project.segments.map((s) => [s.id, s]))
  const byMove = new Map(project.moves.map((m) => [m.id, m]))
  return project.blocks.length
    ? sheetBlocks(project, personId)
        .flatMap((piece) => {
          const deg = piece.clipped ? undefined : piece.moveId && byMove.get(piece.moveId)?.turn
          const segment = bySegment.get(piece.segmentId)
          if (!deg || !segment) return []
          const from = beatToTime(segment, piece.startBeat)
          return [{ deg, from, to: beatToTime(segment, piece.startBeat + piece.beats) }]
        })
        .sort((a, b) => a.from - b.from)
    : []
}

/** More than a quarter turn off the front, which is where a dancer stops reading as
 *  angled and starts reading as backwards. */
export const isFacingAway = (deg: number) => {
  const n = ((deg % 360) + 360) % 360
  return n > 90 && n < 270
}

export interface Facing {
  /** Degrees clockwise from the front, interpolated across a turn in progress. */
  deg: number
  /** Inside a turn right now, so this angle is on its way somewhere. */
  turning: boolean
  /** Settled facing away: a half turn the choreography still owes back. Deliberately
   *  false mid-turn, so a full turn passing through 180 never flags on its way round. */
  away: boolean
}

/**
 * Which way a dancer is pointing at `time`: every turn they have finished, plus the
 * fraction of the one they are inside. Derived rather than stored, so retiming a song
 * or undoing a placement can never strand a stale facing. Walking off resets it, since
 * they come back on facing the front like anyone else does.
 */
export function facingAt(project: Project, personId: string, time: number): Facing {
  const stint = stints(project, personId).find((run) => time >= run.from && time <= run.to)
  const since = stint?.from ?? -Infinity
  let deg = 0
  for (const turn of turnsFor(project, personId)) {
    if (turn.from < since) continue
    if (turn.from > time) break
    if (time >= turn.to) {
      deg += turn.deg
      continue
    }
    const span = turn.to - turn.from
    return { deg: deg + turn.deg * (span > 0 ? (time - turn.from) / span : 1), turning: true, away: false }
  }
  return { deg, turning: false, away: isFacingAway(deg) }
}

/**
 * The stretches a dancer spends facing away, as absolute times, so the timeline can
 * show an unpaid half turn long before the playhead reaches it. A run opens where a
 * turn LANDS rather than where it starts, which is what keeps this and the live puck
 * saying the same thing.
 */
export function facingAwayRuns(project: Project, personId: string) {
  const runs: { from: number; to: number }[] = []
  const ends = stints(project, personId)
  let deg = 0
  let open: number | null = null
  for (const turn of turnsFor(project, personId)) {
    deg += turn.deg
    if (isFacingAway(deg)) open ??= turn.to
    else if (open !== null) {
      runs.push({ from: open, to: turn.to })
      open = null
    }
  }
  // Still facing away at the last turn, so it runs to wherever they leave the floor.
  if (open !== null) runs.push({ from: open, to: ends[ends.length - 1]?.to ?? project.duration })
  return runs
}
