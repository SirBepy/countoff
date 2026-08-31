import { useState } from 'react'
import { measureStoredTempo } from '../lib/bpm'
import { beatToTime } from '../lib/grid'
import { flash, updateSegment, type Selection } from '../lib/store'
import type { Segment } from '../lib/types'

type Reading =
  | { measurable: true; bpm: number; phase: number; confidence: number }
  | { measurable: false; secondsNeeded: number }

/** Reads a selection's tempo off the audio, which beats tapping it by hand. */
export default function MeasureBpm({ segment, selection }: { segment: Segment; selection: Selection }) {
  const [reading, setReading] = useState<(Reading & { key: string }) | null>(null)
  const [measuring, setMeasuring] = useState(false)

  // Only valid for the exact selection it was measured from - picking new counts
  // drops a stale reading instead of showing it against the wrong range.
  const key = `${selection.segmentId}:${selection.startBeat}:${selection.beats}`
  const active = reading?.key === key ? reading : null

  async function measure() {
    setMeasuring(true)
    const from = beatToTime(segment, selection.startBeat)
    const to = beatToTime(segment, selection.startBeat + selection.beats)
    const result = await measureStoredTempo(from, to, from).catch(() => null)
    setMeasuring(false)
    if (!result) {
      flash('Could not read the audio to measure tempo')
      return
    }
    setReading({ ...result, key })
  }

  if (!active) {
    return (
      <button
        className="sm"
        disabled={measuring}
        title="Measure this selection's tempo from the audio, more reliable than tapping"
        onClick={() => void measure()}
      >
        <i className={`ph ${measuring ? 'ph-spinner' : 'ph-waveform'} i`} /> {measuring ? 'Measuring…' : 'Measure BPM'}
      </button>
    )
  }

  if (!active.measurable) {
    return <span className="faint">Too short to measure - select at least {active.secondsNeeded}s of audio</span>
  }

  return (
    <span className="row" style={{ gap: 6 }}>
      <span className="mono">{active.bpm} BPM measured</span>
      {active.confidence < 0.25 && <span className="faint">low confidence</span>}
      <button
        className="sm"
        onClick={() => {
          updateSegment(segment.id, { bpm: active.bpm, anchor: active.phase })
          flash(`Tempo set to ${active.bpm} BPM`)
          setReading(null)
        }}
      >
        Accept
      </button>
      <button className="ghost sm icon" title="Dismiss" onClick={() => setReading(null)}>
        <i className="ph ph-x" />
      </button>
    </span>
  )
}
