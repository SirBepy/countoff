import { useRef } from 'react'
import { audio, useAudio } from '../lib/audio'
import { formatTime, segmentEnd } from '../lib/grid'
import { MARKER_COLOUR, MARKER_ICON, markAt, splitSongAt } from '../lib/markers'
import { beginGesture, endGesture, removeSegment, updateMarker, updateSegment } from '../lib/store'
import type { Marker, Project, Segment } from '../lib/types'

const SEG_COLOURS = ['#2a3350', '#3a2a4e', '#2a4340', '#4a3428', '#402a3a', '#28384a']

interface Props {
  project: Project
  selectedSegmentId: string | null
  onSelectSegment: (id: string) => void
  onEditMarker: (id: string) => void
}

export default function SongMap({ project, selectedSegmentId, onSelectSegment, onEditMarker }: Props) {
  const { time } = useAudio()
  const track = useRef<HTMLDivElement>(null)
  const duration = project.duration || 1

  const pct = (t: number) => `${(t / duration) * 100}%`
  const timeAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration))
  }

  /**
   * Returns a pointerdown handler that drags along the track, then reports whether it moved.
   * `gestureKey` scopes every `onMove` mutation into one undo entry for the whole drag.
   */
  function dragOnTrack(gestureKey: string, onMove: (time: number, key: string) => void, onTap?: () => void) {
    return (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      const originX = e.clientX
      let moved = false
      beginGesture(gestureKey)
      const move = (ev: PointerEvent) => {
        if (Math.abs(ev.clientX - originX) > 4) moved = true
        if (moved) onMove(timeAt(ev.clientX), gestureKey)
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        endGesture()
        if (!moved) onTap?.()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    }
  }

  function dragCut(seg: Segment) {
    // Carry the downbeat with the cut so the grid does not jump on every drag.
    const offset = seg.anchor - seg.start
    return dragOnTrack(`cut-${seg.id}`, (start, key) => updateSegment(seg.id, { start, anchor: start + offset }, key))
  }

  return (
    <div className="songmap">
      <div className="row wrap" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Song map</strong>
        <span className="faint mono" style={{ fontSize: 11 }}>
          {formatTime(time)} / {formatTime(duration)}
        </span>
        <div className="spacer" />
        <span className="faint only-wide" style={{ fontSize: 11 }}>
          While it plays, hit <kbd>S</kbd> for a song start
        </span>
        <button className="sm" onClick={() => splitSongAt(audio.el.currentTime)} title="Start a new song at the playhead (S)">
          <i className="ph ph-scissors i" /> Song
        </button>
        <button className="sm" onClick={() => markAt(audio.el.currentTime)} title="Mark a moment at the playhead">
          <i className="ph ph-flag i" /> Mark
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
              <div
                key={`cut-${seg.id}`}
                // Near the end of the track the delete button would sit outside
                // the clipped map and be unreachable, so it flips to the left.
                className={`map-cut${seg.start / duration > 0.88 ? ' flip' : ''}`}
                style={{ left: pct(seg.start) }}
                onPointerDown={dragCut(seg)}
              >
                <button
                  className="ghost cut-x"
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

        <div className="playhead" style={{ left: pct(time) }} />
      </div>

      <div className="map-markers">
        {project.markers.map((marker) => (
          <MarkerPin
            key={marker.id}
            marker={marker}
            left={pct(marker.time)}
            flip={marker.time / duration > 0.78}
            onDrag={dragOnTrack(
              `marker-${marker.id}`,
              (t, key) => updateMarker(marker.id, { time: t }, key),
              () => onEditMarker(marker.id),
            )}
          />
        ))}
        {!project.markers.length && <span className="faint marker-empty">No marks yet.</span>}
      </div>

      <LyricRibbon project={project} time={time} pct={pct} />
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
        <span className="ribbon-empty faint">No lyrics yet. Open a song below and hit "Lyrics".</span>
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
        {next && <span className="faint only-wide">{next.text}</span>}
      </div>
      <div className="playhead" style={{ left: pct(time) }} />
    </div>
  )
}

function MarkerPin({
  marker,
  left,
  flip,
  onDrag,
}: {
  marker: Marker
  left: string
  flip: boolean
  onDrag: (e: React.PointerEvent) => void
}) {
  return (
    <div
      // A pin in the last fifth would run its label off the right edge.
      className={`marker-pin${flip ? ' flip' : ''}`}
      style={{ left }}
      onPointerDown={onDrag}
      title={`${marker.label}. Tap to edit, drag to move.`}
    >
      <i className={`ph ${MARKER_ICON}`} style={{ color: MARKER_COLOUR }} />
      <span className="pin-label">{marker.label}</span>
    </div>
  )
}
