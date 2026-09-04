import { DEFAULT_FLOOR, DEFAULT_WALK_COUNTS, movementsFromFormations } from './floor'
import { DEFAULT_COUNTS_PER_ROW } from './grid'
import { uid } from './store'
import type { Marker, Project, Segment } from './types'

const DB_NAME = 'countoff'
const DB_VERSION = 2
const STORES = ['project', 'audio', 'clips', 'takes'] as const
const ACTIVE_KEY = 'countoff.activeProjectId'

// Pre-collapse marker shape: retired 2026-08-27 when `kind` merged into `label`.
const OLD_KIND_LABEL: Record<string, string> = { transition: 'Transition', drop: 'Drop', break: 'Break', cue: 'Cue' }

/** Old markers carried `kind` with no free-text label; give the dev back what it meant. */
function migrateMarker(m: Marker & { kind?: string }): Marker {
  const { kind, ...rest } = m
  const label = rest.label || (kind ? (OLD_KIND_LABEL[kind] ?? kind) : rest.label)
  return { ...rest, label }
}

let dbPromise: Promise<IDBDatabase> | null = null

const CLIPS_PURGED_KEY = 'countoff.clipsPurged'

/** One-time cleanup for the recorded-clip feature that got dropped in favor of
 * video links. Guarded by a flag so a repeat boot is a no-op, not a rescan. */
