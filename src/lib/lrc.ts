import type { LyricLine } from './types'

const API = 'https://lrclib.net/api'

export interface LrcResult {
  id: number
  trackName: string
  artistName: string
  albumName: string | null
  duration: number | null
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

export async function searchLyrics(query: string): Promise<LrcResult[]> {
  const res = await fetch(`${API}/search?q=${encodeURIComponent(query)}`)
  if (!res.ok) throw new Error(`LRCLIB search failed (${res.status})`)
  const rows: LrcResult[] = await res.json()
  // Synced results are the only ones worth placing on a timeline.
  return rows.sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics)).slice(0, 12)
}

/** Parses `[mm:ss.xx] text`, the format LRCLIB returns in `syncedLyrics`. */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const row of lrc.split('\n')) {
    const stamps = [...row.matchAll(/\[(\d+):(\d+)(?:[.:](\d+))?\]/g)]
    if (!stamps.length) continue
    const text = row.replace(/\[[^\]]*\]/g, '').trim()
    if (!text) continue
    for (const [, mm, ss, frac] of stamps) {
      const fraction = frac ? Number(`0.${frac}`) : 0
      lines.push({ time: Number(mm) * 60 + Number(ss) + fraction, text })
    }
  }
  return lines.sort((a, b) => a.time - b.time)
}

/** Splits pasted plain lyrics into untimed lines for tap-to-sync. */
export function parsePlain(text: string): LyricLine[] {
  return text
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ time: -1, text: t }))
}

export const shiftLyrics = (lines: LyricLine[], by: number): LyricLine[] =>
  lines.map((l) => (l.time < 0 ? l : { ...l, time: l.time + by }))

export function lyricAt(lines: LyricLine[], time: number): LyricLine | null {
  let current: LyricLine | null = null
  for (const line of lines) {
    if (line.time >= 0 && line.time <= time) current = line
    else if (line.time > time) break
  }
  return current
}

/** The lyric lines whose timestamps fall inside a beat window, for one sheet row. */
export function lyricsBetween(lines: LyricLine[], from: number, to: number): LyricLine[] {
  return lines.filter((l) => l.time >= from && l.time < to)
}
