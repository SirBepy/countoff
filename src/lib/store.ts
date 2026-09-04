import { useSyncExternalStore } from 'react'
import {
  isComment,
  type Block,
  type Clip,
  type Focus,
  type FloorSize,
  type Marker,
  type Move,
  type Movement,
  type Person,
  type Project,
  type Segment,
  type Side,
  type Take,
} from './types'
import { saveProject } from './db'
import { snapshot } from './backup'

export interface Selection {
  segmentId: string
  startBeat: number
  beats: number
}

/** An open sheet context menu. `blockId` absent means it opened on bare counts. */
export interface SheetMenu {
  x: number
  y: number
  segmentId: string
  startBeat: number
  blockId?: string
  /** Span a comment or a picked move should cover; only set for the bare-counts menu. */
  defaultBeats?: number
}

export interface UiState {
  project: Project | null
  audioUrl: string | null
  selection: Selection | null
  view: 'sheet' | 'rehearse' | 'setup' | 'floor' | 'video'
  activeMoveId: string | null
  status: string | null
  /** Scroll the sheet to keep the playing 8-count on screen. */
  follow: boolean
  /** Only meaningful under 900px, where the move rail is a bottom sheet. */
  libraryOpen: boolean
  /** Which lyric line's inline editor is open, so a hand-placed line can land in edit mode immediately. */
  editingLyricId: string | null
  /** Which block's note editor is open; opened from the sheet menu's Edit item. */
  editingBlockNoteId: string | null
  /** The open right-click / long-press menu on the sheet, positioned in viewport coords. */
  sheetMenu: SheetMenu | null
  /** Counts a move created from the sheet menu should land on once it is saved. */
  pendingPlacement: { segmentId: string; startBeat: number } | null
  /** Mirrors the undo/redo stacks so buttons can grey out without reaching into store internals. */
  canUndo: boolean
  canRedo: boolean
  /** Drops the cast's cue tags from the sheet, which crowd out the moves on a full number. */
  hideCast: boolean
  /** A /v/<token> share is open. Every mutation and every persist is refused. */
  readOnly: boolean
  /** Object URLs for takes whose file is on THIS device, keyed by take id. Out of the
   *  project for the same reason `audioUrl` is: a blob URL means nothing anywhere else. */
  takeUrls: Record<string, string>
  /** 0..1 per take id with a backup in flight; absent means idle, not done. */
  takeUploads: Record<string, number>
}

interface StoreSingleton {
  state: UiState
  listeners: Set<() => void>
  saveTimer: number | undefined
  lastSnapshot: number
  undoStack: Project[]
  redoStack: Project[]
  coalesce: { key: string; at: number } | null
  /** An open gesture (pointerdown..pointerup) holds its first mutation's "before" snapshot
   *  regardless of elapsed time, unlike `coalesce` which lapses after COALESCE_WINDOW. */
  gesture: { key: string; pushed: boolean } | null
}

// A dev-mode hot reload re-runs this module while Fast Refresh keeps App's own `booted`
// true, so a plain module-scope `let` drops the open project behind a live screen. Same
// globalThis anchor lib/audio.ts uses, and the whole mutable set is anchored, not just
// the project: undo history resetting under an open document is the same bug.
const HMR_KEY = '__countoffStore'
const globalAny = globalThis as unknown as Record<string, StoreSingleton | undefined>
const S: StoreSingleton = globalAny[HMR_KEY] ?? {
  state: {
    project: null,
    audioUrl: null,
    selection: null,
    view: 'sheet',
    activeMoveId: null,
    status: null,
    follow: true,
    libraryOpen: false,
    editingLyricId: null,
    editingBlockNoteId: null,
    sheetMenu: null,
    pendingPlacement: null,
    canUndo: false,
    canRedo: false,
    hideCast: false,
    readOnly: false,
    takeUrls: {},
    takeUploads: {},
  },
  listeners: new Set(),
  saveTimer: undefined,
  lastSnapshot: 0,
  undoStack: [],
  redoStack: [],
  coalesce: null,
  gesture: null,
}
globalAny[HMR_KEY] = S

/** A view preference, not part of the choreography, so it stays out of the project
 *  document and never rides along in a backup or a sync. */
const castKey = (projectId: string) => `countoff.hideCast.${projectId}`

export const readHideCast = (projectId: string) => localStorage.getItem(castKey(projectId)) === '1'

