import { useRef, useState } from 'react'
import { audio } from '../lib/audio'
import { bpmFromTaps } from '../lib/bpm'
import { formatTime } from '../lib/grid'
import { flash, removeSegment, updateSegment } from '../lib/store'
import type { Segment } from '../lib/types'

interface Props {
  segment: Segment
  end: number
  selected: boolean
  removable: boolean
  /** True for the opening segment, which has no incoming transition to adjust. */
  first: boolean
  onSelect: () => void
  onEditLyrics: () => void
}

export default function SegmentHeader({ segment, end, selected, removable, first, onSelect, onEditLyrics }: Props) {
  const taps = useRef<number[]>([])
  const [tapping, setTapping] = useState(false)
  // Eleven tempo controls do not fit a phone header, so they fold behind the BPM chip.
  const [toolsOpen, setToolsOpen] = useState(false)

  function tap() {
    const now = performance.now() / 1000
    // A gap this long means a fresh attempt, not a continuation.
    if (taps.current.length && now - taps.current[taps.current.length - 1] > 2) taps.current = []
    taps.current.push(now)
    setTapping(true)
    const bpm = bpmFromTaps(taps.current)
    if (bpm) updateSegment(segment.id, { bpm })
  }

  const nudgeAnchor = (by: number) => updateSegment(segment.id, { anchor: segment.anchor + by })
  const nudgeTransition = (by: number) =>
    updateSegment(segment.id, { transitionIn: Math.max(0, Number((segment.transitionIn + by).toFixed(2))) })

  return (
    <div className="seg-head" onPointerDown={onSelect} style={{ opacity: selected ? 1 : 0.85 }}>
      <input
        className="seg-title"
        value={segment.name}
        onChange={(e) => updateSegment(segment.id, { name: e.target.value }, `segment-name-${segment.id}`)}
      />

      <button className={`sm only-narrow${toolsOpen ? ' on' : ''}`} onClick={() => setToolsOpen(!toolsOpen)}>
        <i className="ph ph-metronome i" /> {segment.bpm} BPM
      </button>

      <button className="sm" onClick={onEditLyrics}>
        <i className="ph ph-microphone-stage i" /> {segment.lyrics.length ? `${segment.lyrics.length} lines` : 'Lyrics'}
      </button>

      {removable && (
        <button
          className="ghost sm icon"
          title="Delete this song and its moves"
          onClick={() => removeSegment(segment.id)}
          style={{ color: 'var(--danger)' }}
        >
          <i className="ph ph-trash" />
        </button>
      )}

      <div className={`seg-tools${toolsOpen ? ' open' : ''}`}>
        <span className="chip mono">
          {formatTime(segment.start)} - {formatTime(end)}
        </span>

        <span className="chip">
          BPM
          <input
            className="mono"
            type="number"
            step="0.1"
            inputMode="decimal"
            value={segment.bpm}
            onChange={(e) => updateSegment(segment.id, { bpm: Number(e.target.value) || segment.bpm })}
            style={{ width: 58 }}
          />
        </span>
        <button className="sm" onClick={() => updateSegment(segment.id, { bpm: segment.bpm / 2 })} title="Halve the tempo">
          ÷2
        </button>
        <button className="sm" onClick={() => updateSegment(segment.id, { bpm: segment.bpm * 2 })} title="Double the tempo">
          ×2
        </button>
        <button className={`sm${tapping ? ' on' : ''}`} onClick={tap} title="Tap 4+ times on the beat">
          <i className="ph ph-hand-tap i" /> Tap tempo
        </button>

        <span className="chip mono" title="Time of count 1">
          1 @ {segment.anchor.toFixed(2)}s
        </span>
        <button className="ghost sm icon" onClick={() => nudgeAnchor(-0.01)} title="Downbeat 10ms earlier">
          <i className="ph ph-caret-left" />
        </button>
        <button className="ghost sm icon" onClick={() => nudgeAnchor(0.01)} title="Downbeat 10ms later">
          <i className="ph ph-caret-right" />
        </button>
        <button
          className="sm"
          onClick={() => {
            updateSegment(segment.id, { anchor: audio.el.currentTime })
            flash('Downbeat set to the playhead')
          }}
          title="Play, then hit this exactly on a count 1"
        >
          <i className="ph ph-crosshair i" /> Set the 1
        </button>

        <span className="chip">
          Count in
          <input
            className="mono"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={segment.countsPerRow}
            onChange={(e) =>
              updateSegment(segment.id, { countsPerRow: Math.max(1, Math.round(Number(e.target.value)) || segment.countsPerRow) })
            }
            style={{ width: 42 }}
          />
        </span>

        {!first && (
          <>
            <span className="chip mono" title="Seconds of blend before this song takes over">
              Transition {segment.transitionIn.toFixed(1)}s
            </span>
            <button className="ghost sm icon" onClick={() => nudgeTransition(-0.5)} title="Shorten the transition by 0.5s">
              <i className="ph ph-caret-left" />
            </button>
            <button className="ghost sm icon" onClick={() => nudgeTransition(0.5)} title="Lengthen the transition by 0.5s">
              <i className="ph ph-caret-right" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
