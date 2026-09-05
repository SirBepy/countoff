import { redo, set, undo, updateSegment, useStore } from '../lib/store'
import type { Project, Segment } from '../lib/types'
import { formatPrecise, TimeField } from './TimeField'

interface RowProps {
  segment: Segment
  index: number
  segments: Segment[]
  duration: number
}

/** A cut time is clamped between its neighbours rather than allowed to cross and reorder them. */
function SongRow({ segment, index, segments, duration }: RowProps) {
  const first = index === 0
  const prev = segments[index - 1]
  const next = segments[index + 1]
  const minStart = first ? 0 : prev.start + 0.01
  const maxStart = next ? next.start - 0.01 : Math.max(minStart, duration - 0.01)
  const end = next ? next.start : duration

  return (
    <div className="setup-card">
      <div className="row">
        <input
          className="seg-title"
          style={{ flex: 1 }}
          value={segment.name}
          onChange={(e) => updateSegment(segment.id, { name: e.target.value }, `setup-name-${segment.id}`)}
        />
        <span className="faint mono" style={{ fontSize: 11 }}>
          ends {formatPrecise(end)}
        </span>
      </div>

      <div className="setup-fields">
        <label className="setup-field">
          Cut time
          <TimeField
            value={segment.start}
            min={minStart}
            max={maxStart}
            step={0.01}
            onCommit={(v) => updateSegment(segment.id, { start: v }, `setup-start-${segment.id}`)}
            onNudge={(v) => updateSegment(segment.id, { start: v })}
          />
        </label>

        {!first && (
          <label className="setup-field">
            Transition (s)
            <span className="row" style={{ gap: 4 }}>
              <input
                className="mono"
                type="number"
                step="0.1"
                min={0}
                style={{ width: 64 }}
                value={segment.transitionIn}
                onChange={(e) =>
                  updateSegment(segment.id, { transitionIn: Math.max(0, Number(e.target.value) || 0) }, `setup-transition-${segment.id}`)
                }
              />
              <button
                className="ghost sm icon"
                title="Shorten the transition by 0.5s"
                onClick={() => updateSegment(segment.id, { transitionIn: Math.max(0, Number((segment.transitionIn - 0.5).toFixed(2))) })}
              >
                <i className="ph ph-caret-left" />
              </button>
              <button
                className="ghost sm icon"
                title="Lengthen the transition by 0.5s"
                onClick={() => updateSegment(segment.id, { transitionIn: Math.max(0, Number((segment.transitionIn + 0.5).toFixed(2))) })}
              >
                <i className="ph ph-caret-right" />
              </button>
            </span>
          </label>
        )}

        <label className="setup-field">
          Downbeat
          <span className="row" style={{ gap: 4 }}>
            <input
              className="mono"
              type="number"
              step="0.01"
              style={{ width: 76 }}
              value={segment.anchor}
              onChange={(e) => updateSegment(segment.id, { anchor: Number(e.target.value) || segment.anchor }, `setup-anchor-${segment.id}`)}
            />
            <button
              className="ghost sm icon"
              title="Downbeat 10ms earlier"
              onClick={() => updateSegment(segment.id, { anchor: Number((segment.anchor - 0.01).toFixed(3)) })}
            >
              <i className="ph ph-caret-left" />
            </button>
            <button
              className="ghost sm icon"
              title="Downbeat 10ms later"
              onClick={() => updateSegment(segment.id, { anchor: Number((segment.anchor + 0.01).toFixed(3)) })}
            >
              <i className="ph ph-caret-right" />
            </button>
          </span>
        </label>

        <label className="setup-field">
          Tempo (BPM)
          <input
            className="mono"
            type="number"
            step="0.1"
            style={{ width: 64 }}
            value={segment.bpm}
            onChange={(e) => updateSegment(segment.id, { bpm: Number(e.target.value) || segment.bpm }, `setup-bpm-${segment.id}`)}
          />
        </label>

        <label className="setup-field">
          Count length
          <input
            className="mono"
            type="number"
            min={1}
            step={1}
            style={{ width: 56 }}
            value={segment.countsPerRow}
            onChange={(e) =>
              updateSegment(
                segment.id,
                { countsPerRow: Math.max(1, Math.round(Number(e.target.value)) || segment.countsPerRow) },
                `setup-counts-${segment.id}`,
              )
            }
          />
        </label>
      </div>
    </div>
  )
}

/** Flow steps 1-4 in one re-enterable list. Never a modal: chunk 7 makes this a landing screen. */
export default function SongSetup({ project }: { project: Project }) {
  const segments = [...project.segments].sort((a, b) => a.start - b.start)
  const canUndo = useStore((s) => s.canUndo)
  const canRedo = useStore((s) => s.canRedo)

  // A field's draft (e.g. TimeField) only writes to the store on blur, so blur
  // whatever's focused before undoing/redoing - otherwise that pending value
  // lands back on top right after, and the undo looks like it did nothing.
  const commitThenUndo = () => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    undo()
  }
  const commitThenRedo = () => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    redo()
  }

  return (
    <div className="setup">
      <div className="setup-head">
        <strong>Song setup</strong>
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
        <button onClick={() => set({ view: 'sheet' }, false)}>
          <i className="ph ph-arrow-left i" /> Back to sheet
        </button>
      </div>
      <div className="setup-list">
        {segments.map((segment, i) => (
          <SongRow key={segment.id} segment={segment} index={i} segments={segments} duration={project.duration} />
        ))}
        {!segments.length && <p className="muted">No songs yet.</p>}
      </div>
    </div>
  )
}
