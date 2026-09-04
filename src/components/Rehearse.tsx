import { useState } from 'react'
import { audio, useAudio } from '../lib/audio'
import { standingAt } from '../lib/floor'
import { formatTime } from '../lib/grid'
import { nowState } from '../lib/now'
import { set } from '../lib/store'
import type { Project } from '../lib/types'
import FloorStage from './FloorStage'
import Runway from './Runway'
import VideoStage from './VideoStage'

export default function Rehearse({
  project,
  commentToken,
  onComments,
}: {
  project: Project
  commentToken?: string | null
  onComments?: () => void
}) {
  const { time, playing, metronome, rate } = useAudio()
  const [videoOff, setVideoOff] = useState(false)
  const now = nowState(project, time)
  // No cast means an empty grid, which would take the centre of the screen and say nothing.
  const walking = project.people.filter((p) => {
    const at = standingAt(project, p.id, time)
    return at && at.progress < 1
  })
  const walkingLabel = walking.length > 0 ? `${walking.map((p) => p.name).join(', ')} moving` : ''
  // Footage is what earns the video layout. With none, the move name keeps the centre
  // it was deliberately given, and this screen is exactly what it always was.
  const hasVideo = project.clips.length > 0 && !videoOff
  // A block with no move is a comment, and its text IS the headline: titling it "Note"
  // spends the biggest type on the screen saying nothing and pushes the words below.
  const comment = !now.move && now.block?.note ? now.block.note : ''
  const moveName = now.move?.name ?? (comment || 'Waiting')
  const note = comment ? '' : (now.block?.note ?? '')

  const pulse = (
    <div className="pulse">
      {Array.from({ length: now.segment?.countsPerRow ?? 8 }, (_, i) => (
        <i key={i} className={`${i === 0 ? 'one ' : ''}${playing && now.countInRow === i ? 'on' : ''}`} />
      ))}
    </div>
  )

  return (
    <div className={`rehearse${hasVideo ? ' has-video' : ''}`}>
      <div className="row rehearse-top" style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
        <strong>{now.segment?.name ?? project.name}</strong>
        <span className="faint mono">{formatTime(time)}</span>
        <div className="spacer" />
        <button className={metronome ? 'on' : ''} onClick={() => audio.setMetronome(!metronome)}>
          <i className="ph ph-metronome i" /> <span className="lbl">Click</span>
        </button>
        <button className={rate < 1 ? 'on' : ''} onClick={() => audio.setRate(rate < 1 ? 1 : 0.75)}>
          <i className="ph ph-gauge i" /> <span className="lbl">{Math.round(rate * 100)}%</span>
        </button>
        {project.clips.length > 0 && (
          <button className={hasVideo ? 'on' : ''} onClick={() => setVideoOff(!videoOff)} title="Show the footage instead of the move name">
            <i className="ph ph-video i" /> <span className="lbl">Video</span>
          </button>
        )}
        {commentToken && (
          <button onClick={onComments} title="Read or leave a comment on this link">
            <i className="ph ph-chat-circle-text i" /> <span className="lbl">Comments</span>
          </button>
        )}
        <button onClick={() => set({ view: 'sheet' }, false)}>
          <i className="ph ph-x i" /> <span className="lbl">Exit</span>
        </button>
      </div>

      {hasVideo && (
        <div className="rehearse-band">
          <span className="nm">{moveName}</span>
          <span className={`nt${note ? '' : ' is-empty'}`}>{note}</span>
          {now.next && (
            <span className="nx">
              next in {now.beatsUntilNext}
              <b>{now.next.name}</b>
            </span>
          )}
        </div>
      )}

      <div className="rehearse-main">
        {project.people.length > 0 && (
          <div className="rehearse-floor">
            <div className={`rehearse-floor-name${walkingLabel ? '' : ' is-empty'}`}>{walkingLabel}</div>
            <FloorStage project={project} time={time} editable={false} />
          </div>
        )}
        {hasVideo ? (
          <VideoStage project={project} time={time} playing={playing} rate={rate} />
        ) : (
          <div className="rehearse-centre">
            <div className="rehearse-move">{moveName}</div>
            <div className={`rehearse-note${note ? '' : ' is-empty'}`}>{note}</div>
            {pulse}
          </div>
        )}
      </div>

      {hasVideo && pulse}

      {now.segment && <Runway project={project} segment={now.segment} time={time} />}

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
