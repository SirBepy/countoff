import { useState } from 'react'
import { audio, useAudio } from '../lib/audio'
import { beatToTime, formatTime } from '../lib/grid'
import { markAt, splitSongAt } from '../lib/markers'
import { nowState } from '../lib/now'
import { removeBlocks, set, useStore } from '../lib/store'
import type { Project } from '../lib/types'
import MeasureBpm from './MeasureBpm'

const RATES = [0.6, 0.75, 0.9, 1]

/** The only bar: with counts selected it swaps its middle for the fill action
 *  rather than stacking a second bar that buries it on a phone. */
export default function BottomBar({ project, onNewSegment }: { project: Project; onNewSegment: (id: string) => void }) {
  const { time, duration, playing, rate, loop, metronome } = useAudio()
  const selection = useStore((s) => s.selection)
  const follow = useStore((s) => s.follow)
  const view = useStore((s) => s.view)
  const [open, setOpen] = useState(false)
  const now = nowState(project, time)
  // The element reports 0 until it has metadata, and the project already knows.
  const total = duration || project.duration

  const segment = selection && project.segments.find((s) => s.id === selection.segmentId)
  const covered = selection
    ? project.blocks.filter(
        (b) =>
          b.segmentId === selection.segmentId &&
          b.startBeat < selection.startBeat + selection.beats &&
          b.startBeat + b.beats > selection.startBeat,
      )
    : []

  function toggleLoop() {
    if (loop) return audio.setLoop(null)
    if (!selection || !segment) return
    audio.setLoop({
      from: beatToTime(segment, selection.startBeat),
      to: beatToTime(segment, selection.startBeat + selection.beats),
    })
    audio.seek(beatToTime(segment, selection.startBeat))
  }

  return (
    <div className={`bar${selection ? ' selecting' : ''}`}>
      <div className="bar-main">
        <button className="icon only-wide" onClick={() => audio.nudge(-5)} title="Back 5s">
          <i className="ph ph-rewind" />
        </button>
        <button className="primary bar-play" onClick={() => audio.toggle()} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
          <i className={`ph ${playing ? 'ph-pause' : 'ph-play'}`} />
        </button>
        <button className="icon only-wide" onClick={() => audio.nudge(5)} title="Forward 5s">
          <i className="ph ph-fast-forward" />
        </button>

        <span className="mono faint only-wide" style={{ fontSize: 12, flex: 'none' }}>
          {formatTime(time)} / {formatTime(total)}
        </span>

        <div className="bar-now">
          <div className="pulse">
            {Array.from({ length: now.segment?.countsPerRow ?? 8 }, (_, i) => (
              <i key={i} className={`${i === 0 ? 'one ' : ''}${playing && now.countInRow === i ? 'on' : ''}`} />
            ))}
          </div>
          <div className="label">
            Now{now.next ? ` · next: ${now.next.name}${now.beatsUntilNext ? ` in ${now.beatsUntilNext}` : ''}` : ''}
          </div>
          <div className="value">
            {now.move?.name ?? '-'}
            {now.block?.note && <span className="faint"> {now.block.note}</span>}
          </div>
        </div>

        {selection && (
          <>
            <button className="primary bar-fill" onClick={() => set({ libraryOpen: true }, false)}>
              <i className="ph ph-person-simple-walk i" /> Fill {selection.beats} {selection.beats === 1 ? 'count' : 'counts'}
            </button>
            <button className="bar-btn ghost" title="Deselect" onClick={() => set({ selection: null }, false)}>
              <i className="ph ph-x" />
            </button>
          </>
        )}

        <button
          className={`bar-btn only-narrow${open ? ' on' : ''}`}
          onClick={() => setOpen(!open)}
          title="More controls"
        >
          <i className="ph ph-dots-three" />
        </button>
      </div>

      <div className={`bar-more${open ? ' open' : ''}`}>
        <button className="sm" onClick={() => set({ view: view === 'sheet' ? 'rehearse' : 'sheet' }, false)} title="Rehearse (R)">
          <i className="ph ph-projector-screen i" /> Rehearse
        </button>
        <button className="sm only-narrow" onClick={() => set({ libraryOpen: true }, false)}>
          <i className="ph ph-person-simple-walk i" /> Moves
        </button>
        <button className={`sm${metronome ? ' on' : ''}`} onClick={() => audio.setMetronome(!metronome)} title="Click every beat, accent on the 1">
          <i className="ph ph-metronome i" /> Click
        </button>
        <button className={`sm${loop ? ' on' : ''}`} onClick={toggleLoop} disabled={!selection && !loop} title="Loop the selected counts">
          <i className="ph ph-repeat i" /> Loop
        </button>
        <button className={`sm${follow ? ' on' : ''}`} onClick={() => set({ follow: !follow }, false)} title="Scroll the sheet to the playing 8-count">
          <i className="ph ph-crosshair-simple i" /> Follow
        </button>
        <button
          className="sm only-narrow"
          onClick={() => void splitSongAt(audio.el.currentTime).then((id) => id && onNewSegment(id))}
          title="Start a new song at the playhead (S)"
        >
          <i className="ph ph-scissors i" /> Song
        </button>
        <button className="sm only-narrow" onClick={() => markAt(audio.el.currentTime)} title="Mark a moment at the playhead">
          <i className="ph ph-flag i" /> Mark
        </button>
        {selection && (
          <button
            className="sm"
            disabled={!covered.length}
            title="Clear the moves in this selection"
            onClick={() => removeBlocks(covered.map((b) => b.id))}
          >
            <i className="ph ph-eraser i" /> Erase
          </button>
        )}
        {selection && segment && <MeasureBpm segment={segment} selection={selection} />}
        <span className="row" style={{ gap: 3 }}>
          <i className="ph ph-gauge i faint" />
          {RATES.map((r) => (
            <button key={r} className={`sm${Math.abs(rate - r) < 0.01 ? ' on' : ''}`} onClick={() => audio.setRate(r)}>
              {r * 100}%
            </button>
          ))}
        </span>
      </div>
    </div>
  )
}
