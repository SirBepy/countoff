export interface CalPoint {
  lineId: string
  srcTime: number
  time: number
}

/** Exact two-point solve: scale from the ratio of placed-time gap to source-time
 * gap, offset from anchoring point A. Guards the ways a mistaken tap turns into
 * garbage: same line twice, equal srcTimes (division by zero), or an implausible
 * scale that means the wrong line was tapped. Shared by SetupLyrics and
 * LyricsModal so the two surfaces can never disagree on where a fit lands. */
export function computeFit(a: CalPoint, b: CalPoint): { offset: number; scale: number } | { error: string } {
  if (a.lineId === b.lineId) return { error: 'Tap two different lines to calibrate.' }
  const dSrc = b.srcTime - a.srcTime
  if (Math.abs(dSrc) < 1e-6) return { error: 'Those two lines share the same source time. Pick lines further apart in the song.' }
  const scale = (b.time - a.time) / dSrc
  if (!Number.isFinite(scale) || scale < 0.5 || scale > 2) {
    return { error: `That works out to a ${Number.isFinite(scale) ? scale.toFixed(2) : '?'}x scale, unlikely to be right. Check you tapped the correct line.` }
  }
  const offset = a.time - a.srcTime * scale
  if (!Number.isFinite(offset)) return { error: 'Could not compute a fit from those points.' }
  return { offset, scale }
}
