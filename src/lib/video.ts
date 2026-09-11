import { isFor } from './cast'
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

/** Where the footage is. A copy on this device wins over the uploaded one: they are the
 *  same film, and the local blob costs no round trip per seek. A viewer's download
 *  promotes itself into `local` the moment it lands, so a share moves onto this path
 *  partway through its first viewing rather than only on the next one. */
export const takeSrc = (take: Take, local: Record<string, string>): string | undefined => local[take.id] ?? take.url

/** Which clip covers an audio time. A take with no footage reachable here is skipped
 *  rather than mounted as a broken element.
 *
 *  Footage reads exactly like the sheet: a clip tagged to this viewer wins over the
 *  untagged run for the seconds it covers, and the untagged run covers the rest. */
export function clipAt(
  project: Project,
  time: number,
  local: Record<string, string>,
  viewAs: string | null = null,
): Showing | null {
  const showing = (clip: Clip): Showing | null => {
    const take = project.takes.find((t) => t.id === clip.takeId)
    const src = take && takeSrc(take, local)
    return take && src ? { clip, take, src, srcTime: clip.srcIn + (time - clip.songStart) } : null
  }
  const covering = project.clips.filter(
    (c) => time >= c.songStart && time < clipEnd(c) && isFor(project, c, viewAs),
  )
  for (const clip of covering.filter((c) => c.for?.length)) {
    const found = showing(clip)
    if (found) return found
  }
  for (const clip of covering) {
    const found = showing(clip)
    if (found) return found
  }
  return null
}

export interface Warm {
  clipId: string
  takeId: string
  src: string
  /** The frame this clip opens on, so its element parks there ahead of the cut. */
  at: number
  /** Read off this device. A remote one shares the viewer's link with the clip on screen. */
  local: boolean
}

/** How many clips are kept parked ahead of the playhead. One: each is a second stream on
 *  the same link as the footage on screen and a second decoder on the phone, and three
 *  of them left a viewer on mobile data with a frozen clip while the cuts after it
 *  downloaded. */
const WARM_CLIPS = 1

/**
 * The clips about to be needed, in the order they cut in, each owed its own element
 * parked on its opening frame. At the cut that element is simply the one shown, so the
 * frame the browser already holds and has decoded is on screen the instant the song
 * crosses the cut. Per clip rather than per take: two cuts into one long take are two
 * different frames, and one element can only be parked on one of them. `showing` is the
 * clip on screen, which already has an element.
 */
export function warmClips(
  project: Project,
  time: number,
  local: Record<string, string>,
  viewAs: string | null = null,
  showing?: string,
): Warm[] {
  const warm: Warm[] = []
  for (const clip of orderedClips(project)) {
    if (clip.id === showing || clipEnd(clip) <= time || !isFor(project, clip, viewAs)) continue
    const take = project.takes.find((t) => t.id === clip.takeId)
    const src = take && takeSrc(take, local)
    if (!src) continue
    warm.push({ clipId: clip.id, takeId: clip.takeId, src, at: clip.srcIn, local: clip.takeId in local })
    if (warm.length === WARM_CLIPS) break
  }
  return warm
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

/** How far the footage inside a clip can really shift by `by`, holding the clip still on
 *  the song. Both ends are capped by the take itself: there is no film before its first
 *  frame or after its last. Returns 0 when it is already against that end. */
export function slipRoom(clip: Clip, take: Take, by: number): number {
  return Math.max(-clip.srcIn, Math.min(by, take.duration - clip.srcOut))
}

/** How far a head trim can pull `srcIn` back: capped by the take's own first frame and by
 *  the song's zero, whichever comes first. The one definition both the drag handle and the
 *  typed field read, so a future change to the rule cannot land on one and miss the other. */
export function minSrcIn(clip: Clip): number {
  return Math.max(0, clip.srcIn - clip.songStart)
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
