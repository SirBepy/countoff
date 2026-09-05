import { useState } from 'react'
import { flash } from '../lib/store'

/** m:ss.mmm, always three fractional digits so a typed value round-trips exactly. */
export function formatPrecise(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}

/** Accepts "m:ss.mmm", "m:ss" or plain seconds. Returns null on anything else; never throws. */
export function parsePrecise(input: string): number | null {
  const raw = input.trim()
  if (!raw) return null
  const withMinutes = raw.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/)
  if (withMinutes) {
    const [, m, s, frac] = withMinutes
    if (Number(s) > 59) return null
    return Number(m) * 60 + Number(s) + (frac ? Number(frac.padEnd(3, '0')) / 1000 : 0)
  }
  const plain = raw.match(/^(\d+)(?:\.(\d{1,3}))?$/)
  if (plain) {
    const [, s, frac] = plain
    return Number(s) + (frac ? Number(frac.padEnd(3, '0')) / 1000 : 0)
  }
  return null
}

interface TimeFieldProps {
  value: number
  min: number
  max: number
  step: number
  /** Typed blur/Enter: a correction session, coalesced by the caller's key. */
  onCommit: (next: number) => void
  /** A nudge click: its own undo step, never merged with a typed commit. */
  onNudge: (next: number) => void
}

/** Typed m:ss.mmm plus a nudge pattern. An unparsable commit leaves the draft and store untouched. */
export function TimeField({ value, min, max, step, onCommit, onNudge }: TimeFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const clamp = (n: number) => Math.min(max, Math.max(min, n))

  function commit(raw: string) {
    const parsed = parsePrecise(raw)
    if (parsed === null) {
      flash(`Could not read "${raw}" as a time; use m:ss.mmm`)
      return
    }
    onCommit(Number(clamp(parsed).toFixed(3)))
    setDraft(null)
  }

  return (
    <span className="row" style={{ gap: 4 }}>
      <input
        className="mono"
        style={{ width: 96 }}
        value={draft ?? formatPrecise(value)}
        onFocus={() => setDraft(formatPrecise(value))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <button className="ghost sm icon" title={`${Math.round(step * 1000)}ms earlier`} onClick={() => onNudge(Number(clamp(value - step).toFixed(3)))}>
        <i className="ph ph-caret-left" />
      </button>
      <button className="ghost sm icon" title={`${Math.round(step * 1000)}ms later`} onClick={() => onNudge(Number(clamp(value + step).toFixed(3)))}>
        <i className="ph ph-caret-right" />
      </button>
    </span>
  )
}
