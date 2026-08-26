import { audio, useAudio } from '../lib/audio'
import { beatToTime, formatTime } from '../lib/grid'
import { nowState } from '../lib/now'
import { set, useStore } from '../lib/store'
import type { Project } from '../lib/types'

const RATES = [0.6, 0.75, 0.9, 1]

export default function Transport({ project }: { project: Project }) {
  const { time, duration, playing, rate, loop, metronome } = useAudio()
  const selection = useStore((s) => s.selection)
  const view = useStore((s) => s.view)
  const follow = useStore((s) => s.follow)
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
      <div className="row" style={{ gap: 4 }}>
        <button className="icon" onClick={() => audio.nudge(-5)} title="Back 5s">
          <i className="ph ph-rewind" />
        </button>
        <button className="primary icon" style={{ width: 42, height: 42 }} onClick={() => audio.toggle()} title="Space">
          <i className={`ph ${playing ? 'ph-pause' : 'ph-play'}`} style={{ fontSize: 19 }} />
        </button>
        <button className="icon" onClick={() => audio.nudge(5)} title="Forward 5s">
          <i className="ph ph-fast-forward" />
        </button>
      </div>

      <span className="mono faint" style={{ minWidth: 88 }}>
        {formatTime(time)} / {formatTime(duration)}
      </span>

      <div className="pulse" title="Count in the current 8">
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} className={`${i === 0 ? 'one ' : ''}${playing && now.countInRow === i ? 'on' : ''}`} />
        ))}
      </div>

      <div className="now-move">
        <div className="label">Now</div>
        <div className="value">{now.move?.name ?? '-'}</div>
      </div>
      <div className="now-move" style={{ minWidth: 150 }}>
        <div className="label">Next{now.beatsUntilNext ? ` in ${now.beatsUntilNext}` : ''}</div>
        <div className="value faint">{now.next?.name ?? '-'}</div>
      </div>

      <div className="spacer" />

      <button className={metronome ? 'on' : ''} onClick={() => audio.setMetronome(!metronome)} title="Click on every beat, accent on the 1">
        <i className="ph ph-metronome i" /> Click
      </button>

      <button className={loop ? 'on' : ''} onClick={toggleLoop} disabled={!selection && !loop} title="Loop the selected counts">
        <i className="ph ph-repeat i" /> Loop
      </button>

      <button className={follow ? 'on' : ''} onClick={() => set({ follow: !follow }, false)} title="Scroll the sheet to the playing 8-count">
        <i className="ph ph-crosshair-simple i" /> Follow
      </button>

      <div className="row" style={{ gap: 3 }}>
        <i className="ph ph-gauge i faint" />
        {RATES.map((r) => (
          <button key={r} className={Math.abs(rate - r) < 0.01 ? 'on' : 'ghost'} onClick={() => audio.setRate(r)}>
            {r * 100}%
          </button>
        ))}
      </div>

      <button className="primary" onClick={() => set({ view: view === 'sheet' ? 'rehearse' : 'sheet' }, false)}>
        <i className="ph ph-projector-screen i" /> Rehearse
      </button>
    </div>
  )
}
