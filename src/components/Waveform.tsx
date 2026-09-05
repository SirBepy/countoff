import { useEffect, useRef, useState } from 'react'
import { beatDuration } from '../lib/grid'

interface WaveformProps {
  /** Null while the audio is still decoding or absent; ticks still draw so the
   *  grid is visible even before/without a waveform to check it against. */
  buffer: AudioBuffer | null
  start: number
  end: number
  bpm: number
  anchor: number
  /** Absolute audio time, or null to hide the playhead. Only drawn inside [start, end]. */
  playhead: number | null
  onSeek?: (time: number) => void
  height?: number
}

const MIN_PX_PER_SECOND = 15
const MAX_PX_PER_SECOND = 300

/** `--text-dim` etc are opaque hex tokens meant for text on the lighter panel
 *  background; a beat tick needs to sit on this near-black canvas instead, so it
 *  borrows the same token's colour at reduced alpha rather than a second hardcoded value. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * One song's waveform on a canvas, with beat ticks off its own anchor/bpm and the
 * downbeat picked out. Zoomable and scrollable so a long song is still readable.
 * Peak extraction is its own thing here, tuned for a picture, not for the
 * autocorrelation onset envelope in bpm.ts - reusable independent of that module.
 */
export default function Waveform({ buffer, start, end, bpm, anchor, playhead, onSeek, height = 96 }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pxPerSecond, setPxPerSecond] = useState(60)
  const duration = Math.max(0, end - start)
  const width = Math.max(1, Math.round(duration * pxPerSecond))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const styles = getComputedStyle(document.documentElement)
    const dimColor = styles.getPropertyValue('--text-dim').trim() || '#98a1b8'
    const accent = styles.getPropertyValue('--accent').trim() || '#7c5cff'
    // --line is tuned for a border against the lighter panel background, not this
    // near-black canvas, so a beat tick in that colour was nearly invisible; a
    // translucent text-dim reads clearly while still losing to the downbeat's accent.
    const tickColor = withAlpha(dimColor, 0.55)

    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    ctx.fillRect(0, 0, width, height)

    if (buffer) {
      const sampleRate = buffer.sampleRate
      const channels = buffer.numberOfChannels
      const channelData: Float32Array[] = []
      for (let c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c))
      const mid = height / 2
      ctx.strokeStyle = dimColor
      ctx.beginPath()
      for (let x = 0; x < width; x++) {
        const t0 = start + x / pxPerSecond
        const t1 = start + (x + 1) / pxPerSecond
        const s0 = Math.max(0, Math.floor(t0 * sampleRate))
        const s1 = Math.min(buffer.length, Math.ceil(t1 * sampleRate))
        let min = 0
        let max = 0
        for (let c = 0; c < channels; c++) {
          const data = channelData[c]
          for (let i = s0; i < s1; i++) {
            const v = data[i]
            if (v < min) min = v
            if (v > max) max = v
          }
        }
        ctx.moveTo(x + 0.5, mid - max * mid)
        ctx.lineTo(x + 0.5, mid - min * mid)
      }
      ctx.stroke()
    }

    // Ticks off the segment's OWN stored anchor/bpm, never the pending proposal -
    // only an Accept click ever moves these, matching the never-silent-overwrite rule.
    if (bpm > 0 && isFinite(bpm) && isFinite(anchor)) {
      const beat = beatDuration(bpm)
      const firstN = Math.ceil((start - anchor) / beat)
      for (let n = firstN; ; n++) {
        const t = anchor + n * beat
        if (t >= end) break
        if (t >= start) {
          const x = (t - start) * pxPerSecond
          const isDown = ((n % 4) + 4) % 4 === 0
          ctx.strokeStyle = isDown ? accent : tickColor
          ctx.lineWidth = isDown ? 2 : 1
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, height)
          ctx.stroke()
        }
      }
    }
  }, [buffer, start, end, bpm, anchor, pxPerSecond, width, height])

  const playheadX = playhead != null && playhead >= start && playhead <= end ? (playhead - start) * pxPerSecond : null

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll || playheadX == null) return
    // Only nudge the scroll when the playhead has actually left the visible band,
    // so a dev who scrolled off to inspect a beat isn't fought every frame.
    if (playheadX < scroll.scrollLeft || playheadX > scroll.scrollLeft + scroll.clientWidth) {
      scroll.scrollLeft = Math.max(0, playheadX - scroll.clientWidth / 2)
    }
  }, [playheadX])

  return (
    <div className="beats-wave">
      <div className="beats-wave-zoom">
        <button
          className="ghost sm icon"
          title="Zoom out"
          onClick={() => setPxPerSecond((z) => Math.max(MIN_PX_PER_SECOND, z / 1.5))}
        >
          <i className="ph ph-minus" />
        </button>
        <button
          className="ghost sm icon"
          title="Zoom in"
          onClick={() => setPxPerSecond((z) => Math.min(MAX_PX_PER_SECOND, z * 1.5))}
        >
          <i className="ph ph-plus" />
        </button>
      </div>
      <div className="beats-wave-scroll" ref={scrollRef}>
        <div className="beats-wave-inner" style={{ width, height }}>
          <canvas
            ref={canvasRef}
            onClick={(e) => {
              if (!onSeek) return
              const rect = e.currentTarget.getBoundingClientRect()
              onSeek(start + (e.clientX - rect.left) / pxPerSecond)
            }}
          />
          {playheadX != null && <div className="beats-wave-playhead" style={{ left: playheadX }} />}
        </div>
      </div>
    </div>
  )
}
