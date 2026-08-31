import { useSyncExternalStore } from 'react'
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { getActiveProjectId, listProjects, loadProjectById, migrateProject, saveProject, saveProjectRecord } from './db'
import { db, getCurrentUser, subscribeAuth } from './firebase'
import { cancelPendingSave, flash, getState, replaceProject, set } from './store'
import type { Project } from './types'

// A Firestore write is a real network round trip, not a local write. This waits well
// past the 400ms local-save debounce (store.ts) for edits to actually settle before
// spending a write, so a burst of drags does not fire one write each.
const PUSH_DEBOUNCE = 8_000
const KEY_LAST_SYNC = 'countoff.sync.lastSyncedAt'

interface Conflict {
  local: Project
  remote: Project
}

export interface SyncAllResult {
  pushed: number
  failed: { id: string; name: string }[]
}

let syncing = false
let lastError: string | null = null
let conflict: Conflict | null = null
// Per project id: the remote doc's own updatedAt, so a push can tell a genuinely
// newer remote write apart from the one it last read.
const remoteUpdatedAts: Record<string, number> = {}
let pushTimer: ReturnType<typeof setTimeout> | undefined
let wasSignedIn = !!getCurrentUser()

const listeners = new Set<() => void>()

export interface SyncStatus {
  configured: boolean
  syncing: boolean
  lastError: string | null
  lastSyncedAt: number | null
  conflict: Conflict | null
  email: string | null
}

const getLastSyncedAt = (): number | null => {
  const raw = localStorage.getItem(KEY_LAST_SYNC)
  return raw ? Number(raw) : null
}

const setLastSyncedAt = (at: number) => localStorage.setItem(KEY_LAST_SYNC, String(at))

const buildStatus = (): SyncStatus => {
  const user = getCurrentUser()
  return { configured: !!user, syncing, lastError, lastSyncedAt: getLastSyncedAt(), conflict, email: user?.email ?? null }
}

// useSyncExternalStore compares snapshots by reference; a fresh object per call loops forever.
let cachedStatus = buildStatus()

function emit() {
  cachedStatus = buildStatus()
  listeners.forEach((l) => l())
}

const getSnapshot = (): SyncStatus => cachedStatus

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore((cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }, getSnapshot)
}

// Firestore rejects undefined field values; round-tripping through JSON drops them
// (Move.note, Block.note, Segment.lrcSource, etc.) the same way JSON.stringify already does.
const stripUndefined = (project: Project): Project => JSON.parse(JSON.stringify(project))

const projectRef = (uid: string, id: string) => doc(db, 'users', uid, 'projects', id)

/** Writes to IndexedDB, cancels the debounced local save, then adopts in memory.
 * Cancels before the adopt: a network round trip can easily outlast the 400ms window ad4299b guards. */
async function adoptRemoteProject(remoteProject: Project) {
  const project = migrateProject(remoteProject)
  await saveProject(project)
  cancelPendingSave()
  // Undoing past a document that arrived from the other device is incoherent.
  replaceProject(project, { selection: null }, false)
}

/** Same shape as adoptRemoteProject but for a project that isn't the open one:
 * write straight to IndexedDB, never touch which project is active or in memory. */
const saveRemoteProjectToDb = (remoteProject: Project) => saveProjectRecord(migrateProject(remoteProject))

/** Pulls down every project doc, but only ever adopts the ACTIVE one into memory.
 * Adopting a non-active project would silently switch which choreography is on screen. */
export async function pullNow(): Promise<void> {
  const user = getCurrentUser()
  if (!user || syncing) return
  syncing = true
  emit()
  const failedIds: string[] = []
  try {
    const snap = await getDocs(collection(db, 'users', user.uid, 'projects'))
    const activeId = getActiveProjectId()
    for (const docSnap of snap.docs) {
      const id = docSnap.id
      try {
        const remote = docSnap.data() as Project
        remoteUpdatedAts[id] = remote.updatedAt
        const local = id === activeId ? getState().project : await loadProjectById(id)
        if (!local || remote.updatedAt > local.updatedAt) {
          if (id === activeId) await adoptRemoteProject(remote)
          else await saveRemoteProjectToDb(remote)
        }
      } catch {
        failedIds.push(id)
      }
    }
    setLastSyncedAt(Date.now())
    lastError = failedIds.length ? `Pull failed for ${failedIds.length} project(s)` : null
    if (failedIds.length) flash('Sync pull failed for some projects')
  } catch (e) {
    lastError = e instanceof Error ? e.message : 'Pull failed'
    flash('Sync pull failed')
  } finally {
    syncing = false
    emit()
  }
}

