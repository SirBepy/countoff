import { useState } from 'react'
import { audio, useAudio } from '../lib/audio'
import { beatToTime, formatTime } from '../lib/grid'
import { nowState } from '../lib/now'
import { set, useStore } from '../lib/store'
import type { Project } from '../lib/types'

const RATES = [0.6, 0.75, 0.9, 1]

export default function Transport({ project }: { project: Project }) {
  const { time, duration, playing, rate, loop, metronome } = useAudio()
  const selection = useStore((s) => s.selection)
  const follow = useStore((s) => s.follow)
  const view = useStore((s) => s.view)
  const [open, setOpen] = useState(false)
  const now = nowState(project, time)

  function toggleLoop() {
    if (loop) return audio.setLoop(null)
    if (!selection) return
    const segment = project.segments.find((s) => s.id === selection.segmentId)
    if (!segment) return
    audio.setLoop({
      from: beatToTime(segment, selection.startBeat),
      to: beatToTime(segment, selection.startBeat + selection.beats),
    })
    audio.seek(beatToTime(segment, selection.startBeat))
  }

  return (
    <div className="transport">
      <div className="transport-main">
        <button className="icon only-wide" onClick={() => audio.nudge(-5)} title="Back 5s">
          <i className="ph ph-rewind" />
        </button>
        <button className="primary icon" onClick={() => audio.toggle()} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
          <i className={`ph ${playing ? 'ph-pause' : 'ph-play'}`} style={{ fontSize: 19 }} />
        </button>
        <button className="icon only-wide" onClick={() => audio.nudge(5)} title="Forward 5s">
          <i className="ph ph-fast-forward" />
        </button>

        <span className="mono faint" style={{ fontSize: 12, flex: 'none' }}>
          {formatTime(time)}
          <span className="only-wide"> / {formatTime(duration)}</span>
        </span>

        <div className="pulse">
          {Array.from({ length: now.segment?.countsPerRow ?? 8 }, (_, i) => (
            <i key={i} className={`${i === 0 ? 'one ' : ''}${playing && now.countInRow === i ? 'on' : ''}`} />
          ))}
        </div>

        <div className="now-move">
          <div className="label">Now</div>
          <div className="value">{now.move?.name ?? '-'}</div>
          {now.block?.note && <div className="value faint">{now.block.note}</div>}
        </div>
        <div className="now-move only-wide">
          <div className="label">Next{now.beatsUntilNext ? ` in ${now.beatsUntilNext}` : ''}</div>
          <div className="value faint">{now.next?.name ?? '-'}</div>
        </div>

        <div className="spacer only-wide" />

        <button className="primary" onClick={() => set({ view: view === 'sheet' ? 'rehearse' : 'sheet' }, false)} title="Rehearse (R)">
          <i className="ph ph-projector-screen i" />
          <span className="only-wide">Rehearse</span>
        </button>
        <button className={`icon only-narrow${open ? ' on' : ''}`} onClick={() => setOpen(!open)} title="More controls">
          <i className={`ph ${open ? 'ph-caret-down' : 'ph-caret-up'}`} />
        </button>
      </div>

      <div className={`transport-more${open ? ' open' : ''}`}>
        <button className="only-narrow" onClick={() => set({ libraryOpen: true }, false)}>
          <i className="ph ph-person-simple-walk i" /> Moves
        </button>
        <button className={metronome ? 'on' : ''} onClick={() => audio.setMetronome(!metronome)} title="Click every beat, accent on the 1">
          <i className="ph ph-metronome i" /> Click
        </button>
        <button className={loop ? 'on' : ''} onClick={toggleLoop} disabled={!selection && !loop} title="Loop the selected counts">
          <i className="ph ph-repeat i" /> Loop
        </button>
        <button className={follow ? 'on' : ''} onClick={() => set({ follow: !follow }, false)} title="Scroll the sheet to the playing 8-count">
          <i className="ph ph-crosshair-simple i" /> Follow
        </button>
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