function purgeClips(db: IDBDatabase) {
  if (localStorage.getItem(CLIPS_PURGED_KEY)) return
  if (db.objectStoreNames.contains('clips')) db.transaction('clips', 'readwrite').objectStore('clips').clear()
  localStorage.setItem(CLIPS_PURGED_KEY, '1')
}

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      for (const store of STORES) {
        if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store)
      }
    }
    req.onsuccess = () => {
      purgeClips(req.result)
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(store, mode).objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const getActiveProjectId = () => localStorage.getItem(ACTIVE_KEY)
export const setActiveProjectId = (id: string) => localStorage.setItem(ACTIVE_KEY, id)

/** Writes the record without touching which project is active; use for editing a project that isn't the open one. */
export const saveProjectRecord = (p: Project) => tx('project', 'readwrite', (s) => s.put(p, p.id))

export async function saveProject(p: Project): Promise<void> {
  await saveProjectRecord(p)
  setActiveProjectId(p.id)
}

type LegacyProject = Project & { formations?: Parameters<typeof movementsFromFormations>[0] }

/** Fills in fields added after a project was last saved. Exported so backup import
 * and sync pull, which skip loadProject, apply the same backfill. */
export function migrateProject(raw: Project): Project {
  // Dropped rather than spread through, or a retired field rides along in every backup.
  const { formations, ...p } = raw as LegacyProject
  return {
    ...p,
    markers: (p.markers ?? []).map(migrateMarker),
    blocks: p.blocks ?? [],
    // Pre-floor shape: a project saved before the floor view carries none of these.
    people: p.people ?? [],
    focus: p.focus ?? { kind: 'audience' },
    floor: p.floor ?? DEFAULT_FLOOR,
    walkCounts: p.walkCounts ?? DEFAULT_WALK_COUNTS,
    pinned: p.pinned ?? [],
    // Pre-movement shape: retired 2026-09-03 when whole-cast formations became per-person walks.
    movements: p.movements ?? movementsFromFormations(formations ?? [], p.segments ?? [], uid),
    // Pre-video shape: a project saved before footage could be laid over the song.
    takes: p.takes ?? [],
    clips: p.clips ?? [],
    // Pre-transition shape: retired 2026-08-27 when count length and transitions went per-song.
    segments: (p.segments ?? []).map((rawSegment) => {
      const { beatsPerBar, lyricOffset, ...s } = rawSegment as Segment & { beatsPerBar?: number; lyricOffset?: number }
      return {
        ...s,
        lyrics: (s.lyrics ?? []).map((l) => (l.id ? l : { ...l, id: uid() })),
        // Pre-fit shape: retired 2026-08-27 when the flat offset became offset+scale.
        fit: s.fit ?? { offset: lyricOffset ?? 0, scale: 1 },
        countsPerRow: s.countsPerRow ?? DEFAULT_COUNTS_PER_ROW,
        transitionIn: s.transitionIn ?? 0,
      }
    }),
  }
}

function migrate(p: Project | undefined): Project | undefined {
  return p ? migrateProject(p) : p
}

/** Loads and migrates the project at `id`, writing the migrated shape back so it
 * doesn't linger old-shape in IndexedDB. Never touches which project is active. */
export async function loadProjectById(id: string): Promise<Project | undefined> {
  const raw = await tx<Project | undefined>('project', 'readonly', (s) => s.get(id))
  const migrated = migrate(raw)
  if (migrated && JSON.stringify(migrated) !== JSON.stringify(raw)) await saveProjectRecord(migrated)
  return migrated
}

export async function loadProject(): Promise<Project | undefined> {
  const id = getActiveProjectId()
  return id ? loadProjectById(id) : undefined
}

export const saveAudio = (id: string, blob: Blob) => tx('audio', 'readwrite', (s) => s.put(blob, id))

/** Footage lives per device, keyed by take id, the same way the song lives keyed by project id. */
export const saveTakeFile = (takeId: string, blob: Blob) => tx('takes', 'readwrite', (s) => s.put(blob, takeId))

export const loadTakeFile = (takeId: string) => tx<Blob | undefined>('takes', 'readonly', (s) => s.get(takeId))

export const deleteTakeFile = (takeId: string) => tx('takes', 'readwrite', (s) => s.delete(takeId))

/** Falls back to the active project when called with no id, e.g. bpm.ts's tempo re-detect. */
export function loadAudio(id?: string): Promise<Blob | undefined> {
  const key = id ?? getActiveProjectId()
  return key ? tx<Blob | undefined>('audio', 'readonly', (s) => s.get(key)) : Promise.resolve(undefined)
}

export async function listProjects(): Promise<Project[]> {
  const all = await tx<Project[]>('project', 'readonly', (s) => s.getAll())
  return all.filter((p) => p && p.id).sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteProject(id: string): Promise<void> {
  await tx('project', 'readwrite', (s) => s.delete(id))
  await tx('audio', 'readwrite', (s) => s.delete(id))
}

export async function duplicateProject(id: string): Promise<Project> {
  const source = await loadProjectById(id)
  if (!source) throw new Error('Project not found')
  const newId = uid()
  const copy: Project = { ...source, id: newId, name: `${source.name} copy`, updatedAt: Date.now() }
  await saveProjectRecord(copy)

  const audioBlob = await tx<Blob | undefined>('audio', 'readonly', (s) => s.get(id))
  if (audioBlob) await tx('audio', 'readwrite', (s) => s.put(audioBlob, newId))
  return copy
}

/**
 * One-time move off the pre-library key scheme (everything under the literal key
 * 'current'). Safe on every boot: once that record is gone there is nothing left to migrate.
 */
export async function migrateKeySpace(): Promise<void> {
  const legacy = await tx<Project | undefined>('project', 'readonly', (s) => s.get('current'))
  if (!legacy) return
  const id = legacy.id
  // Without an id there is nowhere to move it to, and deleting 'current' would
  // orphan the only copy. Leave it alone and let the app read it as-is.
  if (!id) return
  await saveProjectRecord(legacy)
  await tx('project', 'readwrite', (s) => s.delete('current'))
  setActiveProjectId(id)

  const legacyAudio = await tx<Blob | undefined>('audio', 'readonly', (s) => s.get('current'))
  if (legacyAudio) {
    await tx('audio', 'readwrite', (s) => s.put(legacyAudio, id))
    await tx('audio', 'readwrite', (s) => s.delete('current'))
  }

  // Same move, same key format backup.ts already uses: carry the rolling history over too.
  const legacySnapshots = localStorage.getItem('countoff.snapshots')
  if (legacySnapshots) {
    localStorage.setItem(`countoff.snapshots.${id}`, legacySnapshots)
    localStorage.removeItem('countoff.snapshots')
  }
}
