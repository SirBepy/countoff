import { useState } from 'react'
import { audio } from '../lib/audio'
import { measureStoredTempo } from '../lib/bpm'
import { beatToTime } from '../lib/grid'
import { flash, removeBlocks, set, updateSegment, useStore } from '../lib/store'
import type { Project } from '../lib/types'

interface Proposal {
  segmentId: string
  startBeat: number
  beats: number
  bpm: number
  phase: number
  confidence: number
}

/**
 * The bridge between picking counts and picking a move. On a phone the library
 * is a closed sheet, so without this there is no path from a selection to a fill.
 */
export default function SelectionBar({ project }: { project: Project }) {
  const selection = useStore((s) => s.selection)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [measuring, setMeasuring] = useState(false)
  if (!selection) return null

  const segment = project.segments.find((s) => s.id === selection.segmentId)
  const first = selection.startBeat % (segment?.countsPerRow ?? 8)
  const covered = project.blocks.filter(
    (b) =>
      b.segmentId === selection.segmentId &&
      b.startBeat < selection.startBeat + selection.beats &&
      b.startBeat + b.beats > selection.startBeat,
  )
  // Only valid for the exact selection it was measured from - picking new counts
  // drops a stale reading instead of showing it against the wrong range.
  const active =
    proposal &&
    proposal.segmentId === selection.segmentId &&
    proposal.startBeat === selection.startBeat &&
    proposal.beats === selection.beats
      ? proposal
      : null

  const onMeasure = async () => {
    if (!segment) return
    setMeasuring(true)
    const from = beatToTime(segment, selection.startBeat)
    const to = beatToTime(segment, selection.startBeat + selection.beats)
    const estimate = await measureStoredTempo(from, to, from).catch(() => null)
    setMeasuring(false)
    if (!estimate) {
      flash('Could not read the audio to measure tempo')
      return
    }
    setProposal({
      segmentId: selection.segmentId,
      startBeat: selection.startBeat,
      beats: selection.beats,
      bpm: estimate.bpm,
      phase: estimate.phase,
      confidence: estimate.confidence,
    })
  }

  const onAccept = () => {
    if (!active || !segment) return
    updateSegment(segment.id, { bpm: active.bpm, anchor: active.phase })
    flash(`Tempo set to ${active.bpm} BPM`)
    setProposal(null)
  }

  return (
    <div className="selbar">
      <span className="count mono">
        {selection.beats === 1 ? `count ${first + 1}` : `${selection.beats} counts`}
      </span>
      <button className="primary" onClick={() => set({ libraryOpen: true }, false)}>
        <i className="ph ph-person-simple-walk i" /> Fill with a move
      </button>
      {segment && (
        <button
          className="ghost icon"
          title="Loop this selection"
          onClick={() => {
            audio.setLoop({
              from: beatToTime(segment, selection.startBeat),
              to: beatToTime(segment, selection.startBeat + selection.beats),
            })
            audio.seek(beatToTime(segment, selection.startBeat))
            audio.play()
          }}
        >
          <i className="ph ph-repeat" />
        </button>
      )}
      {segment && !active && (
        <button
          className="ghost"
          disabled={measuring}
          title="Measure this selection's tempo from the audio, more reliable than tapping"
          onClick={() => void onMeasure()}
        >
          <i className={`ph ${measuring ? 'ph-spinner' : 'ph-waveform'} i`} /> {measuring ? 'Measuring…' : 'Measure BPM'}
        </button>
      )}
      {active && (
        <span className="row" style={{ gap: 6 }}>
          <span className="mono">{active.bpm} BPM measured</span>
          {active.confidence < 0.25 && <span className="faint">low confidence</span>}
          <button className="sm" onClick={onAccept}>
            Accept
          </button>
          <button className="ghost icon" title="Dismiss" onClick={() => setProposal(null)}>
            <i className="ph ph-x" />
          </button>
        </span>
      )}
      <button
        className="ghost icon"
        disabled={!covered.length}
        title="Clear the moves in this selection"
        onClick={() => removeBlocks(covered.map((b) => b.id))}
      >
        <i className="ph ph-eraser" />
      </button>
      <div className="spacer" />
      <button className="ghost icon" title="Deselect" onClick={() => set({ selection: null }, false)}>
        <i className="ph ph-x" />
      </button>
    </div>
  )
}
