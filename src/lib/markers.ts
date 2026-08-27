import { addMarker, addSegment, flash, getState, uid } from './store'

export const MARKER_ICON = 'ph-flag'
export const MARKER_COLOUR = '#f0a63c'

/** Starts a new song at `time`, inheriting the previous song's tempo as a guess. */
export function splitSongAt(time: number): string | null {
  const project = getState().project
  if (!project) return null
  if (project.segments.some((s) => Math.abs(s.start - time) < 0.35)) {
    flash('There is already a song start here')
    return null
  }
  const previous = [...project.segments].reverse().find((s) => s.start <= time) ?? project.segments[0]
  const id = uid()
  addSegment({
    id,
    name: `Song ${project.segments.length + 1}`,
    start: time,
    bpm: previous?.bpm ?? 120,
    anchor: time,
    beatsPerBar: 4,
    lyrics: [],
    lyricOffset: 0,
  })
  flash(`Song start at ${time.toFixed(2)}s. Set its BPM and tap the "1".`)
  return id
}

/** Marks a moment worth choreographing to, at `time`. Editable afterwards in MarkerModal. */
export function markAt(time: number): string | null {
  const project = getState().project
  if (!project) return null
  if (project.markers.some((m) => Math.abs(m.time - time) < 0.2)) return null
  const id = uid()
  addMarker({ id, time, label: 'Mark' })
  flash(`Marked at ${time.toFixed(2)}s`)
  return id
}
