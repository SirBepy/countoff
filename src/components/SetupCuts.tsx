import { useRef } from 'react'
import { audio, useAudio } from '../lib/audio'
import { formatTime, segmentEnd } from '../lib/grid'
import { addSongAt } from '../lib/markers'
import { beginGesture, endGesture, redo, removeSegment, undo, updateSegment, useStore } from '../lib/store'
import type { Project, Segment } from '../lib/types'
import { formatPrecise, TimeField } from './TimeField'

const SEG_COLOURS = ['#2a3350', '#3a2a4e', '#2a4340', '#4a3428', '#402a3a', '#28384a']

/** Where a segment's start is allowed to land: between its neighbours, never crossing them. */
function startBounds(segments: Segment[], index: number, duration: number) {
  const first = index === 0
  const prev = segments[index - 1]
  const next = segments[index + 1]
  const min = first ? 0 : prev.start + 0.01
  const max = next ? next.start - 0.01 : Math.max(min, duration - 0.01)
  return { min, max }
}

/**
 * Step 1: the timeline plus one row per song with its start and end, nothing else.
 * "End" is never its own field - it edits the next song's start, since a song cannot
 * end before the next one begins (Segment has no `end`; see grid.ts's segmentEnd).
 */
export default function SetupCuts({ project }: { project: Project }) {
  const { time } = useAudio()
  const track = useRef<HTMLDivElement>(null)
  const duration = project.duration || 1
  const segments = [...project.segments].sort((a, b) => a.start - b.start)
  const canUndo = useStore((s) => s.canUndo)
  const canRedo = useStore((s) => s.canRedo)

  const pct = (t: number) => `${(t / duration) * 100}%`
  const timeAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration))
  }

  // A field's draft only writes to the store on blur, so blur whatever's focused
  // before undoing/redoing - otherwise the pending value lands back on top right after.
  const commitThenUndo = () => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    undo()
  }
  const commitThenRedo = () => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    redo()
  }

  function dragCut(seg: Segment) {
    // Carry the downbeat with the cut so a later beat-detect pass doesn't jump on drag.
    const offset = seg.anchor - seg.start
    const key = `cut-${seg.id}`
    return (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      let moved = false
      const originX = e.clientX
      beginGesture(key)
      const move = (ev: PointerEvent) => {
        if (Math.abs(ev.clientX - originX) > 4) moved = true
        if (moved) {
          const start = timeAt(ev.clientX)
          updateSegment(seg.id, { start, anchor: start + offset }, key)
        }
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        endGesture()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    }
  }

  return (
    <div className="cuts-step">
      <div className="songmap">
        <div className="row wrap" style={{ marginBottom: 8 }}>
          <strong style={{ fontSize: 13 }}>Timeline</strong>
          <span className="faint mono" style={{ fontSize: 11 }}>
            {formatTime(time)} / {formatTime(duration)}
          </span>
          <div className="spacer" />
          <button className="sm" onClick={() => addSongAt(audio.el.currentTime)} title="Start a new song at the playhead">
            <i className="ph ph-scissors i" /> Cut here
          </button>
        </div>

        <div ref={track} className="map-track" onPointerDown={(e) => audio.seek(timeAt(e.clientX))}>
          {segments.map((seg, i) => (
            <div
              key={seg.id}
              className="map-seg"
              style={{
                left: pct(seg.start),
                width: pct(segmentEnd(segments, i, duration) - seg.start),
                background: SEG_COLOURS[i % SEG_COLOURS.length],
              }}
            >
              <div className="map-seg-name">{seg.name}</div>
            </div>
          ))}

          {segments.map(
            (seg, i) =>
              i > 0 && (
                <div
                  key={`cut-${seg.id}`}
                  className={`map-cut${seg.start / duration > 0.88 ? ' flip' : ''}`}
                  style={{ left: pct(seg.start) }}
                  onPointerDown={dragCut(seg)}
                >
                  <button
                    className="ghost cut-x"
                    title="Remove this song start"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      removeSegment(seg.id)
                    }}
                  >
                    <i className="ph ph-x" />
                  </button>
                </div>
              ),
          )}

          <div className="playhead" style={{ left: pct(time) }} />
        </div>
      </div>

      <div className="setup-head">
        <strong>Cuts</strong>
        <span className="faint" style={{ fontSize: 12 }}>
          {segments.length} song{segments.length === 1 ? '' : 's'}
        </span>
        <div className="spacer" />
        <button className="ghost icon" onClick={commitThenUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          <i className="ph ph-arrow-counter-clockwise i" />
        </button>
        <button className="ghost icon" onClick={commitThenRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z or Ctrl+Y)">
          <i className="ph ph-arrow-clockwise i" />
        </button>
      </div>
      <div className="setup-list">
        {segments.map((segment, i) => {
          const bounds = startBounds(segments, i, duration)
          const next = segments[i + 1]
          const endBounds = next ? startBounds(segments, i + 1, duration) : null
          return (
            <div className="setup-card" key={segment.id}>
              <div className="row">
                <span className="seg-title" style={{ flex: 1 }}>
                  {segment.name}
                </span>
              </div>
              <div className="setup-fields">
                <label className="setup-field">
                  Start
                  <TimeField
                    value={segment.start}
                    min={bounds.min}
                    max={bounds.max}
                    step={0.01}
                    onCommit={(v) => updateSegment(segment.id, { start: v }, `cuts-start-${segment.id}`)}
                    onNudge={(v) => updateSegment(segment.id, { start: v })}
                  />
                </label>
                <label className="setup-field">
                  End
                  {next && endBounds ? (
                    <TimeField
                      value={next.start}
                      min={endBounds.min}
                      max={endBounds.max}
                      step={0.01}
                      onCommit={(v) => updateSegment(next.id, { start: v }, `cuts-start-${next.id}`)}
                      onNudge={(v) => updateSegment(next.id, { start: v })}
                    />
                  ) : (
                    <span className="mono faint">{formatPrecise(duration)}</span>
                  )}
                </label>
              </div>
            </div>
          )
        })}
        {!segments.length && <p className="muted">No songs yet. Play the audio and hit "Cut here".</p>}
      </div>
    </div>
  )
}
