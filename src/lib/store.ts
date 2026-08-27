import { useSyncExternalStore } from 'react'
import type { Block, Marker, Move, Project, Segment } from './types'
import { saveProject } from './db'
import { snapshot } from './backup'

export interface Selection {
  segmentId: string
  startBeat: number
  beats: number
}

export interface UiState {
  project: Project | null
  audioUrl: string | null
  selection: Selection | null
  view: 'sheet' | 'rehearse'
  activeMoveId: string | null
  status: string | null
  /** Scroll the sheet to keep the playing 8-count on screen. */
  follow: boolean
  /** Only meaningful under 900px, where the move rail is a bottom sheet. */
  libraryOpen: boolean
  /** Which lyric line's inline editor is open, so a hand-placed line can land in edit mode immediately. */
  editingLyricId: string | null
  /** Mirrors the undo/redo stacks so buttons can grey out without reaching into store internals. */
  canUndo: boolean
  canRedo: boolean
}

let state: UiState = {
  project: null,
  audioUrl: null,
  selection: null,
  view: 'sheet',
  activeMoveId: null,
  status: null,
  follow: true,
  libraryOpen: false,
  editingLyricId: null,
  canUndo: false,
  canRedo: false,
}

const listeners = new Set<() => void>()
let saveTimer: number | undefined
let lastSnapshot = 0
const SNAPSHOT_EVERY = 60_000

function emit(persist = true) {
  listeners.forEach((l) => l())
  if (persist && state.project) {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const project = state.project
      if (!project) return
      void saveProject(project)
      if (Date.now() - lastSnapshot > SNAPSHOT_EVERY) {
        lastSnapshot = Date.now()
        snapshot(project, `${project.blocks.length} moves`)
      }
    }, 400)
  }
}

/** True while an edit is debounced and not yet written to IndexedDB. */
export const hasPendingSave = () => saveTimer !== undefined && state.project !== null

export function flushSave() {
  clearTimeout(saveTimer)
  saveTimer = undefined
  if (state.project) void saveProject(state.project)
}

/**
 * Drops a queued write. A restore writes straight to IndexedDB, so a pending
 * save of the pre-restore project would land back on top of it.
 */
export function cancelPendingSave() {
  clearTimeout(saveTimer)
  saveTimer = undefined
}

export function set(patch: Partial<UiState>, persist = true) {
  state = { ...state, ...patch }
  emit(persist)
}

export const getState = () => state

export function useStore<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => select(state),
  )
}

export const uid = () => Math.random().toString(36).slice(2, 10)

const UNDO_LIMIT = 50
// A rename fires a mutation per keystroke; merge consecutive edits under the same
// key into the entry already on top of the stack instead of one step per letter.
const COALESCE_WINDOW = 800

let undoStack: Project[] = []
let redoStack: Project[] = []
let coalesce: { key: string; at: number } | null = null
// An open gesture (pointerdown..pointerup) holds its first mutation's "before" snapshot
// regardless of elapsed time, unlike `coalesce` which lapses after COALESCE_WINDOW.
let gesture: { key: string; pushed: boolean } | null = null

/**
 * Opens a gesture scope: every `withProject` call passing this same key merges into
 * the entry already pushed for it, however long the gesture runs. Call on pointerdown.
 */
export function beginGesture(key: string) {
  endGesture()
  gesture = { key, pushed: false }
}

/** Closes the gesture scope. Call from the same cleanup that removes the pointermove listener. */
export function endGesture() {
  gesture = null
}

/** Pushes `previous` unless it merges with the in-progress coalesce run or open gesture. Always drops redo: a new edit invalidates it. */
function pushHistory(previous: Project, coalesceKey?: string) {
  const now = Date.now()
  const inGesture = !!coalesceKey && gesture !== null && gesture.key === coalesceKey
  const merging = inGesture
    ? gesture!.pushed
    : !!coalesceKey && coalesce !== null && coalesce.key === coalesceKey && now - coalesce.at < COALESCE_WINDOW
  if (!merging) {
    undoStack.push(previous)
    if (undoStack.length > UNDO_LIMIT) undoStack.shift()
  }
  if (inGesture) gesture!.pushed = true
  coalesce = coalesceKey ? { key: coalesceKey, at: now } : null
  redoStack = []
}

