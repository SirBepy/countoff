import { DEFAULT_COUNTS_PER_ROW } from './grid'
import { uid } from './store'
import type { Marker, Project, Segment } from './types'

const DB_NAME = 'countoff'
const DB_VERSION = 1
const STORES = ['project', 'audio', 'clips'] as const

// Pre-collapse marker shape: retired 2026-08-27 when `kind` merged into `label`.
const OLD_KIND_LABEL: Record<string, string> = { transition: 'Transition', drop: 'Drop', break: 'Break', cue: 'Cue' }

/** Old markers carried `kind` with no free-text label; give the dev back what it meant. */
function migrateMarker(m: Marker & { kind?: string }): Marker {
  const { kind, ...rest } = m
  const label = rest.label || (kind ? (OLD_KIND_LABEL[kind] ?? kind) : rest.label)
  return { ...rest, label }
}

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      for (const store of STORES) {
        if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store)
      }
    }
    req.onsuccess = () => resolve(req.result)
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

export const saveProject = (p: Project) => tx('project', 'readwrite', (s) => s.put(p, 'current'))

/** Fills in fields added after a project was last saved. Exported so backup import
 * and sync pull, which skip loadProject, apply the same backfill. */
export function migrateProject(p: Project): Project {
  return {
    ...p,
    markers: (p.markers ?? []).map(migrateMarker),
    blocks: p.blocks ?? [],
    // Pre-transition shape: retired 2026-08-27 when count length and transitions went per-song.
    segments: (p.segments ?? []).map((raw) => {
      const { beatsPerBar, lyricOffset, ...s } = raw as Segment & { beatsPerBar?: number; lyricOffset?: number }
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

/** Loads and migrates, then writes the migrated shape back so it doesn't linger
 * old-shape in IndexedDB until the dev's first edit saves over it. */
export async function loadProject(): Promise<Project | undefined> {
  const raw = await tx<Project | undefined>('project', 'readonly', (s) => s.get('current'))
  const migrated = migrate(raw)
  if (migrated && JSON.stringify(migrated) !== JSON.stringify(raw)) await saveProject(migrated)
  return migrated
}

export const saveAudio = (blob: Blob) => tx('audio', 'readwrite', (s) => s.put(blob, 'current'))
export const loadAudio = () => tx<Blob | undefined>('audio', 'readonly', (s) => s.get('current'))

export const saveClip = (moveId: string, blob: Blob) => tx('clips', 'readwrite', (s) => s.put(blob, moveId))
export const loadClip = (moveId: string) => tx<Blob | undefined>('clips', 'readonly', (s) => s.get(moveId))
export const deleteClip = (moveId: string) => tx('clips', 'readwrite', (s) => s.delete(moveId))

export async function wipe() {
  const db = await open()
  await Promise.all(
    STORES.map(
      (store) =>
        new Promise<void>((resolve, reject) => {
          const req = db.transaction(store, 'readwrite').objectStore(store).clear()
          req.onsuccess = () => resolve()
          req.onerror = () => reject(req.error)
        }),
    ),
  )
}
