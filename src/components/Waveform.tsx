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
  /** An un-accepted detection reading. While set, this is the grid drawn in accent
   *  colour (todo 32: the stored grid is what's currently applied, not what the dev
   *  is being asked to judge) - the stored grid still draws too, dimmed, so Accept's
   *  effect is visible rather than the old grid just disappearing. */
  proposedBpm?: number
  proposedAnchor?: number
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
export default function Waveform({
  buffer,
  start,
  end,
  bpm,
  anchor,
  proposedBpm,
  proposedAnchor,
  playhead,
  onSeek,
  height = 96,
}: WaveformProps) {
  const hasProposal = proposedBpm != null && isFinite(proposedBpm) && proposedBpm > 0 && proposedAnchor != null && isFinite(proposedAnchor)
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
    // --e2 (amber) is already this app's "attention, not yet committed" colour on
    // the energy dots elsewhere - reused here instead of a new hardcoded value.
    const proposalColor = styles.getPropertyValue('--e2').trim() || '#f0a63c'
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

    // Ticks off a grid's own anchor/bpm. `downColor`/`otherColor` let the caller
    // pick stored-vs-proposed styling; an Accept click is still the only thing
    // that ever moves `bpm`/`anchor` themselves, matching the never-silent-overwrite rule.
    const drawGrid = (gridBpm: number, gridAnchor: number, downColor: string, otherColor: string, lineWidth: number) => {
      if (!(gridBpm > 0) || !isFinite(gridBpm) || !isFinite(gridAnchor)) return
      const beat = beatDuration(gridBpm)
      const firstN = Math.ceil((start - gridAnchor) / beat)
      for (let n = firstN; ; n++) {
        const t = gridAnchor + n * beat
        if (t >= end) break
        if (t >= start) {
          const x = (t - start) * pxPerSecond
          const isDown = ((n % 4) + 4) % 4 === 0
          ctx.strokeStyle = isDown ? downColor : otherColor
          ctx.lineWidth = isDown ? lineWidth + 1 : lineWidth
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, height)
          ctx.stroke()
        }
      }
    }

    // Todo 32: while a proposal is pending, the grid the dev is being asked to judge
    // is the PROPOSED one - drawing the stored grid instead made Accept/reject a blind
    // choice against a picture of something else. Both draw when a proposal is live:
    // stored fades to near-invisible, proposed takes the accent/amber so the delta
    // Accept would make is visible, not just the end state.
    if (hasProposal) {
      drawGrid(bpm, anchor, withAlpha(dimColor, 0.25), withAlpha(dimColor, 0.15), 1)
      // Only the downbeats carry full weight. At 0.35 the off-beats still read as amber,
      // so the proposal is legible as one grid, without the tick density hiding the
      // waveform the dev is reading to judge it.
      drawGrid(proposedBpm as number, proposedAnchor as number, accent, withAlpha(proposalColor, 0.35), 1)
    } else {
      drawGrid(bpm, anchor, accent, tickColor, 1)
    }

    const drawnBpm = hasProposal ? (proposedBpm as number) : bpm
    const drawnAnchor = hasProposal ? (proposedAnchor as number) : anchor
    canvas.dataset.drawnBpm = String(drawnBpm)
    canvas.dataset.drawnAnchor = String(drawnAnchor)
  }, [buffer, start, end, bpm, anchor, hasProposal, proposedBpm, proposedAnchor, pxPerSecond, width, height])

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
