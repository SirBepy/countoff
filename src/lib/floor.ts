import { beatToTime, timeToBeat } from './grid'
import type { FloorSize, Movement, Person, Project, Segment } from './types'

/** Odd on both axes so a V shape and a lead dancer get a true centre cell. */
export const DEFAULT_FLOOR: FloorSize = { cols: 11, rows: 7 }
export const FLOOR_MIN = 3
export const FLOOR_MAX = 21

/** A walk lasting one 8-count, which is the unit a choreographer counts a cross in. */
export const DEFAULT_WALK_COUNTS = 8
export const WALK_MAX = 64

/** Row 0 is the back of the floor; the last row is nearest whatever the dancers face. */
export const frontRow = (floor: FloorSize) => floor.rows - 1
export const centreCol = (floor: FloorSize) => Math.floor((floor.cols - 1) / 2)

/** Walked in order so the first few people on a floor never land on near colours. */
const PALETTE = ['#7c5cff', '#3fb8b0', '#f0a63c', '#ff5d8f', '#5ec2ff', '#8fd44a', '#ffd166', '#c77dff']

export const nextColour = (people: Person[]) => PALETTE[people.length % PALETTE.length]

export function initialsFrom(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export interface Cell {
  col: number
  row: number
}

export interface PlacedMovement {
  movement: Movement
  /** Absolute audio time they arrive, which is what the beat means. */
  arrive: number
  /** Absolute audio time they set off, `travel` counts earlier. */
  depart: number
}

function place(movement: Movement, segment: Segment): PlacedMovement {
  return {
    movement,
    arrive: beatToTime(segment, movement.beat),
    depart: beatToTime(segment, movement.beat - movement.travel),
  }
}

/**
 * Movements in play order with their absolute times. One whose segment has been
 * deleted is dropped rather than rendered at a nonsense time.
 */
export function orderedMovements(project: Project, personId?: string): PlacedMovement[] {
  const bySegment = new Map(project.segments.map((s) => [s.id, s]))
  return project.movements
    .filter((m) => !personId || m.personId === personId)
    .flatMap((movement) => {
      const segment = bySegment.get(movement.segmentId)
      return segment ? [place(movement, segment)] : []
    })
    .sort((a, b) => a.depart - b.depart || a.arrive - b.arrive)
}

/** The walk in force at `time`: the last one already under way, with the one before it. */
function activeAt(project: Project, personId: string, time: number) {
  const order = orderedMovements(project, personId)
  let index = -1
  for (let i = 0; i < order.length; i++) {
    if (order[i].depart > time + 1e-9) break
    index = i
  }
  return index < 0 ? null : { current: order[index], previous: index > 0 ? order[index - 1] : null }
}

/**
 * A point one cell outside the nearest edge, which is where someone walks on from
 * and off to. Entering from the far side of the floor would read as a cross, not an entrance.
 */
export function edgePoint(floor: FloorSize, cell: Cell): Cell {
  const gaps = [
    { d: cell.col + 1, at: { col: -1, row: cell.row } },
    { d: floor.cols - cell.col, at: { col: floor.cols, row: cell.row } },
    { d: cell.row + 1, at: { col: cell.col, row: -1 } },
    { d: floor.rows - cell.row, at: { col: cell.col, row: floor.rows } },
  ]
  return gaps.reduce((best, g) => (g.d < best.d ? g : best)).at
}

/**
 * Where someone is standing, or heading: the destination of the last walk begun by
 * `time`. Null means offstage. This is the settled view, used for collisions and lists.
 */
export function spotAt(project: Project, personId: string, time: number): Cell | null {
  return activeAt(project, personId, time)?.current.movement.to ?? null
}

export interface Standing extends Cell {
  /** 0 the instant they set off, 1 once they have arrived. Fractional cells in between. */
  progress: number
  /** Where the walk started, only while it is still running. Drives the trail. */
  from: Cell | null
}

/**
 * Where to draw someone at `time`, interpolated across their walk. Null while they
 * are offstage, so playback animates the cross instead of teleporting on the count.
 */
export function standingAt(project: Project, personId: string, time: number): Standing | null {
  const active = activeAt(project, personId, time)
  if (!active) return null
  const { current, previous } = active
  const to = current.movement.to
  if (time >= current.arrive - 1e-9) return to ? { ...to, progress: 1, from: null } : null

  const previousTo = previous?.movement.to ?? null
  const target = to ?? (previousTo ? edgePoint(project.floor, previousTo) : null)
  const origin = previousTo ?? (to ? edgePoint(project.floor, to) : null)
  if (!target || !origin) return null

  const span = current.arrive - current.depart
  const progress = span > 0 ? Math.max(0, Math.min(1, (time - current.depart) / span)) : 1
  return {
    col: origin.col + (target.col - origin.col) * progress,
    row: origin.row + (target.row - origin.row) * progress,
    progress,
    from: origin,
  }
}

/** People visible at `time`, in the project's own cast order. Someone mid walk-off still counts. */
export const onFloorAt = (project: Project, time: number) =>
  project.people.filter((p) => standingAt(project, p.id, time))

export const waitingOffAt = (project: Project, time: number) =>
  project.people.filter((p) => !standingAt(project, p.id, time))

/** Who is standing on a cell at `time`, so a drop cannot land two people on one square. */
export function occupantAt(project: Project, time: number, cell: Cell, exclude?: string) {
  return project.people.find((p) => {
    if (p.id === exclude) return false
    const spot = spotAt(project, p.id, time)
    return spot && spot.col === cell.col && spot.row === cell.row
  })
}

/**
 * A free cell for someone walking on, searched outward from front centre so an
 * added person lands where a latecomer actually would rather than in a corner.
 */
export function freeCell(project: Project, time: number, personId?: string): Cell {
  const { floor, focus } = project
  const centre = centreCol(floor)
  const blocked = (cell: Cell) =>
    (focus.kind === 'person' && focus.col === cell.col && focus.row === cell.row) ||
    !!occupantAt(project, time, cell, personId)
  for (let row = frontRow(floor); row >= 0; row--) {
    for (let ring = 0; ring <= centre; ring++) {
      for (const col of ring === 0 ? [centre] : [centre - ring, centre + ring]) {
        if (col < 0 || col >= floor.cols) continue
        if (!blocked({ col, row })) return { col, row }
      }
    }
  }
  return { col: 0, row: 0 }
}

/**
 * Every stretch a person is on the floor, as absolute times. On from the moment they
 * set off, off the moment they reach the wings, so the lane matches what the eye sees.
 */
export function stints(project: Project, personId: string) {
  const runs: { from: number; to: number }[] = []
  let open: number | null = null
  for (const { movement, arrive, depart } of orderedMovements(project, personId)) {
    if (movement.to && open === null) open = depart
    if (!movement.to && open !== null) {
      runs.push({ from: open, to: arrive })
      open = null
    }
  }
  if (open !== null) runs.push({ from: open, to: project.duration })
  return runs
}

/** The beat a drop at `time` lands on, and the song it belongs to. Null off the end of the medley. */
export function beatAt(project: Project, time: number) {
  let segment: Segment | undefined
  for (const s of project.segments) if (s.start <= time) segment = s
  if (!segment) return null
  return { segment, beat: Math.max(0, Math.round(timeToBeat(segment, time))) }
}

/** A movement's own note, or the cell it lands on, said the way the timeline shows it. */
export const movementLabel = (movement: Movement) =>
  movement.note || (movement.to ? `${movement.to.col + 1}·${movement.to.row + 1}` : 'off')

interface LegacyFormation {
  segmentId: string
  startBeat: number
  spots: { personId: string; col: number; row: number }[]
}

/**
 * Pre-movement shape: a formation was a whole-cast snapshot, so each becomes the
 * movements it implies against the one before it, with no walk in front of them.
 */
export function movementsFromFormations(
  formations: LegacyFormation[],
  segments: Segment[],
  uid: () => string,
): Movement[] {
  const bySegment = new Map(segments.map((s) => [s.id, s]))
  const ordered = formations
    .flatMap((f) => {
      const segment = bySegment.get(f.segmentId)
      return segment ? [{ f, time: beatToTime(segment, f.startBeat) }] : []
    })
    .sort((a, b) => a.time - b.time)

  const movements: Movement[] = []
  let standing = new Map<string, Cell>()
  for (const { f } of ordered) {
    const next = new Map<string, Cell>()
    for (const spot of f.spots ?? []) {
      const was = standing.get(spot.personId)
      next.set(spot.personId, { col: spot.col, row: spot.row })
      if (was && was.col === spot.col && was.row === spot.row) continue
      movements.push({
        id: uid(),
        personId: spot.personId,
        segmentId: f.segmentId,
        beat: f.startBeat,
        travel: 0,
        to: { col: spot.col, row: spot.row },
      })
    }
    for (const personId of standing.keys()) {
      if (next.has(personId)) continue
      movements.push({ id: uid(), personId, segmentId: f.segmentId, beat: f.startBeat, travel: 0, to: null })
    }
    standing = next
  }
  return movements
}
