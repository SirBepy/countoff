import type { Project } from './types'

const DB_NAME = 'countoff'
const DB_VERSION = 1
const STORES = ['project', 'audio', 'clips'] as const

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

/** Fills in fields added after a project was last saved, so older files still open. */
function migrate(p: Project | undefined): Project | undefined {
  if (!p) return p
  return {
    ...p,
    markers: p.markers ?? [],
    blocks: p.blocks ?? [],
    segments: (p.segments ?? []).map((s) => ({ ...s, lyrics: s.lyrics ?? [], lyricOffset: s.lyricOffset ?? 0 })),
  }
}

export const loadProject = () =>
  tx<Project | undefined>('project', 'readonly', (s) => s.get('current')).then(migrate)

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