function withProject(fn: (p: Project) => Project, coalesceKey?: string) {
  if (!state.project) return
  pushHistory(state.project, coalesceKey)
  set({ project: { ...fn(state.project), updatedAt: Date.now() }, canUndo: true, canRedo: false })
}

export function undo() {
  if (!state.project || undoStack.length === 0) return
  const previous = undoStack.pop()!
  redoStack.push(state.project)
  if (redoStack.length > UNDO_LIMIT) redoStack.shift()
  coalesce = null
  gesture = null
  set({ project: previous, canUndo: undoStack.length > 0, canRedo: true })
}

export function redo() {
  if (!state.project || redoStack.length === 0) return
  const next = redoStack.pop()!
  undoStack.push(state.project)
  if (undoStack.length > UNDO_LIMIT) undoStack.shift()
  coalesce = null
  gesture = null
  set({ project: next, canUndo: true, canRedo: redoStack.length > 0 })
}

/**
 * Chokepoint for writes that REPLACE the whole project (new file, backup restore, sync
 * pull). Undoing past a document that arrived from elsewhere is incoherent, so both stacks reset.
 */
export function replaceProject(project: Project, patch: Partial<UiState> = {}, persist = true) {
  undoStack = []
  redoStack = []
  coalesce = null
  gesture = null
  set({ project, canUndo: false, canRedo: false, ...patch }, persist)
}

export const updateProject = (patch: Partial<Project>, coalesceKey?: string) =>
  withProject((p) => ({ ...p, ...patch }), coalesceKey)

export const updateSegment = (id: string, patch: Partial<Segment>, coalesceKey?: string) =>
  withProject((p) => ({ ...p, segments: p.segments.map((s) => (s.id === id ? { ...s, ...patch } : s)) }), coalesceKey)

export function addSegment(seg: Segment) {
  withProject((p) => ({ ...p, segments: [...p.segments, seg].sort((a, b) => a.start - b.start) }))
}

export function removeSegment(id: string) {
  withProject((p) => ({
    ...p,
    segments: p.segments.filter((s) => s.id !== id),
    blocks: p.blocks.filter((b) => b.segmentId !== id),
  }))
}

export const addMarker = (marker: Marker) =>
  withProject((p) => ({ ...p, markers: [...p.markers, marker].sort((a, b) => a.time - b.time) }))

export const updateMarker = (id: string, patch: Partial<Marker>, coalesceKey?: string) =>
  withProject(
    (p) => ({
      ...p,
      markers: p.markers.map((m) => (m.id === id ? { ...m, ...patch } : m)).sort((a, b) => a.time - b.time),
    }),
    coalesceKey,
  )

export const removeMarker = (id: string) => withProject((p) => ({ ...p, markers: p.markers.filter((m) => m.id !== id) }))

export const addBlocks = (blocks: Block[]) => withProject((p) => ({ ...p, blocks: [...p.blocks, ...blocks] }))

export const updateBlock = (id: string, patch: Partial<Block>, coalesceKey?: string) =>
  withProject((p) => ({ ...p, blocks: p.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) }), coalesceKey)

export const removeBlocks = (ids: string[]) =>
  withProject((p) => ({ ...p, blocks: p.blocks.filter((b) => !ids.includes(b.id)) }))

export const upsertMove = (move: Move, coalesceKey?: string) =>
  withProject(
    (p) => ({
      ...p,
      moves: p.moves.some((m) => m.id === move.id) ? p.moves.map((m) => (m.id === move.id ? move : m)) : [...p.moves, move],
    }),
    coalesceKey,
  )

export const removeMove = (id: string) =>
  withProject((p) => ({ ...p, moves: p.moves.filter((m) => m.id !== id), blocks: p.blocks.filter((b) => b.moveId !== id) }))

/**
 * Clears anything overlapping [startBeat, startBeat+beats) in the segment, so
 * dropping onto occupied counts replaces rather than stacks.
 */
export function clearRange(segmentId: string, startBeat: number, beats: number) {
  withProject((p) => ({
    ...p,
    blocks: p.blocks.filter(
      (b) => b.segmentId !== segmentId || b.startBeat + b.beats <= startBeat || b.startBeat >= startBeat + beats,
    ),
  }))
}

export function flash(message: string) {
  set({ status: message }, false)
  setTimeout(() => set({ status: null }, false), 2600)
}
