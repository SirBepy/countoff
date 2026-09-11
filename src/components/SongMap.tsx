import { audio, useAudio } from '../lib/audio'
import { formatTime } from '../lib/grid'
import { MARKER_COLOUR, MARKER_ICON, markAt, splitSongAt } from '../lib/markers'
import { updateMarker } from '../lib/store'
import type { Marker, Project } from '../lib/types'
import { SongTrack, useSongTrack } from './SongTrack'

interface Props {
  project: Project
  selectedSegmentId: string | null
  onSelectSegment: (id: string) => void
  onEditMarker: (id: string) => void
}

export default function SongMap({ project, selectedSegmentId, onSelectSegment, onEditMarker }: Props) {
  const { time } = useAudio()
  const duration = project.duration || 1
  const { trackRef, pct, timeAt, dragOnTrack } = useSongTrack(duration)

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
        <button
          className="sm"
          onClick={() => void splitSongAt(audio.el.currentTime).then((id) => id && onSelectSegment(id))}
          title="Start a new song at the playhead (S)"
        >
          <i className="ph ph-scissors i" /> Song
        </button>
        <button className="sm" onClick={() => markAt(audio.el.currentTime)} title="Mark a moment at the playhead">
          <i className="ph ph-flag i" /> Mark
        </button>
      </div>

      <SongTrack
        trackRef={trackRef}
        pct={pct}
        timeAt={timeAt}
        dragOnTrack={dragOnTrack}
        segments={project.segments}
        duration={duration}
        time={time}
        selectedSegmentId={selectedSegmentId}
        onSelectSegment={onSelectSegment}
        showBpm
      />

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
    // A song is "resolved" once it has lyrics or was explicitly marked as having
    // none; nagging about a fully-instrumental medley is the exact bug this guards.
    const unresolved = project.segments.some((s) => !s.noLyrics && !s.lyrics.length)
    if (!unresolved) return null
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
