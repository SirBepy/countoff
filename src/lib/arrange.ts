import { addBlocks, clearRange, flash, getState, uid, type Selection } from './store'
import type { Block } from './types'

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

  clearRange(selection.segmentId, selection.startBeat, repeats * move.beats)
  const blocks: Block[] = Array.from({ length: repeats }, (_, i) => ({
    id: uid(),
    segmentId: selection.segmentId,
    moveId,
    startBeat: selection.startBeat + i * move.beats,
    beats: move.beats,
  }))
  addBlocks(blocks)
  flash(repeats > 1 ? `${move.name} x${repeats}` : move.name)
}

/** Lays two moves down as A B A B across the selection. */
export function alternateSelection(selection: Selection, moveIdA: string, moveIdB: string) {
  const project = getState().project
  const a = project?.moves.find((m) => m.id === moveIdA)
  const b = project?.moves.find((m) => m.id === moveIdB)
  if (!project || !a || !b) return

  const blocks: Block[] = []
  let beat = selection.startBeat
  const end = selection.startBeat + selection.beats
  let useA = true
  while (beat + (useA ? a.beats : b.beats) <= end) {
    const move = useA ? a : b
    blocks.push({ id: uid(), segmentId: selection.segmentId, moveId: move.id, startBeat: beat, beats: move.beats })
    beat += move.beats
    useA = !useA
  }
  if (!blocks.length) return
  clearRange(selection.segmentId, selection.startBeat, beat - selection.startBeat)
  addBlocks(blocks)
  flash(`${a.name} / ${b.name} alternating`)
}
