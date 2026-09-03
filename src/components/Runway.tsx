import { useLayoutEffect, useMemo, useRef } from 'react'
import { audio } from '../lib/audio'
import { beatDuration, segmentEnd, timeToBeat } from '../lib/grid'
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

  const blocks = useMemo(
    () =>
      project.blocks
        .filter((b) => b.segmentId === segment.id)
        .sort((a, b) => a.startBeat - b.startBeat)
        .map((b) => ({ block: b, move: project.moves.find((m) => m.id === b.moveId) ?? null })),
    [project.blocks, project.moves, segment.id],
  )

  const lyrics = useMemo(
    () =>
      segment.lyrics
        .filter((l) => l.time >= 0)
        .map((l, i, all) => {
          const from = timeToBeat(segment, l.time)
          const next = all[i + 1]
          return { id: l.id, text: l.text, from, to: next ? timeToBeat(segment, next.time) : totalBeats }
        })
        .filter((l) => l.to > l.from),
    [segment, totalBeats],
  )

  const ticks = useMemo(
    () => Array.from({ length: totalBeats }, (_, i) => ({ beat: i, count: (i % segment.countsPerRow) + 1 })),
    [totalBeats, segment.countsPerRow],
  )

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
          {ticks.map((t) => (
            <span
              key={t.beat}
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
          {blocks.map(({ block, move }) => (
            <div
              key={block.id}
              className={`rw-bar ${isComment(block) ? 'comment' : `e${move?.energy ?? 1}`}`}
              style={{ '--sb': block.startBeat, '--nb': block.beats } as React.CSSProperties}
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
