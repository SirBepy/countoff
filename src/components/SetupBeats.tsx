import { useEffect, useRef, useState } from 'react'
import { audio, useAudio } from '../lib/audio'
import { bpmFromTaps, decodeAudioBlob, detectTempo, type TempoResult } from '../lib/bpm'
import { loadAudio } from '../lib/db'
import { formatTime, segmentEnd } from '../lib/grid'
import { flash, updateSegment } from '../lib/store'
import type { Project, Segment } from '../lib/types'
import Waveform from './Waveform'

/** Reused across step re-entries within one tab so flipping Cuts <-> Beats doesn't
 *  re-decode the whole file every time; keyed by project id so switching projects
 *  (or a fresh audio drop, which changes duration/name but not this id) re-decodes. */
let bufferCache: { projectId: string; buffer: AudioBuffer } | null = null

/** Tap-tempo, standalone from SegmentHeader's popover version since this screen
 *  has room to keep it inline. Right-click cancels and restores the pre-tap BPM. */
function TapTempoButton({ segment }: { segment: Segment }) {
  const taps = useRef<number[]>([])
  const [tapping, setTapping] = useState(false)
  const startBpm = useRef<number | null>(null)

  function tap() {
    const now = performance.now() / 1000
    if (!tapping) startBpm.current = segment.bpm
    if (taps.current.length && now - taps.current[taps.current.length - 1] > 2) taps.current = []
    taps.current.push(now)
    setTapping(true)
    const bpm = bpmFromTaps(taps.current)
    if (bpm) updateSegment(segment.id, { bpm })
  }

  function cancel(e: React.MouseEvent) {
    e.preventDefault()
    if (!tapping) return
    const revertTo = startBpm.current
    taps.current = []
    setTapping(false)
    startBpm.current = null
    if (revertTo !== null) updateSegment(segment.id, { bpm: revertTo })
  }

  return (
    <button
      className={`sm${tapping ? ' on' : ''}`}
      onClick={tap}
      onContextMenu={cancel}
      title="Tap 4+ times on the beat. Right-click cancels and restores the BPM."
    >
      <i className="ph ph-hand-tap i" /> Tap tempo
    </button>
  )
}

/** A detection reading, shown as a proposal that only lands on the segment via
 *  Accept - the screen never applies one on its own, so a tempo the dev already
 *  approved is never silently replaced by a re-detect. */
function ProposalPanel({ result, onAccept, onDismiss }: { result: TempoResult; onAccept: () => void; onDismiss: () => void }) {
  if (!result.measurable) {
    return <span className="faint">Too short to detect here - needs at least {result.secondsNeeded}s of audio</span>
  }
  return (
    <span className="row beats-proposal-row" style={{ gap: 6 }}>
      <span className="mono">{result.bpm} BPM detected</span>
      {result.confidence < 0.25 && <span className="faint">low confidence</span>}
      <button className="sm" onClick={onAccept}>
        Accept
      </button>
      <button className="ghost sm icon" title="Dismiss" onClick={onDismiss}>
        <i className="ph ph-x" />
      </button>
    </span>
  )
}

interface SongBeatCardProps {
  segment: Segment
  index: number
  segments: Segment[]
  duration: number
  buffer: AudioBuffer | null
  playhead: number | null
  proposal: TempoResult | undefined
  onDetect: () => void
  onAccept: (result: TempoResult) => void
  onDismiss: () => void
}

function SongBeatCard({ segment, index, segments, duration, buffer, playhead, proposal, onDetect, onAccept, onDismiss }: SongBeatCardProps) {
  const end = segmentEnd(segments, index, duration)

  return (
    <div className="setup-card beats-card">
      <div className="row beats-card-head">
        <span className="seg-title">{segment.name}</span>
        <span className="faint mono" style={{ fontSize: 11 }}>
          {formatTime(segment.start)} - {formatTime(end)}
        </span>
        <div className="spacer" />
        <button className="ghost sm" onClick={onDetect} title="Re-run detection over this song's cut window">
          <i className="ph ph-magic-wand i" /> Detect again
        </button>
      </div>

      <Waveform
        buffer={buffer}
        start={segment.start}
        end={end}
        bpm={segment.bpm}
        anchor={segment.anchor}
        playhead={playhead}
        onSeek={(t) => audio.seek(t)}
      />

      {proposal && <ProposalPanel result={proposal} onAccept={() => onAccept(proposal)} onDismiss={onDismiss} />}

      <div className="row beats-controls" style={{ gap: 16, flexWrap: 'wrap' }}>
        <span className="row beats-nudge" style={{ gap: 4 }}>
          <span className="faint" style={{ fontSize: 11 }}>
            Grid
          </span>
          <button
            className="ghost sm icon"
            title="Slide the grid 10ms earlier"
            onClick={() => updateSegment(segment.id, { anchor: Number((segment.anchor - 0.01).toFixed(3)) })}
          >
            <i className="ph ph-caret-left" />
          </button>
          <span className="mono">{segment.anchor.toFixed(2)}s</span>
          <button
            className="ghost sm icon"
            title="Slide the grid 10ms later"
            onClick={() => updateSegment(segment.id, { anchor: Number((segment.anchor + 0.01).toFixed(3)) })}
          >
            <i className="ph ph-caret-right" />
          </button>
        </span>

        <span className="row beats-nudge" style={{ gap: 4 }}>
          <span className="faint" style={{ fontSize: 11 }}>
            Tempo
          </span>
          <button
            className="ghost sm icon"
            title="Slow the tempo by 0.1 BPM"
            onClick={() => updateSegment(segment.id, { bpm: Number((segment.bpm - 0.1).toFixed(1)) })}
          >
            <i className="ph ph-caret-left" />
          </button>
          <span className="mono">{segment.bpm.toFixed(1)} BPM</span>
          <button
            className="ghost sm icon"
            title="Speed up the tempo by 0.1 BPM"
            onClick={() => updateSegment(segment.id, { bpm: Number((segment.bpm + 0.1).toFixed(1)) })}
          >
            <i className="ph ph-caret-right" />
          </button>
          <TapTempoButton segment={segment} />
        </span>

        <button
          className="sm"
          title="Set the downbeat to the current playhead position"
          onClick={() => {
            updateSegment(segment.id, { anchor: audio.el.currentTime })
            flash('Downbeat set to the playhead')
          }}
        >
          <i className="ph ph-crosshair i" /> Set the 1
        </button>
      </div>
    </div>
  )
}

