import { audio, useAudio } from '../lib/audio'
import { useClip } from '../lib/clips'
import { formatTime } from '../lib/grid'
import { nowState } from '../lib/now'
import { set } from '../lib/store'
import type { Project } from '../lib/types'

export default function Rehearse({ project }: { project: Project }) {
  const { time, playing, metronome, rate } = useAudio()
  const now = nowState(project, time)
  const clip = useClip(now.move?.id ?? null, now.move?.hasClip)

  return (
    <div className="rehearse">
      <div className="row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
        <strong>{now.segment?.name ?? project.name}</strong>
        <span className="faint mono">{formatTime(time)}</span>
        <div className="spacer" />
        <button className={metronome ? 'on' : ''} onClick={() => audio.setMetronome(!metronome)}>
          <i className="ph ph-metronome i" /> Click
        </button>
        <button className={rate < 1 ? 'on' : ''} onClick={() => audio.setRate(rate < 1 ? 1 : 0.75)}>
          <i className="ph ph-gauge i" /> {Math.round(rate * 100)}%
        </button>
        <button onClick={() => set({ view: 'sheet' }, false)}>
          <i className="ph ph-x i" /> Exit
        </button>
      </div>

      <div className="rehearse-main">
        <div className="rehearse-lyric">{now.lyric ?? ' '}</div>
        {clip && <video className="rehearse-clip" src={clip} autoPlay muted loop playsInline />}
        <div className="rehearse-move">{now.move?.name ?? 'Waiting'}</div>
        <div className="pulse">
          {Array.from({ length: 8 }, (_, i) => (
            <i key={i} className={`${i === 0 ? 'one ' : ''}${playing && now.countInRow === i ? 'on' : ''}`} />
          ))}
        </div>
        <div className="rehearse-next">
          {now.next ? `Next: ${now.next.name}${now.beatsUntilNext ? ` in ${now.beatsUntilNext}` : ''}` : 'Last move'}
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'center', gap: 10, padding: 14, borderTop: '1px solid var(--line)' }}>
        <button className="icon" onClick={() => audio.nudge(-10)}>
          <i className="ph ph-rewind" />
        </button>
        <button className="primary icon" style={{ width: 54, height: 54 }} onClick={() => audio.toggle()}>
          <i className={`ph ${playing ? 'ph-pause' : 'ph-play'}`} style={{ fontSize: 22 }} />
        </button>
        <button className="icon" onClick={() => audio.nudge(10)}>
          <i className="ph ph-fast-forward" />
        </button>
      </div>
    </div>
  )
}
