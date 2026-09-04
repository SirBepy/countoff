import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { clipAt } from '../lib/video'
import type { Project } from '../lib/types'

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

/**
 * The footage, slaved to the audio. It is always muted: the song is already playing,
 * and a take filmed in the room carries the same music a beat or two out.
 */
export default function VideoStage({ project, time, playing, rate, children }: Props) {
  const el = useRef<HTMLVideoElement>(null)
  // Dance footage is as often shot portrait as landscape, and the layout wants the box
  // to fit the film rather than letterbox it, so the real ratio drives the CSS.
  const [nativeRatio, setNativeRatio] = useState(16 / 9)
  const takeUrls = useStore((s) => s.takeUrls)
  const showing = clipAt(project, time, takeUrls)
  const src = showing?.src
  const target = showing?.srcTime ?? 0
  const crop = showing?.take.crop
  const ratio = crop ? (nativeRatio * crop.w) / crop.h : nativeRatio

  // The crop rect maps onto the frame by scaling the video up by 1/w, 1/h and pulling
  // it back by the crop's own offset, so only that rect ever lands inside the box.
  const cropStyle: React.CSSProperties | undefined = crop
    ? {
        position: 'absolute',
        width: `${100 / crop.w}%`,
        height: `${100 / crop.h}%`,
        left: `${(-100 * crop.x) / crop.w}%`,
        top: `${(-100 * crop.y) / crop.h}%`,
      }
    : undefined

  // Assigning currentTime before the element has metadata is dropped on the floor,
  // so a fresh source is seeked from its own load event rather than from the frame loop.
  useEffect(() => {
    const v = el.current
    if (v && src) v.load()
  }, [src])

  // No dependency array on purpose: `time` advances every animation frame while the
  // song plays, and this is the correction that keeps the two elements together.
  useEffect(() => {
    const v = el.current
    if (!v || !src || v.readyState === 0) return
    const drift = target - v.currentTime
    if (Math.abs(drift) > HARD_DRIFT) v.currentTime = target
    else if (playing && Math.abs(drift) > SOFT_DRIFT) v.playbackRate = rate * (1 + Math.sign(drift) * NUDGE)
    else v.playbackRate = rate
    if (playing && v.paused) void v.play().catch(() => {})
    if (!playing && !v.paused) v.pause()
  })

  // Rehearse holds .vstage to a fixed 9/16 box, so the crop rect's own shape has to
  // come from a wrapper sized to IT, not from whatever shape .vstage happens to be.
  const onMeta = () => {
    const v = el.current
    if (!v) return
    v.currentTime = target
    if (v.videoWidth && v.videoHeight) setNativeRatio(v.videoWidth / v.videoHeight)
  }

  return (
    <div className={`vstage${showing ? '' : ' is-gap'}`} style={{ '--ar': ratio } as React.CSSProperties}>
      {src ? (
        crop ? (
          <div className="vstage-crop" style={{ aspectRatio: ratio }}>
            <video ref={el} className="vstage-el" src={src} muted playsInline preload="auto" style={cropStyle} onLoadedMetadata={onMeta} />
          </div>
        ) : (
          <video ref={el} className="vstage-el" src={src} muted playsInline preload="auto" onLoadedMetadata={onMeta} />
        )
      ) : (
        <div className="vstage-gap">
          <i className="ph ph-film-slate" />
          <span>{project.takes.length ? 'No clip on this count' : 'No footage yet'}</span>
        </div>
      )}
      {children}
    </div>
  )
}
