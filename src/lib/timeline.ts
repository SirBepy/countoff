import { useEffect, useLayoutEffect, type RefObject } from 'react'

/** 1 fits the whole medley; the top end puts a couple of bars across the screen. */
export const ZOOM_MIN = 1
export const ZOOM_MAX = 60
/** Keeps the playhead this far off the edge before a follow scroll fires. */
const FOLLOW_EDGE = 80

export const clampZoom = (zoom: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom))

/** The slider is logarithmic. Half its travel reaches 8x, which is the range a cut is
 *  actually placed in; a linear one spends its first eighth there and the rest on
 *  factors nobody drags to. */
export const zoomFromSlider = (pos: number) =>
  ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, Math.max(0, Math.min(1, pos / 100)))

export const sliderFromZoom = (zoom: number) =>
  Math.round((Math.log(clampZoom(zoom) / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN)) * 100)

/** Where the playhead sits inside a scroller, in that scroller's own coordinates. The
 *  track is measured rather than the whole lane, since the name column is pinned to the
 *  left and covers the first stretch of song. */
function playheadX(track: HTMLElement, time: number, duration: number) {
  return track.offsetLeft + track.offsetWidth * (time / duration)
}

/**
 * Holds the playhead in the middle whenever the zoom changes. Widening the lane leaves
 * `scrollLeft` pointing at a different moment of the song, so without this a zoom walks
 * off whatever it was aimed at. `track` names the lane's own column inside the scroller.
 */
export function useZoomAnchor(
  scroll: RefObject<HTMLElement>,
  track: string,
  zoom: number,
  time: number,
  duration: number,
) {
  // Zoom alone: re-running on `time` would fight a scrub, and playback is followed by
  // the separate hook below.
  useLayoutEffect(() => {
    const box = scroll.current
    const lane = box?.querySelector(track) as HTMLElement | null
    if (!box || !lane) return
    box.scrollLeft = playheadX(lane, time, duration) - box.clientWidth / 2
  }, [zoom])
}

/**
 * Ctrl or Cmd and scroll, bound the only way it actually works. React registers `wheel`
 * at the root as a passive listener, so an `onWheel` prop cannot call `preventDefault`:
 * the browser reads the same gesture as a page zoom and grows the whole app alongside the
 * lane. A native listener opted out of passive is what stops that.
 */
export function useWheelZoom(el: RefObject<HTMLElement>, zoom: number, onZoom: (zoom: number) => void) {
  useEffect(() => {
    const box = el.current
    if (!box) return
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      onZoom(clampZoom(zoom * (e.deltaY < 0 ? 1.25 : 0.8)))
    }
    box.addEventListener('wheel', wheel, { passive: false })
    return () => box.removeEventListener('wheel', wheel)
  }, [el, zoom, onZoom])
}

/**
 * Keeps a playing song on screen. Zoomed in, the playhead walks off the right edge
 * within seconds; this only fires while playing, or a scrub would fight the scroll it
 * just caused.
 */
export function useFollowPlayhead(
  scroll: RefObject<HTMLElement>,
  track: string,
  time: number,
  duration: number,
  playing: boolean,
  zoom: number,
) {
  useEffect(() => {
    const box = scroll.current
    const lane = box?.querySelector(track) as HTMLElement | null
    if (!box || !lane || !playing) return
    const x = playheadX(lane, time, duration)
    if (x < box.scrollLeft + FOLLOW_EDGE || x > box.scrollLeft + box.clientWidth - FOLLOW_EDGE) {
      box.scrollLeft = x - box.clientWidth / 2
    }
  }, [scroll, track, time, duration, playing, zoom])
}
