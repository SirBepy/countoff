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
  onSelect: () => void
  onEditLyrics: () => void
}

export default function SegmentHeader({ segment, end, selected, removable, onSelect, onEditLyrics }: Props) {
  const taps = useRef<number[]>([])
  const [tapping, setTapping] = useState(false)

  function tap() {
    const now = performance.now() / 1000
    // A gap this long means a fresh attempt, not a continuation.
    if (taps.current.length && now - taps.current[taps.current.length - 1] > 2) taps.current = []
    taps.current.push(now)
    setTapping(true)
    const bpm = bpmFromTaps(taps.current)
    if (bpm) updateSegment(segment.id, { bpm })
  }

  function setOne() {
    updateSegment(segment.id, { anchor: audio.el.currentTime })
    flash('Downbeat set to the playhead')
  }

  const nudgeAnchor = (by: number) => updateSegment(segment.id, { anchor: segment.anchor + by })

  return (
    <div className="seg-head" onPointerDown={onSelect} style={{ opacity: selected ? 1 : 0.82 }}>
      <input
        className="seg-title"
        value={segment.name}
        onChange={(e) => updateSegment(segment.id, { name: e.target.value })}
        style={{ width: 190, background: 'transparent', border: '1px solid transparent' }}
      />

      <span className="chip mono">
        {formatTime(segment.start)} - {formatTime(end)}
      </span>

      <span className="chip">
        BPM
        <input
          className="mono"
          type="number"
          step="0.1"
          value={segment.bpm}
          onChange={(e) => updateSegment(segment.id, { bpm: Number(e.target.value) || segment.bpm })}
          style={{ width: 62, padding: '0 4px', background: 'transparent', border: 'none' }}
        />
      </span>
      <button className="ghost" onClick={() => updateSegment(segment.id, { bpm: segment.bpm / 2 })} title="Halve the tempo">
        ÷2
      </button>
      <button className="ghost" onClick={() => updateSegment(segment.id, { bpm: segment.bpm * 2 })} title="Double the tempo">
        ×2
      </button>
      <button className={tapping ? 'on' : ''} onClick={tap} title="Tap 4+ times on the beat">
        <i className="ph ph-hand-tap i" /> Tap tempo
      </button>

      <span className="chip mono" title="Time of count 1">
        1 @ {segment.anchor.toFixed(2)}s
      </span>
      <button className="ghost icon" onClick={() => nudgeAnchor(-0.01)} title="Downbeat 10ms earlier">
        <i className="ph ph-caret-left" />
      </button>
      <button className="ghost icon" onClick={() => nudgeAnchor(0.01)} title="Downbeat 10ms later">
        <i className="ph ph-caret-right" />
      </button>
      <button onClick={setOne} title="Play, then hit this exactly on a count 1">
        <i className="ph ph-crosshair i" /> Set the 1
      </button>

      <div className="spacer" />

      <button onClick={onEditLyrics}>
        <i className="ph ph-microphone-stage i" /> {segment.lyrics.length ? `${segment.lyrics.length} lines` : 'Get lyrics'}
      </button>
      {removable && (
        <button
          className="ghost icon"
          title="Delete this song and its moves"
          onClick={() => removeSegment(segment.id)}
          style={{ color: 'var(--danger)' }}
        >
          <i className="ph ph-trash" />
        </button>
      )}
    </div>
  )
}