export function toggleHideCast() {
  const project = S.state.project
  if (!project) return
  const hideCast = !S.state.hideCast
  localStorage.setItem(castKey(project.id), hideCast ? '1' : '0')
  set({ hideCast }, false)
}

const SNAPSHOT_EVERY = 60_000

function emit(persist = true) {
  S.listeners.forEach((l) => l())
  if (persist && S.state.project && !S.state.readOnly) {
    clearTimeout(S.saveTimer)
    S.saveTimer = setTimeout(() => {
      const project = S.state.project
      if (!project) return
      void saveProject(project)
      if (Date.now() - S.lastSnapshot > SNAPSHOT_EVERY) {
        S.lastSnapshot = Date.now()
        snapshot(project, `${project.blocks.length} moves`)
      }
    }, 400)
  }
}

/** True while an edit is debounced and not yet written to IndexedDB. */
export const hasPendingSave = () => S.saveTimer !== undefined && S.state.project !== null

export function flushSave() {
  clearTimeout(S.saveTimer)
  S.saveTimer = undefined
  if (S.state.project && !S.state.readOnly) void saveProject(S.state.project)
}

/**
 * Drops a queued write. A restore writes straight to IndexedDB, so a pending
 * save of the pre-restore project would land back on top of it.
 */
export function cancelPendingSave() {
  clearTimeout(S.saveTimer)
  S.saveTimer = undefined
}

export function set(patch: Partial<UiState>, persist = true) {
  S.state = { ...S.state, ...patch }
  emit(persist)
}

export const getState = () => S.state

export function useStore<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      S.listeners.add(cb)
      return () => S.listeners.delete(cb)
    },
    () => select(S.state),
  )
}

export const uid = () => Math.random().toString(36).slice(2, 10)

const UNDO_LIMIT = 50
// A rename fires a mutation per keystroke; merge consecutive edits under the same
// key into the entry already on top of the stack instead of one step per letter.
const COALESCE_WINDOW = 800


/**
 * Opens a gesture scope: every `withProject` call passing this same key merges into
 * the entry already pushed for it, however long the gesture runs. Call on pointerdown.
 */
export function beginGesture(key: string) {
  endGesture()
  S.gesture = { key, pushed: false }
}

/** Closes the gesture scope. Call from the same cleanup that removes the pointermove listener. */
export function endGesture() {
  S.gesture = null
}

/** Pushes `previous` unless it merges with the in-progress coalesce run or open gesture. Always drops redo: a new edit invalidates it. */
function pushHistory(previous: Project, coalesceKey?: string) {
  const now = Date.now()
  const inGesture = !!coalesceKey && S.gesture !== null && S.gesture.key === coalesceKey
  const merging = inGesture
    ? S.gesture!.pushed
    : !!coalesceKey && S.coalesce !== null && S.coalesce.key === coalesceKey && now - S.coalesce.at < COALESCE_WINDOW
  if (!merging) {
    S.undoStack.push(previous)
    if (S.undoStack.length > UNDO_LIMIT) S.undoStack.shift()
  }
  if (inGesture) S.gesture!.pushed = true
  S.coalesce = coalesceKey ? { key: coalesceKey, at: now } : null
  S.redoStack = []
}

// The single chokepoint every project mutation passes through, so refusing here is
// what makes a shared view read-only even if a screen forgets to hide its own buttons.
function withProject(fn: (p: Project) => Project, coalesceKey?: string) {
  if (!S.state.project || S.state.readOnly) return
  pushHistory(S.state.project, coalesceKey)
  set({ project: { ...fn(S.state.project), updatedAt: Date.now() }, canUndo: true, canRedo: false })
}

export function undo() {
  if (!S.state.project || S.state.readOnly || S.undoStack.length === 0) return
  const previous = S.undoStack.pop()!
  S.redoStack.push(S.state.project)
  if (S.redoStack.length > UNDO_LIMIT) S.redoStack.shift()
  S.coalesce = null
  S.gesture = null
  set({ project: previous, canUndo: S.undoStack.length > 0, canRedo: true })
}

export function redo() {
  if (!S.state.project || S.state.readOnly || S.redoStack.length === 0) return
  const next = S.redoStack.pop()!
  S.undoStack.push(S.state.project)
  if (S.undoStack.length > UNDO_LIMIT) S.undoStack.shift()
  S.coalesce = null
  S.gesture = null
  set({ project: next, canUndo: true, canRedo: S.redoStack.length > 0 })
}

