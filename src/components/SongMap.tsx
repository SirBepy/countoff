import { useRef, useState } from 'react'
import { audio, useAudio } from '../lib/audio'
import { loadAudio } from '../lib/db'
import { formatTime, segmentEnd } from '../lib/grid'
import { MARKER_KINDS, markAt, splitSongAt } from '../lib/markers'
import { suggestTransitions, type Candidate } from '../lib/structure'
import { flash, removeMarker, removeSegment, updateMarker, updateSegment } from '../lib/store'
import type { Marker, MarkerKind, Project, Segment } from '../lib/types'

const SEG_COLOURS = ['#2a3350', '#3a2a4e', '#2a4340', '#4a3428', '#402a3a', '#28384a']

interface Props {
  project: Project
  selectedSegmentId: string | null
  onSelectSegment: (id: string) => void
}

export default function SongMap({ project, selectedSegmentId, onSelectSegment }: Props) {
  const { time } = useAudio()
  const track = useRef<HTMLDivElement>(null)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const duration = project.duration || 1

  const pct = (t: number) => `${(t / duration) * 100}%`
  const timeAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration))
  }

  function dragOnTrack(onMove: (time: number) => void) {
    return (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      const move = (ev: PointerEvent) => onMove(timeAt(ev.clientX))
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
  }

  function dragCut(seg: Segment) {
    // Carry the downbeat with the cut so the grid does not jump on every drag.
    const offset = seg.anchor - seg.start
    return dragOnTrack((start) => updateSegment(seg.id, { start, anchor: start + offset }))
  }

  async function scan() {
    setScanning(true)
    try {
      const blob = await loadAudio()
      if (!blob) throw new Error('no audio')
      const ctx = new AudioContext()
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
      const found = suggestTransitions(buffer)
      void ctx.close()
      setCandidates(found)
      flash(found.length ? `${found.length} spots where the mix changes` : 'No obvious changes found')
    } catch {
      flash('Could not analyse the audio')
    }
    setScanning(false)
  }

  const dismiss = (c: Candidate) => setCandidates((list) => (list ?? []).filter((x) => x !== c))

  return (
    <div className="songmap">
      <div className="row" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Song map</strong>
        <span className="faint mono" style={{ fontSize: 11 }}>
          {formatTime(time)} / {formatTime(duration)}
        </span>
        <div className="spacer" />
        <span className="faint" style={{ fontSize: 11 }}>
          While it plays, hit <kbd>S</kbd> for a song start, <kbd>T</kbd> transition, <kbd>D</kbd> drop, <kbd>B</kbd> break
        </span>
        <button onClick={() => splitSongAt(audio.el.currentTime)} title="Start a new song at the playhead">
          <i className="ph ph-scissors i" /> Song start
        </button>
        <button onClick={() => markAt(audio.el.currentTime, 'transition')} title="Mark a DJ transition at the playhead">
          <i className="ph ph-arrows-left-right i" /> Transition
        </button>
        <button onClick={scan} disabled={scanning} title="Find where the mix changes loudness">
          <i className={`ph ${scanning ? 'ph-spinner' : 'ph-magic-wand'} i`} /> {scanning ? 'Scanning...' : 'Suggest'}
        </button>
      </div>

      <div ref={track} className="map-track" onPointerDown={(e) => audio.seek(timeAt(e.clientX))}>
        {project.segments.map((seg, i) => (
          <div
            key={seg.id}
            className={`map-seg${seg.id === selectedSegmentId ? ' sel' : ''}`}
            style={{
              left: pct(seg.start),
              width: pct(segmentEnd(project.segments, i, duration) - seg.start),
              background: SEG_COLOURS[i % SEG_COLOURS.length],
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
              onSelectSegment(seg.id)
              audio.seek(timeAt(e.clientX))
            }}
          >
            <div className="map-seg-name">{seg.name}</div>
            <div className="faint mono" style={{ fontSize: 10 }}>
              {seg.bpm} BPM
            </div>
          </div>
        ))}

        {project.segments.map(
          (seg, i) =>
            i > 0 && (
              <div key={`cut-${seg.id}`} className="map-cut" style={{ left: pct(seg.start) }} onPointerDown={dragCut(seg)}>
                <button
                  className="ghost icon cut-x"
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

        {candidates?.map((c, i) => (
          <div key={`cand-${i}`} className="map-candidate" style={{ left: pct(c.time) }} title={`Possible ${c.reason}`} />
        ))}

        <div className="playhead" style={{ left: pct(time) }} />
      </div>

      <div className="map-markers">
        {project.markers.map((marker) => (
          <MarkerPin key={marker.id} marker={marker} left={pct(marker.time)} onDrag={dragOnTrack((t) => updateMarker(marker.id, { time: t }))} />
        ))}
        {!project.markers.length && <span className="faint marker-empty">No transitions marked yet.</span>}
      </div>

      <LyricRibbon project={project} time={time} pct={pct} />

      {candidates && candidates.length > 0 && (
        <div className="candidates">
          <span className="faint" style={{ fontSize: 11 }}>
            Suggested changes. Loudness only, so check each one by ear:
          </span>
          {candidates.map((c, i) => (
            <span key={i} className="chip candidate-chip">
              <button className="ghost" onClick={() => audio.seek(Math.max(0, c.time - 2))} title="Listen from just before">
                <i className="ph ph-play i" /> {formatTime(c.time)}
              </button>
              <button
                onClick={() => {
                  const id = splitSongAt(c.time)
                  if (id) onSelectSegment(id)
                  dismiss(c)
                }}
              >
                Song start
              </button>
              <button
                onClick={() => {
                  markAt(c.time, c.reason === 'drop' ? 'drop' : 'transition')
                  dismiss(c)
                }}
              >
                {c.reason === 'drop' ? 'Drop' : 'Transition'}
              </button>
              <button className="ghost icon" onClick={() => dismiss(c)} title="Not a change">
                <i className="ph ph-x" />
              </button>
            </span>
          ))}
          <button className="ghost" onClick={() => setCandidates(null)}>
            Dismiss all
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * 59 lyric lines drawn as text across four minutes is an unreadable smear, so
 * the ribbon shows density as ticks and spells out only the line being sung.
 */
function LyricRibbon({ project, time, pct }: { project: Project; time: number; pct: (t: number) => string }) {
  const lines = project.segments.flatMap((s) => s.lyrics.filter((l) => l.time >= 0)).sort((a, b) => a.time - b.time)
  if (!lines.length) {
    return (
      <div className="map-lyrics">
        <span className="ribbon-empty faint">No lyrics yet. Open a song below and hit "Get lyrics".</span>
      </div>
    )
  }

  const index = lines.findLastIndex((l) => l.time <= time)
  const current = lines[index]
  const next = lines[index + 1]

  return (
    <div className="map-lyrics" title="Every lyric line as a tick, with the current line spelled out">
      {lines.map((line, i) => (
        <div key={i} className={`lyric-tick${i === index ? ' now' : ''}`} style={{ left: pct(line.time) }} />
      ))}
      <div className="ribbon-text">
        <strong>{current?.text ?? '...'}</strong>
        {next && <span className="faint">{next.text}</span>}
      </div>
      <div className="playhead" style={{ left: pct(time) }} />
    </div>
  )
}

function MarkerPin({ marker, left, onDrag }: { marker: Marker; left: string; onDrag: (e: React.PointerEvent) => void }) {
  const [editing, setEditing] = useState(false)
  const meta = MARKER_KINDS[marker.kind]
  const kinds = Object.keys(MARKER_KINDS) as MarkerKind[]

  return (
    <div className="marker-pin" style={{ left, borderColor: meta.colour }} onPointerDown={onDrag}>
      <button
        className="ghost icon kind-cycle"
        title={`${meta.label}. Click to change kind.`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          const next = kinds[(kinds.indexOf(marker.kind) + 1) % kinds.length]
          updateMarker(marker.id, { kind: next, label: marker.label === meta.label ? MARKER_KINDS[next].label : marker.label })
        }}
      >
        <i className={`ph ${meta.icon}`} style={{ color: meta.colour }} />
      </button>
      {editing ? (
        <input
          autoFocus
          defaultValue={marker.label}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            updateMarker(marker.id, { label: e.target.value })
            setEditing(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          style={{ width: 96, padding: '0 3px', height: 17 }}
        />
      ) : (
        <span onPointerDown={(e) => e.stopPropagation()} onClick={() => setEditing(true)} title="Click to rename, drag the pin to move it">
          {marker.label}
        </span>
      )}
      <button
        className="ghost icon kind-cycle"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => removeMarker(marker.id)}
        title="Delete marker"
      >
        <i className="ph ph-x" style={{ fontSize: 10 }} />
      </button>
    </div>
  )
}
