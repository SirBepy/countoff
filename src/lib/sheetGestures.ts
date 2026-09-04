import { useSyncExternalStore } from 'react'
import { audio } from './audio'
import { beatToTime } from './grid'
import { beatAtPoint, rowRects } from './sheetHit'
import { beginGesture, endGesture, set, updateBlock } from './store'
import type { Block, Segment } from './types'

/** Sideways travel, in px, before a gesture on the sheet counts as a drag rather
 * than the start of a scroll. Matches MoveLibrary's own pick-up threshold. */
const DRAG_SLOP = 8

/** Hold before a finger picks a block up, or opens the menu on bare counts. */
const HOLD_MS = 260
const MENU_HOLD_MS = 500

/**
 * Transient drag highlights: they change every frame of a gesture and are never
 * project data, so they live outside the undo-tracked store.
 */
function transient<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  const subscribe = (cb: () => void) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }
  return {
    set(next: T) {
      value = next
      listeners.forEach((l) => l())
    },
    use: () => useSyncExternalStore(subscribe, () => value),
  }
}

/** Preview of where a move-card drag from the rail would land, set by MoveLibrary. */
export const dropState = transient<{ segmentId: string; startBeat: number; beats: number } | null>(null)
export const dragState = transient<string | null>(null)
export const setDropTarget = dropState.set

interface RowGeometry {
  segment: Segment
  /** Absolute time the segment ends, needed to hit-test a point back to a beat. */
  end: number
  rowStart: number
  visibleCount: number
  selection: { startBeat: number; beats: number } | null
}

/** Every pointer gesture one sheet row can start: range select on bare counts, and
 *  move/resize on a block. Built fresh per render, so each handler closes over that
 *  render's own geometry. */
