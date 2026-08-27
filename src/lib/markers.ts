import { measureStoredTempo } from './bpm'
import { DEFAULT_COUNTS_PER_ROW } from './grid'
import { addMarker, addSegment, flash, getState, set, uid } from './store'

export const MARKER_ICON = 'ph-flag'
export const MARKER_COLOUR = '#f0a63c'

// Reserved synchronously so a second cut fired at the same spot while the first is
// still decoding is rejected instead of racing it into two segments.
const pendingCuts = new Set<number>()

/**
 * Starts a new song at `time`, detecting its own tempo over [time, nextStart) rather
 * than inheriting the previous song's - a medley's songs don't share one.
 */
export async function splitSongAt(time: number): Promise<string | null> {
  const project = getState().project
  if (!project) return null
  if (project.segments.some((s) => Math.abs(s.start - time) < 0.35)) {
    flash('There is already a song start here')
    return null
  }
  if ([...pendingCuts].some((t) => Math.abs(t - time) < 0.35)) {
    flash('Already detecting a song start there')
    return null
  }
  pendingCuts.add(time)
  set({ status: 'Detecting tempo…' }, false)
  try {
    const sorted = [...project.segments].sort((a, b) => a.start - b.start)
    const next = sorted.find((s) => s.start > time)
    const end = next ? next.start : project.duration
    const previous = [...sorted].reverse().find((s) => s.start <= time) ?? sorted[0]

    let bpm = previous?.bpm ?? 120
    let anchor = time
    const estimate = await measureStoredTempo(time, end, time).catch(() => null)
    // A cut near the end of the file, or right before the next one, can leave less
    // than the measurable floor - fall back to the previous song's tempo rather than
    // claim a reading that was never taken.
    const measured = estimate && estimate.measurable && estimate.confidence > 0 ? estimate : null
    if (measured) {
      bpm = measured.bpm
      anchor = measured.phase
    }

    // The map may have changed while decoding (another cut, a sync pull); re-check
    // against the live project rather than the snapshot captured before the await.
    const fresh = getState().project
    if (!fresh || fresh.segments.some((s) => Math.abs(s.start - time) < 0.35)) {
      flash('The song map changed while detecting; try again')
      return null
    }

    const id = uid()
    addSegment({
      id,
      name: `Song ${fresh.segments.length + 1}`,
      start: time,
      bpm,
      anchor,
      transitionIn: 0,
      countsPerRow: previous?.countsPerRow ?? DEFAULT_COUNTS_PER_ROW,
      lyrics: [],
      lyricOffset: 0,
    })
    flash(
      measured
        ? `Song start at ${time.toFixed(2)}s, detected ${bpm} BPM. Check the "1".`
        : `Song start at ${time.toFixed(2)}s. Could not detect a tempo, set it by hand.`,
    )
    return id
  } finally {
    pendingCuts.delete(time)
  }
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
