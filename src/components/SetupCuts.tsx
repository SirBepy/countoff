import { audio, useAudio } from '../lib/audio'
import { formatTime } from '../lib/grid'
import { addSongAt } from '../lib/markers'
import { redo, undo, updateSegment, useStore } from '../lib/store'
import type { Project, Segment } from '../lib/types'
import { SongTrack, useSongTrack } from './SongTrack'
import { formatPrecise, TimeField } from './TimeField'

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
  const duration = project.duration || 1
  const segments = [...project.segments].sort((a, b) => a.start - b.start)
  const canUndo = useStore((s) => s.canUndo)
  const canRedo = useStore((s) => s.canRedo)
  const { trackRef, pct, timeAt, dragOnTrack } = useSongTrack(duration)

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

        <SongTrack
          trackRef={trackRef}
          pct={pct}
          timeAt={timeAt}
          dragOnTrack={dragOnTrack}
          segments={segments}
          duration={duration}
          time={time}
        />
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
