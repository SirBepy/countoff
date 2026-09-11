import { RefObject, useRef } from 'react'
import { audio } from '../lib/audio'
import { segmentEnd } from '../lib/grid'
import { beginGesture, endGesture, removeSegment, updateSegment } from '../lib/store'
import type { Segment } from '../lib/types'

/** Segment fill colours, cycled by index. Shared so step 1 and the sheet's song map never drift apart. */
export const SEG_COLOURS = ['#2a3350', '#3a2a4e', '#2a4340', '#4a3428', '#402a3a', '#28384a']

export interface SongTrackGeometry {
  trackRef: RefObject<HTMLDivElement>
  pct: (t: number) => string
  timeAt: (clientX: number) => number
  dragOnTrack: (
    gestureKey: string,
    onMove: (time: number, key: string) => void,
    onTap?: () => void,
  ) => (e: React.PointerEvent) => void
}

/**
 * Geometry and drag gesture for anything drawn along the song timeline: the track itself,
 * plus whatever a caller bolts on top (marker pins, the lyric ribbon). Callers needing those
 * extras call this directly so `pct`/`timeAt`/`dragOnTrack` stay usable outside `<SongTrack>`.
 */
export function useSongTrack(duration: number): SongTrackGeometry {
  const trackRef = useRef<HTMLDivElement>(null)
  const pct = (t: number) => `${(t / duration) * 100}%`
  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect()
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

  return { trackRef, pct, timeAt, dragOnTrack }
}

interface SongTrackProps extends SongTrackGeometry {
  segments: Segment[]
  duration: number
  time: number
  /** Omit to leave segment clicks unhandled, so they bubble up to the track's own seek. */
  onSelectSegment?: (id: string) => void
  selectedSegmentId?: string | null
  /** Setup step 1 shows neither the BPM readout nor a selection highlight; the sheet's map shows both. */
  showBpm?: boolean
}

/**
 * The map-seg / map-cut / playhead scaffold shared by setup step 1 (`SetupCuts`) and the sheet's
 * song map (`SongMap`). Marker pins and the lyric ribbon are drawn by the caller around this,
 * not inside it - step 1 deliberately shows neither.
 */
export function SongTrack({
  trackRef,
  pct,
  timeAt,
  dragOnTrack,
  segments,
  duration,
  time,
  onSelectSegment,
  selectedSegmentId,
  showBpm,
}: SongTrackProps) {
  function dragCut(seg: Segment) {
    // Carry the downbeat with the cut so a later beat-detect pass doesn't jump on drag.
    const offset = seg.anchor - seg.start
    return dragOnTrack(`cut-${seg.id}`, (start, key) => updateSegment(seg.id, { start, anchor: start + offset }, key))
  }

  return (
    <div ref={trackRef} className="map-track" onPointerDown={(e) => audio.seek(timeAt(e.clientX))}>
      {segments.map((seg, i) => (
        <div
          key={seg.id}
          className={`map-seg${seg.id === selectedSegmentId ? ' sel' : ''}`}
          style={{
            left: pct(seg.start),
            width: pct(segmentEnd(segments, i, duration) - seg.start),
            background: SEG_COLOURS[i % SEG_COLOURS.length],
          }}
          onPointerDown={
            onSelectSegment &&
            ((e) => {
              e.stopPropagation()
              onSelectSegment(seg.id)
              audio.seek(timeAt(e.clientX))
            })
          }
        >
          <div className="map-seg-name">{seg.name}</div>
          {showBpm && (
            <div className="faint mono" style={{ fontSize: 10 }}>
              {seg.bpm} BPM
            </div>
          )}
        </div>
      ))}

      {segments.map(
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
  )
}