/**
 * Chokepoint for writes that REPLACE the whole project (new file, backup restore, sync
 * pull). Undoing past a document that arrived from elsewhere is incoherent, so both stacks reset.
 */
export function replaceProject(project: Project, patch: Partial<UiState> = {}, persist = true) {
  S.undoStack = []
  S.redoStack = []
  S.coalesce = null
  S.gesture = null
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

/** Adds a comment spanning counts and opens its editor, so the text is typed in one go. */
export function addComment(segmentId: string, startBeat: number, beats: number) {
  const id = uid()
  withProject((p) => ({ ...p, blocks: [...p.blocks, { id, segmentId, startBeat, beats }] }))
  set({ editingBlockNoteId: id, sheetMenu: null }, false)
}

/**
 * Drops a copy immediately after the original. A move overwrites the moves it lands
 * on, matching a fill; a comment overlays instead, since annotating is not occupying.
 */
export function duplicateBlock(id: string) {
  const source = S.state.project?.blocks.find((b) => b.id === id)
  if (!source) return
  const copy = { ...source, id: uid(), startBeat: source.startBeat + source.beats }
  withProject((p) => ({
    ...p,
    blocks: [
      ...(isComment(copy)
        ? p.blocks
        : p.blocks.filter(
            (b) =>
              isComment(b) ||
              b.segmentId !== copy.segmentId ||
              b.startBeat + b.beats <= copy.startBeat ||
              b.startBeat >= copy.startBeat + copy.beats,
          )),
      copy,
    ],
  }))
  return copy.id
}

/**
 * Paint order is array order, so a block hidden under another is rescued by moving it
 * last. Lane stacking keeps most overlaps visible; this covers the ones it cannot.
 */
export const restackBlock = (id: string, to: 'front' | 'back') =>
  withProject((p) => {
    const block = p.blocks.find((b) => b.id === id)
    if (!block) return p
    const rest = p.blocks.filter((b) => b.id !== id)
    return { ...p, blocks: to === 'front' ? [...rest, block] : [block, ...rest] }
  })

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
 * Clears the moves overlapping [startBeat, startBeat+beats) in the segment, so
 * dropping onto occupied counts replaces rather than stacks. Comments survive it.
 */
export function clearRange(segmentId: string, startBeat: number, beats: number) {
  withProject((p) => ({
    ...p,
    blocks: p.blocks.filter(
      (b) =>
        isComment(b) ||
        b.segmentId !== segmentId ||
        b.startBeat + b.beats <= startBeat ||
        b.startBeat >= startBeat + beats,
    ),
  }))
}

export const addPerson = (person: Person) => withProject((p) => ({ ...p, people: [...p.people, person] }))

export const updatePerson = (id: string, patch: Partial<Person>, coalesceKey?: string) =>
  withProject((p) => ({ ...p, people: p.people.map((x) => (x.id === id ? { ...x, ...patch } : x)) }), coalesceKey)

/** Removing someone takes their whole path with them, or it lingers as an unnamed puck. */
export const removePerson = (id: string) =>
  withProject((p) => ({
    ...p,
    people: p.people.filter((x) => x.id !== id),
    movements: p.movements.filter((m) => m.personId !== id),
  }))

export const updateMovement = (id: string, patch: Partial<Movement>, coalesceKey?: string) =>
  withProject((p) => ({ ...p, movements: p.movements.map((m) => (m.id === id ? { ...m, ...patch } : m)) }), coalesceKey)

export const removeMovement = (id: string) =>
  withProject((p) => ({ ...p, movements: p.movements.filter((m) => m.id !== id) }))

/**
 * Sets where someone must be on a count, keyed by that count: dragging a puck across
 * ten cells retimes one movement rather than leaving ten behind it.
 */
export const placeMovement = (
  personId: string,
  segmentId: string,
  beat: number,
  to: { col: number; row: number } | null,
  side?: Side,
  coalesceKey?: string,
) =>
  withProject((p) => {
    const existing = p.movements.find((m) => m.personId === personId && m.segmentId === segmentId && m.beat === beat)
    if (existing) {
      return {
        ...p,
        movements: p.movements.map((m) => (m.id === existing.id ? { ...m, to, ...(side ? { side } : {}) } : m)),
      }
    }
    // A walk cannot start before the song does, so an early count shortens rather than refuses.
    const travel = Math.min(p.walkCounts, beat)
    return { ...p, movements: [...p.movements, { id: uid(), personId, segmentId, beat, travel, to, side }] }
  }, coalesceKey)

/** Registers footage held on this device. Revokes whatever that take pointed at before. */
export function setTakeUrl(takeId: string, url: string | null) {
  const previous = S.state.takeUrls[takeId]
  if (previous && previous !== url) URL.revokeObjectURL(previous)
  const takeUrls = { ...S.state.takeUrls }
  if (url) takeUrls[takeId] = url
  else delete takeUrls[takeId]
  set({ takeUrls }, false)
}

export function setTakeUploadProgress(takeId: string, fraction: number | null) {
  const takeUploads = { ...S.state.takeUploads }
  if (fraction === null) delete takeUploads[takeId]
  else takeUploads[takeId] = fraction
  set({ takeUploads }, false)
}

/** A finished upload is not an edit, so it skips undo history: a Ctrl+Z that stranded
 *  footage already sitting in the bucket would be nonsense. Still refuses in read-only. */
export function setTakeRemoteUrl(takeId: string, url: string) {
  const p = S.state.project
  if (!p || S.state.readOnly) return
  const takes = p.takes.map((t) => (t.id === takeId ? { ...t, url } : t))
  set({ project: { ...p, takes, updatedAt: Date.now() } })
}

export const addTake = (take: Take) => withProject((p) => ({ ...p, takes: [...p.takes, take] }))

/** Dropping a take takes its clips with it, or the track keeps empty boxes with no footage behind them. */
export const removeTake = (id: string) =>
  withProject((p) => ({
    ...p,
    takes: p.takes.filter((t) => t.id !== id),
    clips: p.clips.filter((c) => c.takeId !== id),
  }))

export const addClip = (clip: Clip) => withProject((p) => ({ ...p, clips: [...p.clips, clip] }))

export const updateClip = (id: string, patch: Partial<Clip>, coalesceKey?: string) =>
  withProject((p) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }), coalesceKey)