/**
 * Step 2: detect every song's tempo in one pass, each window closed at the next
 * cut, then let the dev see and fix the grid. Detection only ever produces a
 * proposal (`proposals` state below) - it never touches the segment until Accept
 * is clicked, so a tempo already approved is never silently overwritten by a
 * fresh decode or a re-entry into this step.
 */
export default function SetupBeats({ project }: { project: Project }) {
  const segments = [...project.segments].sort((a, b) => a.start - b.start)
  const { time } = useAudio()
  const [buffer, setBuffer] = useState<AudioBuffer | null>(bufferCache?.projectId === project.id ? bufferCache.buffer : null)
  const [audioState, setAudioState] = useState<'loading' | 'ready' | 'empty' | 'error'>(buffer ? 'ready' : 'loading')
  const [proposals, setProposals] = useState<Record<string, TempoResult>>({})

  useEffect(() => {
    if (bufferCache?.projectId === project.id) {
      setBuffer(bufferCache.buffer)
      setAudioState('ready')
      return
    }
    let cancelled = false
    setAudioState('loading')
    void (async () => {
      const blob = await loadAudio().catch(() => undefined)
      if (cancelled) return
      if (!blob) {
        setAudioState('empty')
        return
      }
      try {
        const decoded = await decodeAudioBlob(blob)
        if (cancelled) return
        bufferCache = { projectId: project.id, buffer: decoded }
        setBuffer(decoded)
        setAudioState('ready')
      } catch {
        if (!cancelled) setAudioState('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [project.id])

  useEffect(() => {
    if (!buffer) return
    // One pass, every window closed at the next cut - the same fix splitSongAt
    // uses, so a full re-detect can never let one song's tail win every other
    // song's autocorrelation (see todo 12). Deliberately keyed only on `buffer`:
    // a later nudge or Accept to a segment must not trigger a silent re-detect.
    const next: Record<string, TempoResult> = {}
    segments.forEach((seg, i) => {
      next[seg.id] = detectTempo(buffer, seg.start, segmentEnd(segments, i, project.duration), seg.start)
    })
    setProposals(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer])

  function detectOne(seg: Segment, i: number) {
    if (!buffer) return
    const result = detectTempo(buffer, seg.start, segmentEnd(segments, i, project.duration), seg.start)
    setProposals((p) => ({ ...p, [seg.id]: result }))
  }

  function dismiss(id: string) {
    setProposals((p) => {
      const rest = { ...p }
      delete rest[id]
      return rest
    })
  }

  function accept(seg: Segment, result: TempoResult) {
    if (!result.measurable) return
    updateSegment(seg.id, { bpm: result.bpm, anchor: result.phase })
    flash(`${seg.name}: tempo set to ${result.bpm} BPM`)
    dismiss(seg.id)
  }

  return (
    <div className="beats">
      <div className="beats-head">
        <strong>Beats</strong>
        <span className="faint" style={{ fontSize: 12 }}>
          {segments.length} song{segments.length === 1 ? '' : 's'}
        </span>
        {audioState === 'loading' && <span className="faint">Decoding audio…</span>}
        {audioState === 'empty' && <span className="faint">No audio yet - manual adjustment still works</span>}
        {audioState === 'error' && <span className="faint">Could not decode the audio</span>}
      </div>
      <div className="setup-list beats-list">
        {segments.map((segment, i) => (
          <SongBeatCard
            key={segment.id}
            segment={segment}
            index={i}
            segments={segments}
            duration={project.duration}
            buffer={buffer}
            playhead={time}
            proposal={proposals[segment.id]}
            onDetect={() => detectOne(segment, i)}
            onAccept={(result) => accept(segment, result)}
            onDismiss={() => dismiss(segment.id)}
          />
        ))}
        {!segments.length && <p className="muted">No songs yet - cut them first on the Cuts step.</p>}
      </div>
    </div>
  )
}
