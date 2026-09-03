import { beatToTime } from './grid'
import type { Formation, Person, Project } from './types'

/** Odd on both axes so a V shape and a lead dancer get a true centre cell. */
export const FLOOR_COLS = 11
export const FLOOR_ROWS = 7

/** Row 0 is the back of the floor; the last row is nearest whatever the dancers face. */
export const FRONT_ROW = FLOOR_ROWS - 1
export const CENTRE_COL = (FLOOR_COLS - 1) / 2

/** Walked in order so the first few people on a floor never land on near colours. */
const PALETTE = ['#7c5cff', '#3fb8b0', '#f0a63c', '#ff5d8f', '#5ec2ff', '#8fd44a', '#ffd166', '#c77dff']

export const nextColour = (people: Person[]) => PALETTE[people.length % PALETTE.length]

export function initialsFrom(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export interface PlacedFormation {
  formation: Formation
  /** Absolute audio time, so the rail, the timeline and playback all agree on order. */
  time: number
}

/**
 * Formations in play order with their absolute times. A formation whose segment
 * has been deleted is dropped rather than rendered at a nonsense time.
 */
export function orderedFormations(project: Project): PlacedFormation[] {
  const bySegment = new Map(project.segments.map((s) => [s.id, s]))
  return project.formations
    .flatMap((formation) => {
      const segment = bySegment.get(formation.segmentId)
      return segment ? [{ formation, time: beatToTime(segment, formation.startBeat) }] : []
    })
    .sort((a, b) => a.time - b.time)
}

/** The formation in force at `time`, which is the last one that has started. Null before the first. */
export function formationAtTime(project: Project, time: number): Formation | null {
  let found: Formation | null = null
  for (const placed of orderedFormations(project)) {
    if (placed.time > time + 1e-9) break
    found = placed.formation
  }
  return found
}

/** The same lookup keyed the way the sheet thinks, in beats from a segment's anchor. */
export function formationAt(project: Project, segmentId: string, beat: number): Formation | null {
  const segment = project.segments.find((s) => s.id === segmentId)
  return segment ? formationAtTime(project, beatToTime(segment, beat)) : null
}

export const spotFor = (formation: Formation, personId: string) =>
  formation.spots.find((s) => s.personId === personId)

export const isOnFloor = (formation: Formation, personId: string) => !!spotFor(formation, personId)

/** People with a spot here, in the project's own cast order so the list never jumps around. */
export const onFloor = (project: Project, formation: Formation) =>
  project.people.filter((p) => isOnFloor(formation, p.id))

export const waitingOff = (project: Project, formation: Formation) =>
  project.people.filter((p) => !isOnFloor(formation, p.id))

/**
 * Who walked on or off at this formation, against the one before it. Drives the
 * ring on a puck, which is the whole point of the view: seeing the entrance.
 */
export function entrances(project: Project, formation: Formation) {
  const order = orderedFormations(project)
  const index = order.findIndex((p) => p.formation.id === formation.id)
  const previous = index > 0 ? order[index - 1].formation : null
  const wasOn = (id: string) => (previous ? isOnFloor(previous, id) : false)
  return {
    /** Empty on the very first formation: everyone is new, so nobody is worth flagging. */
    in: previous ? formation.spots.filter((s) => !wasOn(s.personId)).map((s) => s.personId) : [],
    out: previous ? previous.spots.filter((s) => !isOnFloor(formation, s.personId)).map((s) => s.personId) : [],
  }
}

/**
 * A free cell for someone walking on, searched outward from front centre so an
 * added person lands where a latecomer actually would rather than in a corner.
 */
export function freeCell(formation: Formation, focusCell?: { col: number; row: number }) {
  const taken = new Set(formation.spots.map((s) => `${s.col},${s.row}`))
  const blocked = (col: number, row: number) =>
    taken.has(`${col},${row}`) || (focusCell?.col === col && focusCell?.row === row)
  for (let row = FRONT_ROW; row >= 0; row--) {
    for (let ring = 0; ring <= CENTRE_COL; ring++) {
      for (const col of ring === 0 ? [CENTRE_COL] : [CENTRE_COL - ring, CENTRE_COL + ring]) {
        if (col < 0 || col >= FLOOR_COLS) continue
        if (!blocked(col, row)) return { col, row }
      }
    }
  }
  return { col: 0, row: 0 }
}

/**
 * Every stretch a person is on the floor, as absolute times. `to` is the track's
 * duration when they never leave, so the timeline can draw a bar without a special case.
 */
export function stints(project: Project, personId: string) {
  const order = orderedFormations(project)
  const runs: { from: number; to: number }[] = []
  let open: number | null = null
  for (const { formation, time } of order) {
    const on = isOnFloor(formation, personId)
    if (on && open === null) open = time
    if (!on && open !== null) {
      runs.push({ from: open, to: time })
      open = null
    }
  }
  if (open !== null) runs.push({ from: open, to: project.duration })
  return runs
}
