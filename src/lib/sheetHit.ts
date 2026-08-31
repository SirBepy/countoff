import { countsInRow, segmentEnd } from './grid'
import type { Project, Segment } from './types'

export interface RowRect {
  segmentId: string
  row: number
  rect: DOMRect
}

/** Callers capture this once per gesture: re-measuring inside pointermove
 *  forces a layout every frame. */
export function rowRects(segmentId?: string): RowRect[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.counts'))
    .filter((el) => !segmentId || el.dataset.segmentId === segmentId)
    .map((el) => ({ segmentId: el.dataset.segmentId!, row: Number(el.dataset.row), rect: el.getBoundingClientRect() }))
    .sort((a, b) => a.row - b.row)
}

/** Clamped to the counts the row actually renders, so a cut landing mid-row
 *  can't be filled past the song's end. That clamp is why this lives once. */
export function beatInRow(seg: Segment, end: number, r: RowRect, clientX: number) {
  const ratio = (clientX - r.rect.left) / r.rect.width
  const visible = countsInRow(seg, r.row, end)
  return r.row * seg.countsPerRow + Math.max(0, Math.min(visible - 1, Math.floor(ratio * seg.countsPerRow)))
}

/** One song's rows, for a drag that travels past the row it started in. The last
 *  row whose top is at or above the pointer owns it; above them all, that is row 0. */
export function beatAtPoint(seg: Segment, end: number, rows: RowRect[], clientX: number, clientY: number) {
  let owner = rows[0]
  for (const r of rows) if (clientY >= r.rect.top) owner = r
  return beatInRow(seg, end, owner, clientX)
}

/** Every song, for a drag arriving from the move library. Measures fresh
 *  because the drop lands once, not per frame. */
export function countAtPoint(project: Project, clientX: number, clientY: number) {
  for (const r of rowRects()) {
    if (clientX < r.rect.left || clientX > r.rect.right || clientY < r.rect.top || clientY > r.rect.bottom) continue
    const index = project.segments.findIndex((s) => s.id === r.segmentId)
    if (index < 0) continue
    const seg = project.segments[index]
    const end = segmentEnd(project.segments, index, project.duration)
    if (!countsInRow(seg, r.row, end)) continue
    return { segmentId: seg.id, startBeat: beatInRow(seg, end, r, clientX) }
  }
  return null
}
