import { measureStoredTempo } from './bpm'
import { DEFAULT_COUNTS_PER_ROW } from './grid'
import { addMarker, addSegment, flash, getState, set, uid, updateSegment } from './store'
import type { Segment } from './types'

export const MARKER_ICON = 'ph-flag'
export const MARKER_COLOUR = '#f0a63c'

// Reserved synchronously so a second cut fired at the same spot while the first is
// still decoding is rejected instead of racing it into two segments.
const pendingCuts = new Set<number>()

// Segment id -> bpm from its last open-ended reading. In-memory only, so a reload
// forgets it and nothing gets auto-re-measured - the safe, under-correct-only direction.
const openEndedBpm = new Map<string, number>()

/** The segment immediately before `time`, or the first segment if none starts at or before it. */
function findPrevious(sorted: Segment[], time: number) {
  return [...sorted].reverse().find((s) => s.start <= time) ?? sorted[0]
}

/**
 * Adds a song start at `time` with no tempo detection - the new segment inherits the
 * previous song's bpm/anchor untouched. For screens that must not decode audio (setup
 * step 1, todo 08): the detection half of `splitSongAt` runs later, once all cuts exist.
 */
export function addSongAt(time: number): string | null {
  const project = getState().project
  if (!project) return null
  if (project.segments.some((s) => Math.abs(s.start - time) < 0.35)) {
    flash('There is already a song start here')
    return null
  }
  const sorted = [...project.segments].sort((a, b) => a.start - b.start)
  const previous = findPrevious(sorted, time)
  const id = uid()
  addSegment({
    id,
    name: `Song ${project.segments.length + 1}`,
    start: time,
    bpm: previous?.bpm ?? 120,
    anchor: time,
    transitionIn: 0,
    countsPerRow: previous?.countsPerRow ?? DEFAULT_COUNTS_PER_ROW,
    lyrics: [],
    fit: { offset: 0, scale: 1 },
    noLyrics: false,
  })
  flash(`Song start at ${time.toFixed(2)}s.`)
  return id
}

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
    const previous = findPrevious(sorted, time)

    // This cut gives `previous` a real end for the first time; re-measure it only if it
    // still holds the open-ended reading unchanged, so a hand-corrected bpm is never overwritten.
    const recordedBpm = previous ? openEndedBpm.get(previous.id) : undefined
    const rescorePrevious =
      previous !== undefined && previous.start < time && recordedBpm !== undefined && previous.bpm === recordedBpm

    let bpm = previous?.bpm ?? 120
    let anchor = time
    const [estimate, previousEstimate] = await Promise.all([
      measureStoredTempo(time, end, time).catch(() => null),
      rescorePrevious
        ? measureStoredTempo(previous.start, time, previous.start).catch(() => null)
        : Promise.resolve(null),
    ])
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

    if (rescorePrevious && previous) {
      openEndedBpm.delete(previous.id)
      const live = fresh.segments.find((s) => s.id === previous.id)
      const rescored =
        previousEstimate && previousEstimate.measurable && previousEstimate.confidence > 0 ? previousEstimate : null
      if (live && live.bpm === recordedBpm && rescored) {
        updateSegment(previous.id, { bpm: rescored.bpm, anchor: rescored.phase })
      }
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
      fit: { offset: 0, scale: 1 },
      noLyrics: false,
    })
    // No `next` yet means this window ran to project.duration - open-ended, so a
    // later cut should close and re-measure it unless the dev retunes it first.
    if (!next) openEndedBpm.set(id, bpm)
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