/** Reads the doc before writing: if it moved to something newer than what this
 * device last saw, that is a real conflict, replacing the sha check the GitHub PUT used. */
async function pushProjectDoc(uid: string, project: Project): Promise<Project | null> {
  const ref = projectRef(uid, project.id)
  const existing = await getDoc(ref)
  if (existing.exists()) {
    const remote = existing.data() as Project
    if (remote.updatedAt > project.updatedAt && remote.updatedAt !== remoteUpdatedAts[project.id]) return remote
  }
  await setDoc(ref, stripUndefined(project))
  remoteUpdatedAts[project.id] = project.updatedAt
  return null
}

export async function pushNow(): Promise<void> {
  const user = getCurrentUser()
  const project = getState().project
  if (!user || !project || syncing) return
  syncing = true
  conflict = null
  emit()
  try {
    const remoteConflict = await pushProjectDoc(user.uid, project)
    if (remoteConflict) {
      conflict = { local: project, remote: remoteConflict }
      flash('Sync conflict: the remote copy changed since your last sync')
    } else {
      setLastSyncedAt(Date.now())
      lastError = null
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : 'Push failed'
    flash('Sync push failed')
  } finally {
    syncing = false
    emit()
  }
}

/** Pushes every project in the local library, not just the open one. A conflict on one
 * project is collected, not fatal: the loop keeps going so the rest still sync. Each
 * project is its own doc, so pushing B can never touch A's remote copy. */
export async function pushAllProjects(): Promise<SyncAllResult> {
  const user = getCurrentUser()
  if (!user || syncing) return { pushed: 0, failed: [] }
  syncing = true
  conflict = null
  emit()
  const activeId = getActiveProjectId()
  const activeProject = getState().project
  const failed: { id: string; name: string }[] = []
  let pushed = 0
  try {
    const dbProjects = await listProjects()
    for (const dbProject of dbProjects) {
      // The active project's freshest state is in memory, not necessarily flushed to IndexedDB yet.
      const project = dbProject.id === activeId && activeProject ? activeProject : dbProject
      try {
        const remoteConflict = await pushProjectDoc(user.uid, project)
        if (remoteConflict) {
          if (project.id === activeId) conflict = { local: project, remote: remoteConflict }
          failed.push({ id: project.id, name: project.name })
        } else {
          pushed++
        }
      } catch {
        failed.push({ id: project.id, name: project.name })
      }
    }
    setLastSyncedAt(Date.now())
    lastError = failed.length ? `${failed.length} project${failed.length === 1 ? '' : 's'} failed to sync` : null
  } finally {
    syncing = false
    emit()
  }
  return { pushed, failed }
}

/** Called whenever the in-memory project changes; debounces the next push. */
export function scheduleSync(project: Project) {
  if (!getCurrentUser()) return
  const remoteUpdatedAt = remoteUpdatedAts[project.id]
  if (remoteUpdatedAt !== undefined && project.updatedAt <= remoteUpdatedAt) return
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => void pushNow(), PUSH_DEBOUNCE)
}

export async function resolveConflictKeepMine(): Promise<void> {
  if (!conflict) return
  const bumped = { ...conflict.local, updatedAt: Date.now() }
  conflict = null
  await saveProject(bumped)
  set({ project: bumped }, false)
  emit()
  await pushNow()
}

export async function resolveConflictTakeRemote(): Promise<void> {
  if (!conflict) return
  const remote = conflict.remote
  conflict = null
  await adoptRemoteProject(remote)
  remoteUpdatedAts[remote.id] = remote.updatedAt
  setLastSyncedAt(Date.now())
  emit()
}

/** First sign-in on a machine: pull whatever is already remote, then push anything
 * local that's newer or missing there, so what's on this device makes it up too. */
async function pushLocalOnlyOrNewer(): Promise<void> {
  const user = getCurrentUser()
  if (!user) return
  const activeId = getActiveProjectId()
  const activeProject = getState().project
  for (const dbProject of await listProjects()) {
    const project = dbProject.id === activeId && activeProject ? activeProject : dbProject
    const remoteUpdatedAt = remoteUpdatedAts[project.id]
    if (remoteUpdatedAt === undefined || project.updatedAt > remoteUpdatedAt) {
      await pushProjectDoc(user.uid, project).catch(() => {})
    }
  }
}

subscribeAuth(() => {
  const user = getCurrentUser()
  const justSignedIn = !wasSignedIn && !!user
  wasSignedIn = !!user
  emit()
  if (justSignedIn) void pullNow().then(pushLocalOnlyOrNewer)
})
