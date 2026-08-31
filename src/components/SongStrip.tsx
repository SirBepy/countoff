import { useAudio } from '../lib/audio'
import { formatTime } from '../lib/grid'
import { nowState } from '../lib/now'
import { set } from '../lib/store'
import type { Project } from '../lib/types'

/** The phone's song map: which song, how fast, how far in, in 41px instead of 155.
 *  Cuts, downbeats and tempo belong to the setup view that already owns them. */
export default function SongStrip({ project }: { project: Project }) {
  const { time, duration, playing } = useAudio()
  const now = nowState(project, time)
  // The element reports 0 until it has metadata, and the project already knows.
  const total = duration || project.duration
  const through = total ? Math.min(1, time / total) : 0

  return (
    <div className="songstrip">
      <div className="songstrip-row">
        <span className={`beat-dot${playing && now.countInRow === 0 ? ' on' : ''}`} />
        <span className="name">{now.segment?.name ?? project.name}</span>
        {now.segment && <span className="meta mono">{Math.round(now.segment.bpm)} BPM</span>}
        <span className="meta mono">
          {formatTime(time)} / {formatTime(total)}
        </span>
        <button className="ghost" title="Song setup: cuts, transitions, downbeats, tempo" onClick={() => set({ view: 'setup' }, false)}>
          <i className="ph ph-sliders-horizontal" />
        </button>
      </div>
      <div className="songstrip-prog">
        <i style={{ width: `${through * 100}%` }} />
      </div>
    </div>
  )
}
