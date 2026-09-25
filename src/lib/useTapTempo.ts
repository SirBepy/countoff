import { useRef, useState } from 'react'
import { bpmFromTaps } from './bpm'
import { updateSegment } from './store'
import type { Segment } from './types'

/**
 * The tap-timestamps/gap-reset/start-bpm-capture state machine, shared by SetupBeats'
 * inline tap button and SegmentHeader's popover one - same 20 lines were being kept in
 * sync by hand in both places. What differs between the two callers is UI chrome only
 * (inline button vs popover-scoped button plus a click-away/Escape close path), so this
 * hook owns just the timing and leaves markup and popover lifecycle to each caller.
 */
export function useTapTempo(segment: Segment) {
  const taps = useRef<number[]>([])
  const [tapping, setTapping] = useState(false)
  const startBpm = useRef<number | null>(null)

  /** Clears the session without touching the bpm - used both by cancel (after reverting)
   *  and by a caller that wants taps to stop without restoring the pre-tap value (e.g.
   *  SegmentHeader's popover closing by click-away, which deliberately keeps the tapped bpm). */
  function reset() {
    taps.current = []
    setTapping(false)
    startBpm.current = null
  }

  function tap() {
    const now = performance.now() / 1000
    if (!tapping) startBpm.current = segment.bpm
    // A gap this long means a fresh attempt, not a continuation.
    if (taps.current.length && now - taps.current[taps.current.length - 1] > 2) taps.current = []
    taps.current.push(now)
    setTapping(true)
    const bpm = bpmFromTaps(taps.current)
    if (bpm) updateSegment(segment.id, { bpm })
  }

  /** Right-click bails out of a stray tap session and puts the bpm back where it started. */
  function cancel(e: React.MouseEvent) {
    e.preventDefault()
    if (!tapping) return
    const revertTo = startBpm.current
    reset()
    if (revertTo !== null) updateSegment(segment.id, { bpm: revertTo })
  }

  return { tapping, tap, cancel, reset }
}
