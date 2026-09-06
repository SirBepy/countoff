import { addBlocks, clearRange, flash, getState, uid, type Selection } from './store'
import type { Tagged } from './cast'
import type { Block } from './types'

/**
 * A move laid down while the sheet is being read as one dancer belongs to that dancer.
 * The alternative writes the whole cast's plan while only one person's is on screen,
 * which is the edit nobody means to make.
 */
const placingFor = (): Tagged => {
  const viewAs = getState().viewAs
  return viewAs ? { for: [viewAs] } : {}
}

/**
 * Repeats a move across the selected counts, which is how a 2-beat move fills
 * two bars. A trailing partial slot is left empty rather than half-filled.
 */
export function fillSelection(selection: Selection, moveId: string) {
  const project = getState().project
  const move = project?.moves.find((m) => m.id === moveId)
  if (!project || !move) return

  const repeats = Math.floor(selection.beats / move.beats)
  if (repeats < 1) {
    flash(`${move.name} is ${move.beats} beats, the selection is only ${selection.beats}`)
    return
  }

  const audience = placingFor()
  clearRange(selection.segmentId, selection.startBeat, repeats * move.beats, audience)
  const blocks: Block[] = Array.from({ length: repeats }, (_, i) => ({
    id: uid(),
    segmentId: selection.segmentId,
    moveId,
    startBeat: selection.startBeat + i * move.beats,
    beats: move.beats,
    ...audience,
  }))
  addBlocks(blocks)
  const who = audience.for ? ` for ${project.people.find((p) => p.id === audience.for![0])?.name ?? 'them'}` : ''
  flash(repeats > 1 ? `${move.name} x${repeats}${who}` : `${move.name}${who}`)
}

/** Lays two moves down as A B A B across the selection. */
export function alternateSelection(selection: Selection, moveIdA: string, moveIdB: string) {
  const project = getState().project
  const a = project?.moves.find((m) => m.id === moveIdA)
  const b = project?.moves.find((m) => m.id === moveIdB)
  if (!project || !a || !b) return

  const audience = placingFor()
  const blocks: Block[] = []
  let beat = selection.startBeat
  const end = selection.startBeat + selection.beats
  let useA = true
  while (beat + (useA ? a.beats : b.beats) <= end) {
    const move = useA ? a : b
    blocks.push({
      id: uid(),
      segmentId: selection.segmentId,
      moveId: move.id,
      startBeat: beat,
      beats: move.beats,
      ...audience,
    })
    beat += move.beats
    useA = !useA
  }
  if (!blocks.length) return
  clearRange(selection.segmentId, selection.startBeat, beat - selection.startBeat, audience)
  addBlocks(blocks)
  flash(`${a.name} / ${b.name} alternating`)
}