export function sheetGestures({ segment, end, rowStart, visibleCount, selection }: RowGeometry) {
  function selectRange(startBeat: number, beats: number, seekTo = startBeat) {
    set({ selection: { segmentId: segment.id, startBeat, beats } })
    audio.seek(beatToTime(segment, seekTo))
  }

  /** True while a gesture still looks like the start of a vertical scroll. */
  function isScrollish(dx: number, dy: number) {
    return Math.abs(dx) < DRAG_SLOP || Math.abs(dx) <= Math.abs(dy)
  }

  const openBlockMenu = (block: Block, x: number, y: number) =>
    set({ sheetMenu: { x, y, segmentId: segment.id, startBeat: block.startBeat, blockId: block.id } }, false)

  /** A comment or a picked move covers the selection when the menu opened inside
   * it, else up to four counts, never running past the end of the row. */
  function openCountsMenu(beat: number, x: number, y: number) {
    const inSelection = !!selection && beat >= selection.startBeat && beat < selection.startBeat + selection.beats
    const defaultBeats = inSelection ? selection!.beats : Math.max(1, Math.min(4, rowStart + visibleCount - beat))
    set({ sheetMenu: { x, y, segmentId: segment.id, startBeat: beat, defaultBeats } }, false)
  }

  function menuAtPoint(clientX: number, clientY: number) {
    const rows = rowRects(segment.id)
    if (!rows.length) return
    openCountsMenu(beatAtPoint(segment, end, rows, clientX, clientY), clientX, clientY)
  }

  function startSelect(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button === 2 || (e.target as HTMLElement).closest('.block')) return
    const rows = rowRects(segment.id)
    if (!rows.length) return
    const anchor = beatAtPoint(segment, end, rows, e.clientX, e.clientY)
    const originX = e.clientX
    const originY = e.clientY
    // A finger on this grid is usually scrolling, and selecting on pointerdown is
    // what made that impossible. Touch commits only on a sideways drag or a lift.
    const touch = e.pointerType !== 'mouse'
    let committed = false

    const commit = (startBeat: number, beats: number) => {
      if (committed) return set({ selection: { segmentId: segment.id, startBeat, beats } })
      committed = true
      selectRange(startBeat, beats, anchor)
    }
    if (!touch) commit(anchor, 1)

    // The phone has no right-click, so a hold on bare counts is what opens the menu.
    let menuTimer = 0

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - originX
      const dy = ev.clientY - originY
      if (Math.hypot(dx, dy) > DRAG_SLOP) clearTimeout(menuTimer)
      if (!committed && isScrollish(dx, dy)) return
      const beat = beatAtPoint(segment, end, rows, ev.clientX, ev.clientY)
      commit(Math.min(anchor, beat), Math.abs(beat - anchor) + 1)
    }
    // The browser fires pointercancel the moment it claims the gesture for a
    // scroll, which is the cleanest possible signal to stand down.
    const stop = () => {
      clearTimeout(menuTimer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', stop)
    }
    const onUp = (ev: PointerEvent) => {
      stop()
      if (!committed && Math.hypot(ev.clientX - originX, ev.clientY - originY) < DRAG_SLOP) commit(anchor, 1)
    }
    if (touch) {
      menuTimer = window.setTimeout(() => {
        stop()
        navigator.vibrate?.(8)
        openCountsMenu(anchor, originX, originY)
      }, MENU_HOLD_MS)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', stop)
  }

  /**
   * Both axes come from the pointer's own position rather than a horizontal delta,
   * which is what lets a block travel into another row instead of stopping at the edge.
   */
  function dragBlock(block: Block, e: React.PointerEvent, mode: 'move' | 'resize') {
    e.stopPropagation()
    if (e.button === 2) return
    const rows = rowRects(segment.id)
    if (!rows.length) return
    const offset = beatAtPoint(segment, end, rows, e.clientX, e.clientY) - block.startBeat
    const originX = e.clientX
    const originY = e.clientY
    const gestureKey = `block-${mode}-${block.id}`
    // The grip and the mouse drag on contact. A finger on the block body has to
    // hold first, so a swipe down a wide block still scrolls the sheet.
    const held = mode === 'resize' || e.pointerType === 'mouse'
    let started = false
    let moved = false

    // touch-action is fixed for the life of a gesture, so an armed drag has to
    // refuse the scroll itself rather than by restyling the block.
    const refuseScroll = (ev: TouchEvent) => ev.preventDefault()

    const arm = () => {
      if (started) return
      started = true
      beginGesture(gestureKey)
      dragState.set(block.id)
      window.addEventListener('touchmove', refuseScroll, { passive: false })
      if (!held) navigator.vibrate?.(8)
    }
    if (held) {
      e.preventDefault()
      arm()
    }
    const holdTimer = held ? 0 : window.setTimeout(arm, HOLD_MS)

    const onMove = (ev: PointerEvent) => {
      if (!started) {
        const dx = ev.clientX - originX
        const dy = ev.clientY - originY
        if (Math.hypot(dx, dy) < DRAG_SLOP) return
        clearTimeout(holdTimer)
        // A vertical swipe that beat the hold is a scroll; let the sheet have it.
        if (isScrollish(dx, dy)) return stop()
        arm()
      }
      moved = true
      const beat = beatAtPoint(segment, end, rows, ev.clientX, ev.clientY)
      if (mode === 'move') updateBlock(block.id, { startBeat: Math.max(0, beat - offset) }, gestureKey)
      else updateBlock(block.id, { beats: Math.max(1, beat - block.startBeat + 1) }, gestureKey)
    }
    const stop = () => {
      clearTimeout(holdTimer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('touchmove', refuseScroll)
      if (started) {
        endGesture()
        dragState.set(null)
      }
    }
    const onUp = (ev: PointerEvent) => {
      stop()
      if (!moved && mode === 'move') openBlockMenu(block, ev.clientX, ev.clientY)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', stop)
  }

  return { selectRange, openBlockMenu, menuAtPoint, startSelect, dragBlock }
}
