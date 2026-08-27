import { loadAudio } from './db'

const HOP = 512
const MIN_BPM = 70
const MAX_BPM = 185

export interface TempoEstimate {
  bpm: number
  /** Time of the first beat, phase-aligned but not necessarily a downbeat. */
  phase: number
  /** 0-1. Below ~0.25 the envelope had no clear pulse, so prompt the user to tap instead. */
  confidence: number
}

/**
 * Rectified energy difference per hop. Rising energy marks note onsets, which
 * pulse at the beat rate far more cleanly than raw amplitude does.
 */
function onsetEnvelope(buffer: AudioBuffer): { env: Float32Array; fps: number } {
  const channel = buffer.getChannelData(0)
  const other = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null
  const frames = Math.floor(channel.length / HOP)
  const energy = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    const start = i * HOP
    for (let j = 0; j < HOP; j++) {
      const s = other ? (channel[start + j] + other[start + j]) * 0.5 : channel[start + j]
      sum += s * s
    }
    energy[i] = Math.sqrt(sum / HOP)
  }
  const env = new Float32Array(frames)
  for (let i = 1; i < frames; i++) env[i] = Math.max(0, energy[i] - energy[i - 1])
  return { env, fps: buffer.sampleRate / HOP }
}

function normalise(env: Float32Array) {
  let mean = 0
  for (const v of env) mean += v
  mean /= env.length || 1
  const out = new Float32Array(env.length)
  for (let i = 0; i < env.length; i++) out[i] = env[i] - mean
  return out
}

/**
 * Autocorrelation over the onset envelope: the lag with the highest correlation
 * inside the BPM window is the beat period.
 */
export function detectTempo(buffer: AudioBuffer, from = 0, to = Infinity, origin = 0): TempoEstimate {
  const { env: raw, fps } = onsetEnvelope(buffer)
  const startFrame = Math.max(0, Math.floor(from * fps))
  const endFrame = Math.min(raw.length, Math.ceil(Math.min(to, buffer.duration) * fps))
  const slice = normalise(raw.subarray(startFrame, endFrame))
  if (slice.length < fps * 8) return { bpm: 120, phase: origin, confidence: 0 }

  const minLag = Math.floor((60 / MAX_BPM) * fps)
  const maxLag = Math.ceil((60 / MIN_BPM) * fps)
  let bestLag = minLag
  let bestScore = -Infinity
  let zeroLag = 0
  for (const v of slice) zeroLag += v * v

  const scores = new Float64Array(maxLag + 1)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0
    for (let i = 0; i + lag < slice.length; i++) score += slice[i] * slice[i + lag]
    // Longer lags overlap fewer samples, so normalise before comparing.
    scores[lag] = score / (slice.length - lag)
    if (scores[lag] > bestScore) {
      bestScore = scores[lag]
      bestLag = lag
    }
  }

  // One hop is ~3 BPM of resolution up here, enough to drift a grid by seconds
  // over a four-minute track, so interpolate the peak to sub-hop precision.
  let refinedLag = bestLag
  if (bestLag > minLag && bestLag < maxLag) {
    const [a, b, c] = [scores[bestLag - 1], scores[bestLag], scores[bestLag + 1]]
    const denom = a - 2 * b + c
    if (denom !== 0) refinedLag = bestLag + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom))
  }

  let bpm = (60 * fps) / refinedLag
  while (bpm < 90) bpm *= 2
  while (bpm > 180) bpm /= 2

  const period = (60 / bpm) * fps
  let bestPhase = 0
  let bestPhaseScore = -Infinity
  for (let offset = 0; offset < period; offset++) {
    let score = 0
    for (let t = offset; t < slice.length; t += period) score += slice[Math.round(t)] ?? 0
    if (score > bestPhaseScore) {
      bestPhaseScore = score
      bestPhase = offset
    }
  }

  const confidence = zeroLag > 0 ? Math.min(1, Math.max(0, (bestScore * (slice.length - bestLag)) / zeroLag)) : 0
  const rounded = Math.round(bpm * 10) / 10
  // Analysis starts mid-track to dodge the intro, so walk the detected beat back
  // to the first one at or after `origin`. Otherwise the grid starts 20s in and
  // everything before it is unreachable on the sheet.
  const beat = 60 / rounded
  const detected = from + bestPhase / fps
  const phase = detected - Math.floor((detected - origin) / beat) * beat

  return { bpm: rounded, phase, confidence }
}

/** Median inter-tap interval, so one clumsy tap does not wreck the estimate. */
export function bpmFromTaps(times: number[]): number | null {
  if (times.length < 4) return null
  const gaps = times.slice(1).map((t, i) => t - times[i]).filter((g) => g > 0.2 && g < 2)
  if (gaps.length < 3) return null
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]
  return Math.round((60 / median) * 10) / 10
}

/** Only place that opens a transient decode `AudioContext`; always closes it, even on failure. */
export async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const ctx = new AudioContext()
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer())
  } finally {
    void ctx.close()
  }
}

/** Re-decodes the stored audio and measures tempo over [from, to); null if there is none yet. */
export async function measureStoredTempo(from: number, to: number, origin = from): Promise<TempoEstimate | null> {
  const blob = await loadAudio()
  if (!blob) return null
  const buffer = await decodeAudioBlob(blob)
  return detectTempo(buffer, from, to, origin)
}
