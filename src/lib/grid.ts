import type { Segment } from './types'

export const beatDuration = (bpm: number) => 60 / bpm

/** Absolute audio time of a beat index measured from the segment's anchor. */
export const beatToTime = (seg: Segment, beat: number) => seg.anchor + beat * beatDuration(seg.bpm)

/** Fractional beat index at an absolute audio time. Negative before the anchor. */
export const timeToBeat = (seg: Segment, time: number) => (time - seg.anchor) / beatDuration(seg.bpm)

/** Dancers count in 8s by default; each song can override via Segment.countsPerRow. */
export const DEFAULT_COUNTS_PER_ROW = 8

export function segmentEnd(segments: Segment[], index: number, duration: number) {
  const next = segments[index + 1]
  return next ? next.start : duration
}

/** How many full rows fit between the anchor and the segment's end. */
export function rowCount(seg: Segment, end: number) {
  const beats = (end - seg.anchor) / beatDuration(seg.bpm)
  return Math.max(0, Math.ceil(beats / seg.countsPerRow))
}

/**
 * How many count cells actually fall before `end` in this row, so a cut that lands
 * mid-row truncates instead of showing counts past the song's end.
 */
export function countsInRow(seg: Segment, row: number, end: number) {
  const totalBeats = (end - seg.anchor) / beatDuration(seg.bpm)
  const rowStart = row * seg.countsPerRow
  // Epsilon guards a cut that lands exactly on a beat from rounding up one extra cell.
  const visible = Math.ceil(totalBeats - rowStart - 1e-9)
  return Math.max(0, Math.min(seg.countsPerRow, visible))
}

export function segmentAt(segments: Segment[], time: number) {
  let found = segments[0]
  for (const seg of segments) if (seg.start <= time) found = seg
  return found
}

/** Snap a time to the nearest beat, used when dropping or dragging blocks. */
export function snapToBeat(seg: Segment, time: number) {
  return beatToTime(seg, Math.round(timeToBeat(seg, time)))
}

export function formatTime(seconds: number) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
