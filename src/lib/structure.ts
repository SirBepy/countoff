const FPS = 20
const WINDOW = 3.5
const MIN_GAP = 12

export interface Candidate {
  time: number
  /** 0-1, how sharply the track changes here. */
  strength: number
  reason: 'change' | 'drop'
}

function envelope(buffer: AudioBuffer) {
  const hop = Math.floor(buffer.sampleRate / FPS)
  const channel = buffer.getChannelData(0)
  const frames = Math.floor(channel.length / hop)
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let j = 0; j < hop; j += 4) {
      const s = channel[i * hop + j]
      sum += s * s
    }
    out[i] = Math.sqrt(sum / (hop / 4))
  }
  return out
}

/**
 * Compares average loudness either side of every instant; a hand-cut medley leaves
 * a step at each join. Candidates only, since a seamless blend defeats this.
 */
export function suggestTransitions(buffer: AudioBuffer): Candidate[] {
  const env = envelope(buffer)
  const half = Math.floor(WINDOW * FPS)
  if (env.length < half * 3) return []

  const scores = new Float32Array(env.length)
  for (let i = half; i < env.length - half; i++) {
    let before = 0
    let after = 0
    for (let j = 1; j <= half; j++) {
      before += env[i - j]
      after += env[i + j]
    }
    before /= half
    after /= half
    scores[i] = Math.abs(after - before) / (Math.max(before, after) || 1)
  }

  const picks: Candidate[] = []
  const used: number[] = []
  const order = [...scores.keys()].sort((a, b) => scores[b] - scores[a])
  for (const i of order) {
    if (scores[i] < 0.28) break
    const time = i / FPS
    if (used.some((t) => Math.abs(t - time) < MIN_GAP)) continue
    used.push(time)
    let before = 0
    for (let j = 1; j <= half; j++) before += env[i - j]
    let after = 0
    for (let j = 1; j <= half; j++) after += env[i + j]
    picks.push({
      time,
      strength: Math.min(1, scores[i]),
      reason: after > before ? 'drop' : 'change',
    })
    if (picks.length >= 12) break
  }

  return picks.sort((a, b) => a.time - b.time)
}
