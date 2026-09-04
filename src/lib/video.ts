import { beatDuration, beatToTime } from './grid'
import { isComment, type Clip, type Project, type Take } from './types'

/** A clip runs at 1x, so the song it covers is exactly the footage it trims to. */
export const clipLength = (clip: Clip) => Math.max(0, clip.srcOut - clip.srcIn)

export const clipEnd = (clip: Clip) => clip.songStart + clipLength(clip)

/** Anything shorter than this is a frame or two, not a cut worth keeping. */
export const MIN_CLIP = 0.4

export const orderedClips = (project: Project) => [...project.clips].sort((a, b) => a.songStart - b.songStart)

export interface Showing {
  clip: Clip
  take: Take
  src: string
  /** Where inside the take this instant of the song lands. */
  srcTime: number
}

/** Where the footage is. An uploaded take carries its own url; a file held on this
 *  device resolves to an object URL in UI state, the way the song's own url does. */
export const takeSrc = (take: Take, local: Record<string, string>): string | undefined => take.url ?? local[take.id]

/** Which clip covers an audio time. A take with no footage reachable here is skipped
 *  rather than mounted as a broken element. */
export function clipAt(project: Project, time: number, local: Record<string, string>): Showing | null {
  for (const clip of project.clips) {
    if (time < clip.songStart || time >= clipEnd(clip)) continue
    const take = project.takes.find((t) => t.id === clip.takeId)
    const src = take && takeSrc(take, local)
    if (!take || !src) continue
    return { clip, take, src, srcTime: clip.srcIn + (time - clip.songStart) }
  }
  return null
}

/** Seconds of song with footage over them, counting overlaps once. */
export function coveredSeconds(project: Project): number {
  let covered = 0
  let reached = 0
  for (const clip of orderedClips(project)) {
    const from = Math.max(clip.songStart, reached)
    const to = clipEnd(clip)
    if (to > from) covered += to - from
    reached = Math.max(reached, to)
  }
  return covered
}

/**
 * How much room a clip has to grow into before it runs onto its neighbour. `ignoreId`
 * leaves the clip being dragged out of its own way.
 */
export function roomAt(project: Project, songStart: number, ignoreId?: string): number {
  const next = orderedClips(project).find((c) => c.id !== ignoreId && c.songStart > songStart)
  return (next ? next.songStart : project.duration) - songStart
}

/** Trims a take down to whatever gap it is being dropped into, or null if there is none. */
export function fitClip(project: Project, take: Take, songStart: number, id: string): Clip | null {
  const room = Math.min(roomAt(project, songStart), take.duration)
  if (room < MIN_CLIP) return null
  return { id, takeId: take.id, songStart, srcIn: 0, srcOut: room }
}

export interface PlacedBlock {
  id: string
  name: string
  note?: string
  energy: number
  comment: boolean
  from: number
  to: number
}

/** The sheet's blocks as absolute times, so any track can line them up under itself. */
export function placedBlocks(project: Project): PlacedBlock[] {
  const bySegment = new Map(project.segments.map((seg) => [seg.id, seg]))
  return project.blocks
    .flatMap((block) => {
      const segment = bySegment.get(block.segmentId)
      if (!segment) return []
      const move = project.moves.find((m) => m.id === block.moveId)
      const from = beatToTime(segment, block.startBeat)
      return [
        {
          id: block.id,
          name: isComment(block) ? block.note || 'Note' : (move?.name ?? '?'),
          // A comment already is its note, so only a move carries a second line of text.
          note: isComment(block) ? undefined : (block.note ?? move?.note),
          energy: move?.energy ?? 1,
          comment: isComment(block),
          from,
          to: from + block.beats * beatDuration(segment.bpm),
        },
      ]
    })
    .sort((a, b) => a.from - b.from)
}
