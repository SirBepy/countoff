import { useLayoutEffect, useMemo, useRef } from 'react'
import { audio } from '../lib/audio'
import { beatDuration, beatToTime, segmentEnd, timeToBeat } from '../lib/grid'
import type { Project, Segment } from '../lib/types'
import { isComment } from '../lib/types'

/** NOW is a fixed line and time slides past it, so distance to that line is time.
 *  Geometry is CSS custom properties (--ppb, --head); the only per-frame write is
 *  --beat, and every position, fill and label offset derives from it in CSS. */
export default function Runway({ project, segment, time }: { project: Project; segment: Segment; time: number }) {
  const root = useRef<HTMLDivElement>(null)
  const beat = timeToBeat(segment, time)
  // Read per move rather than captured, so a drag across a cut converts pixels to
  // seconds at the tempo of whichever song is under the head at that moment.
  const live = useRef(segment)
  live.current = segment

  const index = project.segments.indexOf(segment)
  const end = segmentEnd(project.segments, index, project.duration)
  const totalBeats = Math.max(0, Math.ceil((end - segment.anchor) / beatDuration(segment.bpm)))
  const nextSegment = project.segments[index + 1] ?? null

  // A lookahead block is placed by absolute time, since the next song's tempo makes its
  // own startBeat a different physical distance. 30 is the narrow breakpoint's --ppb,
  // so the horizon overshoots on a wide desktop instead of clipping a block early.
  const horizonTime = end + ((window.innerWidth * 1.5) / 30) * beatDuration(segment.bpm)

  const blocks = useMemo(() => {
    const own = project.blocks
      .filter((b) => b.segmentId === segment.id)
      .map((b) => ({ block: b, move: project.moves.find((m) => m.id === b.moveId) ?? null, sb: b.startBeat, nb: b.beats }))
    const ahead = nextSegment
      ? project.blocks
          .filter((b) => b.segmentId === nextSegment.id && beatToTime(nextSegment, b.startBeat) < horizonTime)
          .map((b) => {
            const sb = timeToBeat(segment, beatToTime(nextSegment, b.startBeat))
            const nb = timeToBeat(segment, beatToTime(nextSegment, b.startBeat + b.beats)) - sb
            return { block: b, move: project.moves.find((m) => m.id === b.moveId) ?? null, sb, nb }
          })
      : []
    return [...own, ...ahead].sort((a, b) => a.sb - b.sb)
  }, [project.blocks, project.moves, segment, nextSegment, horizonTime])

  const lyrics = useMemo(() => {
    // A lyric's `time` is already absolute audio time, so a next-song line needs only
    // timeToBeat into this runway's space, no beatToTime step like blocks require.
    const lines = [
      ...segment.lyrics.filter((l) => l.time >= 0),
      ...(nextSegment ? nextSegment.lyrics.filter((l) => l.time >= 0 && l.time < horizonTime) : []),
    ]
    const fallback = nextSegment ? timeToBeat(segment, horizonTime) : totalBeats
    return lines
      .map((l, i) => ({
        id: l.id,
        text: l.text,
        from: timeToBeat(segment, l.time),
        to: lines[i + 1] ? timeToBeat(segment, lines[i + 1].time) : fallback,
      }))
      .filter((l) => l.to > l.from)
  }, [segment, nextSegment, totalBeats, horizonTime])

  const ticks = useMemo(() => {
    const own = Array.from({ length: totalBeats }, (_, i) => ({ beat: i, count: (i % segment.countsPerRow) + 1 }))
    if (!nextSegment) return own
    // Counts past the cut come from the next song's own downbeat and countsPerRow, so
    // the numbers reset to 1 exactly where its own ruler would start.
    const ahead: typeof own = []
    for (let i = 0; beatToTime(nextSegment, i) < horizonTime; i++) {
      ahead.push({ beat: timeToBeat(segment, beatToTime(nextSegment, i)), count: (i % nextSegment.countsPerRow) + 1 })
    }
    return [...own, ...ahead]
  }, [totalBeats, segment, nextSegment, horizonTime])

  useLayoutEffect(() => {
    // The pin keeps the active bar's name beside the playhead, but the name must stay
    // inside its own bar, so CSS needs the label's natural width to cap the offset.
    for (const el of root.current?.querySelectorAll<HTMLElement>('.rw-bar') ?? []) {
      const label = el.querySelector<HTMLElement>('.rw-name')
      if (label) el.style.setProperty('--lw', String(label.scrollWidth))
    }
  }, [blocks])

  useLayoutEffect(() => {
    root.current?.style.setProperty('--beat', String(beat))
  }, [beat])

  /** Drags the strip under the head, film-reel style: left is forward. */
  function scrub(e: React.PointerEvent) {
    const el = root.current
    if (e.button === 2 || !el) return
    // Or the lyric line under the pointer gets selected instead of the strip dragged.
    e.preventDefault()
    const ppb = parseFloat(getComputedStyle(el).getPropertyValue('--ppb')) || 30
    const resume = !audio.el.paused
    if (resume) audio.pause()
    el.classList.add('dragging')
    let lastX = e.clientX
    const move = (ev: PointerEvent) => {
      audio.seek(audio.el.currentTime - ((ev.clientX - lastX) / ppb) * beatDuration(live.current.bpm))
      lastX = ev.clientX
    }
    const stop = () => {
      el.classList.remove('dragging')
      if (resume) audio.play()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  return (
    <div className="runway" ref={root} onPointerDown={scrub} title="Drag to move through the song">
      <div className="rw-ruler">
        <div className="rw-scroll">
          {ticks.map((t, i) => (
            <span
              key={i}
              className={`rw-num${t.count === 1 ? ' one' : ''}`}
              style={{ '--tb': t.beat } as React.CSSProperties}
            >
              {t.count}
            </span>
          ))}
        </div>
      </div>

      <div className="rw-lane">
        <div className="rw-scroll">
          {blocks.map(({ block, move, sb, nb }) => (
            <div
              key={block.id}
              className={`rw-bar ${isComment(block) ? 'comment' : `e${move?.energy ?? 1}`}`}
              style={{ '--sb': sb, '--nb': nb } as React.CSSProperties}
            >
              <span className="rw-spent" />
              <span className="rw-name">{isComment(block) ? block.note : (move?.name ?? '?')}</span>
              {!isComment(block) && (block.note ?? move?.note) && (
                <span className="rw-sub">{block.note ?? move?.note}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {lyrics.length > 0 && (
        <div className="rw-lyrics">
          <div className="rw-scroll">
            {lyrics.map((l) => (
              <span key={l.id} className="rw-lyric" style={{ '--sb': l.from, '--nb': l.to - l.from } as React.CSSProperties}>
                {l.text}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rw-head" />
    </div>
  )
}
