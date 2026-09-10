import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { clipAt, warmClips } from '../lib/video'
import type { Project, Take } from '../lib/types'

/** Past this the footage is visibly off the count, so seek instead of easing it back. */
const HARD_DRIFT = 0.3
/** Under this the two clocks agree closely enough that any correction reads as a stutter. */
const SOFT_DRIFT = 0.04
/** How hard the soft correction pulls. 4% closes a tenth of a second inside three seconds. */
const NUDGE = 0.04

interface Props {
  project: Project
  /** Audio time to show. The audio element is the clock; this element only follows it. */
  time: number
  playing: boolean
  rate: number
  /** Rendered over the video, for the badges each screen wants on top of it. */
  children?: React.ReactNode
}

/** One element of the pool: the clip on screen, or a cut still to come parked on its frame. */
interface Slot {
  clipId: string
  take: Take
  src: string
  /** Where the element is parked from its own load event. */
  at: number
  local: boolean
  on: boolean
}

/**
 * The footage, slaved to the audio. It is always muted: the song is already playing,
 * and a take filmed in the room carries the same music a beat or two out.
 *
 * Every clip in the pool has its own element, keyed by clip, and a cut is the next
 * clip's wrapper becoming the visible one. The element behind it was mounted a cut
 * earlier and parked on its opening frame, so nothing loads, seeks or decodes at the
 * moment the song crosses the cut. Swapping one element's src instead cost every cut a
 * reload, even from footage the browser already held.
 */
export default function VideoStage({ project, time, playing, rate, children }: Props) {
  const els = useRef(new Map<string, HTMLVideoElement>())
  // Dance footage is as often shot portrait as landscape, and the layout wants the box
  // to fit the film rather than letterbox it, so the real ratio drives the CSS.
  const [nativeRatio, setNativeRatio] = useState(16 / 9)
  const takeUrls = useStore((s) => s.takeUrls)
  const viewAs = useStore((s) => s.viewAs)
  const showing = clipAt(project, time, takeUrls, viewAs)
  const target = showing?.srcTime ?? 0
  const crop = showing?.take.crop
  const ratio = crop ? (nativeRatio * crop.w) / crop.h : nativeRatio

  // Once a second rather than once a frame: `time` advances every animation frame, and
  // which clips are coming up cannot change faster than the song does.
  const second = Math.floor(time)
  const warm = useMemo(
    () => warmClips(project, second, takeUrls, viewAs, showing?.clip.id),
    [project, second, takeUrls, viewAs, showing?.clip.id],
  )

  const slots: Slot[] = [
    ...(showing
      ? [{ clipId: showing.clip.id, take: showing.take, src: showing.src, at: target, local: showing.take.id in takeUrls, on: true }]
      : []),
    ...warm.flatMap((w) => {
      const take = project.takes.find((t) => t.id === w.takeId)
      return take ? [{ clipId: w.clipId, take, src: w.src, at: w.at, local: w.local, on: false }] : []
    }),
  ]

  // No dependency array on purpose: `time` advances every animation frame while the
  // song plays, and this is the correction that keeps the two elements together.
  useEffect(() => {
    for (const [id, v] of els.current) if (id !== showing?.clip.id && !v.paused) v.pause()
    const v = showing && els.current.get(showing.clip.id)
    if (!v || v.readyState === 0) return
    if (playing && v.paused) void v.play().catch(() => {})
    if (!playing && !v.paused) v.pause()
    // A seek still in flight reports its own target as currentTime, so a slow link reads
    // as drift a frame later and a second seek would abort the fetch the first one started.
    // Repeated every frame, that is footage that never lands: the range request is cancelled
    // every 0.3s of song. The correction waits for the seek to finish and then measures again.
    if (v.seeking) return
    const drift = target - v.currentTime
    if (Math.abs(drift) > HARD_DRIFT) v.currentTime = target
    else if (playing && Math.abs(drift) > SOFT_DRIFT) v.playbackRate = rate * (1 + Math.sign(drift) * NUDGE)
    else v.playbackRate = rate
  })

  // A cut onto an element that already has its metadata fires no load event, so the
  // box's ratio is read off it here rather than only in onMeta.
  useEffect(() => {
    const v = showing && els.current.get(showing.clip.id)
    if (v?.videoWidth && v.videoHeight) setNativeRatio(v.videoWidth / v.videoHeight)
  }, [showing?.clip.id])

  // Assigning currentTime before the element has metadata is dropped on the floor, so
  // each element is parked from its own load event: the one on screen on the song's
  // instant, a waiting one on the frame its cut opens with. Rehearse holds .vstage to a
  // fixed 9/16 box, so a crop rect's own shape comes from a wrapper sized to IT.
  const onMeta = (v: HTMLVideoElement, slot: Slot) => {
    v.currentTime = slot.at
    if (slot.on && v.videoWidth && v.videoHeight) setNativeRatio(v.videoWidth / v.videoHeight)
  }

  return (
    <div className={`vstage${showing ? '' : ' is-gap'}`} style={{ '--ar': ratio } as React.CSSProperties}>
      {!showing && (
        <div className="vstage-gap">
          <i className="ph ph-film-slate" />
          <span>{project.takes.length ? 'No clip on this count' : 'No footage yet'}</span>
        </div>
      )}
      {slots.map((slot) => {
        const c = slot.on ? slot.take.crop : undefined
        // The crop rect maps onto the frame by scaling the video up by 1/w, 1/h and pulling
        // it back by the crop's own offset, so only that rect ever lands inside the box.
        const cropStyle: React.CSSProperties | undefined = c
          ? {
              position: 'absolute',
              width: `${100 / c.w}%`,
              height: `${100 / c.h}%`,
              left: `${(-100 * c.x) / c.w}%`,
              top: `${(-100 * c.y) / c.h}%`,
            }
          : undefined
        return (
          <div key={slot.clipId} className={slot.on ? (c ? 'vstage-crop' : 'vstage-on') : 'vstage-warm'} style={c ? { aspectRatio: ratio } : undefined}>
            {/* A take this device does not hold asks for its metadata only, and the park
                above fetches the one region its cut opens on: with preload="auto" Chrome
                pulls the whole file, and a paused warm-up downloading megabytes is what
                starved the clip actually playing. */}
            <video
              ref={(v) => (v ? els.current.set(slot.clipId, v) : els.current.delete(slot.clipId))}
              className="vstage-el"
              src={slot.src}
              muted
              playsInline
              preload={slot.on || slot.local ? 'auto' : 'metadata'}
              aria-hidden={!slot.on}
              style={cropStyle}
              onLoadedMetadata={(e) => onMeta(e.currentTarget, slot)}
            />
          </div>
        )
      })}
      {children}
    </div>
  )
}
