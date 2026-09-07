import { blockAt, sheetBlocks } from './cast'
import { beatToTime, segmentAt, timeToBeat } from './grid'
import type { Block, FloorSize, FocusKey, Move, Movement, MoveTurn, Person, Project, Segment, Side } from './types'

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
export const centreRow = (floor: FloorSize) => Math.floor((floor.rows - 1) / 2)

/** Icon and label for each named edge, in the vocabulary the dancers see on screen. */
export const SIDES: Side[] = ['back', 'front', 'left', 'right']
export const SIDE_META: Record<Side, { label: string; icon: string }> = {
  back: { label: 'Back', icon: 'ph-arrow-up' },
  front: { label: 'Front', icon: 'ph-arrow-down' },
  left: { label: 'Left', icon: 'ph-arrow-left' },
  right: { label: 'Right', icon: 'ph-arrow-right' },
}

/** Walked in order so the first few people on a floor never land on near colours. */
const PALETTE = ['#7c5cff', '#3fb8b0', '#f0a63c', '#ff5d8f', '#5ec2ff', '#8fd44a', '#ffd166', '#c77dff']

export const nextColour = (people: Person[]) => PALETTE[people.length % PALETTE.length]

/** A stable colour for anything identified by a string rather than by its place in a list,
 *  such as a collaborator's account. Same palette the floor draws its pucks from, so one
 *  person reads the same everywhere. */
export function colourFor(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

/** Stable per-seed colours, de-conflicted across one list. `colourFor` hashes into eight
 *  entries, so any two people in a roster collide about one time in eight, and two identical
 *  pucks side by side read as one person twice rather than as two. */
export function distinctColours(seeds: string[]) {
  const used = new Set<string>()
  return seeds.map((seed) => {
    const wanted = colourFor(seed)
    const colour = used.has(wanted) ? (PALETTE.find((c) => !used.has(c)) ?? wanted) : wanted
    used.add(colour)
    return colour
  })
}

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

/** A point one cell outside the named edge, aligned with `cell` on the other axis. */
export function edgeCell(floor: FloorSize, side: Side, cell: Cell): Cell {
  if (side === 'back') return { col: cell.col, row: -1 }
  if (side === 'front') return { col: cell.col, row: floor.rows }
  if (side === 'left') return { col: -1, row: cell.row }
  return { col: floor.cols, row: cell.row }
}

/**
 * movement.side wins, then the dancer's own default, then the nearest-edge guess:
 * the one place this order runs, so every entrance and exit agrees on it.
 */
export function approachEdge(project: Project, movement: Movement, cell: Cell): Cell {
  const person = project.people.find((p) => p.id === movement.personId)
  const side = movement.side ?? person?.side
  return side ? edgeCell(project.floor, side, cell) : edgePoint(project.floor, cell)
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
  const target = to ?? (previousTo ? approachEdge(project, current.movement, previousTo) : null)
  const origin = previousTo ?? (to ? approachEdge(project, current.movement, to) : null)
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

/** Where the chair is at `time`, interpolated across its own move the way `standingAt`
 *  does a dancer's. Null when the number faces the audience; with no keys it is the
 *  static cell, which is why an older project renders exactly as it did. */
export function focusAt(project: Project, time: number): Cell | null {
  const { focus } = project
  if (focus.kind !== 'person') return null
  const keys = focus.keys ?? []
  if (!keys.length) return { col: focus.col, row: focus.row }

  const bySegment = new Map(project.segments.map((s) => [s.id, s]))
  const placed = keys
    .flatMap((key: FocusKey) => {
      const segment = bySegment.get(key.segmentId)
      if (!segment) return []
      const arrive = beatToTime(segment, key.beat)
      return [{ key, arrive, depart: beatToTime(segment, key.beat - key.travel) }]
    })
    .sort((a, b) => a.arrive - b.arrive)

  let origin: Cell = { col: focus.col, row: focus.row }
  for (const { key, arrive, depart } of placed) {
    if (time >= arrive - 1e-9) {
      origin = key.to
      continue
    }
    if (time <= depart) return origin
    const span = arrive - depart
    const progress = span > 0 ? (time - depart) / span : 1
    return {
      col: origin.col + (key.to.col - origin.col) * progress,
      row: origin.row + (key.to.row - origin.row) * progress,
    }
  }
  return origin
}

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

/** Who is standing on a cell at `time`, so a drop cannot land two people on one square. */
export function occupantAt(project: Project, time: number, cell: Cell, exclude?: string) {
  return project.people.find((p) => {
    if (p.id === exclude) return false
    const spot = spotAt(project, p.id, time)
    return spot && spot.col === cell.col && spot.row === cell.row
  })
}

/**
 * A free cell for someone walking on. With a chosen side, searches outward from the
 * centre of that edge. With none: the far row from whoever they face, centre first,
 * because dancers come on from behind and then travel toward the focus.
 */
export function freeCell(project: Project, time: number, personId?: string, side?: Side): Cell {
  const { floor } = project
  // The chair's cell at THIS instant, not a fixed one: it can be somewhere else by now.
  const chair = focusAt(project, time)
  const blocked = (cell: Cell) =>
    (!!chair && Math.round(chair.col) === cell.col && Math.round(chair.row) === cell.row) ||
    !!occupantAt(project, time, cell, personId)

  if (side) {
    const onRow = side === 'back' || side === 'front'
    const along = onRow ? floor.cols : floor.rows
    const centre = onRow ? centreCol(floor) : centreRow(floor)
    const fixed = side === 'back' ? 0 : side === 'front' ? frontRow(floor) : side === 'left' ? 0 : floor.cols - 1
    const cellAt = (pos: number) => (onRow ? { col: pos, row: fixed } : { col: fixed, row: pos })
    for (let ring = 0; ring <= centre; ring++) {
      for (const pos of ring === 0 ? [centre] : [centre - ring, centre + ring]) {
        if (pos < 0 || pos >= along) continue
        if (!blocked(cellAt(pos))) return cellAt(pos)
      }
    }
    return cellAt(0)
  }

  const centre = centreCol(floor)
  const facing = chair ? Math.round(chair.row) : frontRow(floor)
  const rows = Array.from({ length: floor.rows }, (_, row) => row).sort(
    (a, b) => Math.abs(b - facing) - Math.abs(a - facing) || a - b,
  )
  for (const row of rows) {
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

/** A movement's own note, the cell it lands on, or which side it left through. */
export function movementLabel(movement: Movement, person?: Person) {
  if (movement.note) return movement.note
  if (movement.to) return `${movement.to.col + 1}·${movement.to.row + 1}`
  const side = movement.side ?? person?.side
  return side ? SIDE_META[side].label : 'off'
}

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