export const removeClip = (id: string) => withProject((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== id) }))

/** Resizing pulls anyone standing past the new edge back onto the floor, chair included. */
export const setFloorSize = (floor: FloorSize) =>
  withProject((p) => {
    const fit = (cell: { col: number; row: number }) => ({
      col: Math.min(cell.col, floor.cols - 1),
      row: Math.min(cell.row, floor.rows - 1),
    })
    return {
      ...p,
      floor,
      movements: p.movements.map((m) => (m.to ? { ...m, to: fit(m.to) } : m)),
      // Every chair keyframe needs the same pull-back as the chair's own cell, or a
      // shrunk floor leaves the move heading off the edge.
      focus:
        p.focus.kind === 'person'
          ? { ...p.focus, ...fit(p.focus), keys: p.focus.keys?.map((k) => ({ ...k, to: fit(k.to) })) }
          : p.focus,
    }
  })

export const setWalkCounts = (walkCounts: number) => updateProject({ walkCounts })

/** Pins a timeline lane so it stays in view, or unpins it if it already is. */
export const togglePin = (id: string) =>
  withProject((p) => ({
    ...p,
    pinned: p.pinned.includes(id) ? p.pinned.filter((x) => x !== id) : [...p.pinned, id],
  }))

export const setFocus = (focus: Focus, coalesceKey?: string) => updateProject({ focus }, coalesceKey)

/** Writes where the chair must be on one count, the same upsert-by-count rule
 *  `placeMovement` follows, so dragging across ten cells retimes one key. */
export const placeFocusKey = (
  segmentId: string,
  beat: number,
  to: { col: number; row: number },
  coalesceKey?: string,
) =>
  withProject((p) => {
    if (p.focus.kind !== 'person') return p
    const keys = p.focus.keys ?? []
    const existing = keys.find((k) => k.segmentId === segmentId && k.beat === beat)
    if (existing) {
      return { ...p, focus: { ...p.focus, keys: keys.map((k) => (k.id === existing.id ? { ...k, to } : k)) } }
    }
    // A move cannot start before the song does, so an early count shortens rather than refuses.
    const travel = Math.min(p.walkCounts, beat)
    return { ...p, focus: { ...p.focus, keys: [...keys, { id: uid(), segmentId, beat, travel, to }] } }
  }, coalesceKey)

/** Back to one static chair, and back to the pre-keyframe shape on disk. */
export const clearFocusKeys = () =>
  withProject((p) => (p.focus.kind === 'person' ? { ...p, focus: { ...p.focus, keys: undefined } } : p))

export function flash(message: string) {
  set({ status: message }, false)
  setTimeout(() => set({ status: null }, false), 2600)
}
