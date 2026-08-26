import { useSyncExternalStore } from 'react'

export interface Loop {
  from: number
  to: number
}

const el = new Audio()
el.preload = 'auto'
el.setAttribute('playsinline', '')
el.crossOrigin = 'anonymous'
// iOS only keeps audio alive behind a lock screen for a media element that is
// actually in the document, so it lives here rather than floating detached.
el.style.display = 'none'
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => document.body.append(el))

let ctx: AudioContext | null = null
let loop: Loop | null = null
let metronome = false
let lastClickBeat = -1
let beatAt: ((time: number) => number) | null = null
let frame = 0

const listeners = new Set<() => void>()
// Changes every frame while playing, which is what makes components re-read currentTime.
let tick = 0

function notify() {
  tick++
  listeners.forEach((l) => l())
}

function click(accent: boolean) {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.value = accent ? 1600 : 1000
  gain.gain.setValueAtTime(accent ? 0.35 : 0.18, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05)
  osc.connect(gain).connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + 0.06)
}

function loopFrame() {
  if (loop && el.currentTime >= loop.to) el.currentTime = loop.from
  if (metronome && beatAt) {
    const beat = Math.floor(beatAt(el.currentTime))
    if (beat !== lastClickBeat && beat >= 0) {
      // Accent the downbeat so the "1" is audible while rehearsing.
      click(beat % 4 === 0)
      lastClickBeat = beat
    }
  }
  notify()
  frame = requestAnimationFrame(loopFrame)
}

el.addEventListener('play', () => {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(loopFrame)
  notify()
})
el.addEventListener('pause', () => {
  cancelAnimationFrame(frame)
  notify()
})
el.addEventListener('loadedmetadata', notify)
el.addEventListener('seeked', notify)
// requestAnimationFrame is paused when the tab is hidden or the phone is
// locked, so loop wrap-around rides on timeupdate instead, which keeps firing.
el.addEventListener('timeupdate', () => {
  if (loop && el.currentTime >= loop.to) el.currentTime = loop.from
  if (document.hidden) notify()
})

/**
 * Lock-screen and headphone controls. Without a MediaSession the OS shows a
 * generic entry and the hardware buttons do nothing.
 */
function publishSession(title: string) {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist: 'Countoff',
    album: 'Choreography',
  })
  navigator.mediaSession.setActionHandler('play', () => void el.play())
  navigator.mediaSession.setActionHandler('pause', () => el.pause())
  navigator.mediaSession.setActionHandler('seekbackward', () => (el.currentTime = Math.max(0, el.currentTime - 10)))
  navigator.mediaSession.setActionHandler('seekforward', () => (el.currentTime = el.currentTime + 10))
  navigator.mediaSession.setActionHandler('seekto', (e) => {
    if (e.seekTime != null) el.currentTime = e.seekTime
  })
}

export const audio = {
  el,
  load(url: string, title = 'Countoff') {
    el.src = url
    el.load()
    publishSession(title)
  },
  setTitle: publishSession,
  play() {
    void el.play()
  },
  pause() {
    el.pause()
  },
  toggle() {
    if (el.paused) void el.play()
    else el.pause()
  },
  seek(time: number) {
    el.currentTime = Math.max(0, Math.min(time, el.duration || time))
    lastClickBeat = -1
    notify()
  },
  nudge(by: number) {
    audio.seek(el.currentTime + by)
  },
  setRate(rate: number) {
    el.playbackRate = rate
    // Keeps a 70% rehearsal pass from sounding a fourth lower.
    el.preservesPitch = true
    notify()
  },
  setLoop(next: Loop | null) {
    loop = next
    notify()
  },
  getLoop: () => loop,
  setMetronome(on: boolean) {
    metronome = on
    lastClickBeat = -1
    notify()
  },
  getMetronome: () => metronome,
  /** The sheet supplies this so the click can follow per-song tempo changes. */
  setBeatMapper(fn: ((time: number) => number) | null) {
    beatAt = fn
  },
}

export function useAudio() {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => tick,
  )
  return {
    time: el.currentTime,
    duration: el.duration || 0,
    playing: !el.paused,
    rate: el.playbackRate,
    loop,
    metronome,
  }
}
