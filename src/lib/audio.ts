import { useSyncExternalStore } from 'react'

export interface Loop {
  from: number
  to: number
}

interface AudioSingleton {
  el: HTMLAudioElement
  ctx: AudioContext | null
  loop: Loop | null
  metronome: boolean
  lastClickBeat: number
  beatAt: ((time: number) => number) | null
  frame: number
  listeners: Set<() => void>
  tick: number
}

// A dev-mode hot reload re-runs this whole module (no HMR boundary of its own).
// Anchoring only the element left the five native listeners below rebuilding on
// the same persisted element every time, nothing ever un-registering them - a
// doubled metronome click by the second reload. Anchor the lot; gate setup below.
const HMR_KEY = '__countoffAudio'
const globalAny = globalThis as unknown as Record<string, AudioSingleton | undefined>
const isFreshBoot = !globalAny[HMR_KEY]
const S: AudioSingleton = globalAny[HMR_KEY] ?? {
  el: new Audio(),
  ctx: null,
  loop: null,
  metronome: false,
  lastClickBeat: -1,
  beatAt: null,
  frame: 0,
  listeners: new Set(),
  tick: 0,
}
globalAny[HMR_KEY] = S
const el = S.el

function notify() {
  S.tick++
  S.listeners.forEach((l) => l())
}

function click(accent: boolean) {
  if (!S.ctx) S.ctx = new AudioContext()
  if (S.ctx.state === 'suspended') void S.ctx.resume()
  const osc = S.ctx.createOscillator()
  const gain = S.ctx.createGain()
  osc.frequency.value = accent ? 1600 : 1000
  gain.gain.setValueAtTime(accent ? 0.35 : 0.18, S.ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.0001, S.ctx.currentTime + 0.05)
  osc.connect(gain).connect(S.ctx.destination)
  osc.start()
  osc.stop(S.ctx.currentTime + 0.06)
}

function loopFrame() {
  if (S.loop && el.currentTime >= S.loop.to) el.currentTime = S.loop.from
  if (S.metronome && S.beatAt) {
    const beat = Math.floor(S.beatAt(el.currentTime))
    if (beat !== S.lastClickBeat && beat >= 0) {
      // Accent the downbeat so the "1" is audible while rehearsing.
      click(beat % 4 === 0)
      S.lastClickBeat = beat
    }
  }
  notify()
  S.frame = requestAnimationFrame(loopFrame)
}

if (isFreshBoot) {
  el.preload = 'auto'
  el.setAttribute('playsinline', '')
  el.crossOrigin = 'anonymous'
  // iOS only keeps audio alive behind a lock screen for a media element that is
  // actually in the document, so it lives here rather than floating detached.
  el.style.display = 'none'
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => document.body.append(el))

  el.addEventListener('play', () => {
    cancelAnimationFrame(S.frame)
    S.frame = requestAnimationFrame(loopFrame)
    notify()
  })
  el.addEventListener('pause', () => {
    cancelAnimationFrame(S.frame)
    notify()
  })
  el.addEventListener('loadedmetadata', notify)
  el.addEventListener('seeked', notify)
  // requestAnimationFrame is paused when the tab is hidden or the phone is
  // locked, so loop wrap-around rides on timeupdate instead, which keeps firing.
  el.addEventListener('timeupdate', () => {
    if (S.loop && el.currentTime >= S.loop.to) el.currentTime = S.loop.from
    if (document.hidden) notify()
  })
}

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
    S.lastClickBeat = -1
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
    S.loop = next
    notify()
  },
  getLoop: () => S.loop,
  setMetronome(on: boolean) {
    S.metronome = on
    S.lastClickBeat = -1
    notify()
  },
  getMetronome: () => S.metronome,
  /** The sheet supplies this so the click can follow per-song tempo changes. */
  setBeatMapper(fn: ((time: number) => number) | null) {
    S.beatAt = fn
  },
}

export function useAudio() {
  useSyncExternalStore(
    (cb) => {
      S.listeners.add(cb)
      return () => S.listeners.delete(cb)
    },
    () => S.tick,
  )
  return {
    time: el.currentTime,
    duration: el.duration || 0,
    playing: !el.paused,
    rate: el.playbackRate,
    loop: S.loop,
    metronome: S.metronome,
  }
}
