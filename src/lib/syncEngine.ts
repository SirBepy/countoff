import { useSyncExternalStore } from 'react'
import {
  WRITER_ID,
  canEdit,
  claimInvites,
  createProjectDoc,
  listLibrary,
  migrateLegacyProjects,
  readContent,
  readMeta,
  readMyRole,
  subscribeContent,
  writeProjectDoc,
  type LibraryEntry,
  type Role,
} from './collab'
import { getActiveProjectId, listProjects, loadProjectById, migrateProject, saveProject, saveProjectRecord } from './db'
import { getCurrentUser, subscribeAuth } from './firebase'
import { mirrorShare } from './share'
import { backUpSong } from './songFile'
import { backUpTakes } from './takeBackup'
import { cancelPendingSave, flash, getState, hasPendingSave, replaceProject, set } from './store'
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
/** What this account may do with each project it has seen this session. A push to a project
 *  this account only views would be refused by the rules anyway; this refuses it locally,
 *  before the round trip and the toast. */
const roles: Record<string, Role> = {}
let library: LibraryEntry[] = []
let pushTimer: ReturnType<typeof setTimeout> | undefined
let wasSignedIn = !!getCurrentUser()
let unwatch: (() => void) | null = null
let watching: string | null = null

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

/** The last library read, so the home screen can paint from cache while the fresh one lands. */
export const getLibrary = (): LibraryEntry[] => library

export const getRole = (id: string): Role | null => roles[id] ?? null

/** Re-resolves what this account may do with the open project. A page load hands the app its
 * last project well before Firebase has restored the session, so the role read at boot is
 * null for everybody: without this a viewer reloads into the full editing UI, and only finds
 * out it was never theirs to edit when the rules refuse the push. */
export async function refreshRole(): Promise<void> {
  const project = getState().project
  if (!project || getState().shareView) return
  const role = getCurrentUser() ? await readMyRole(project.id).catch(() => null) : null
  if (role) roles[project.id] = role
  set({ role, readOnly: role === 'viewer' }, false)
}

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

/** Pulls the library, then adopts only the ACTIVE project into memory. Adopting a non-active
 * project would silently switch which choreography is on screen. Each entry's `updatedAt`
 * comes off the small project document, so an unchanged project costs no content read. */
export async function pullNow(): Promise<void> {
  const user = getCurrentUser()
  if (!user || syncing || getState().shareView) return
  syncing = true
  emit()
  const failedIds: string[] = []
  try {
    library = await listLibrary()
    const activeId = getActiveProjectId()
    for (const entry of library) {
      roles[entry.id] = entry.role
      if (entry.id === activeId) set({ role: entry.role, readOnly: entry.role === 'viewer' }, false)
      try {
        const local = entry.id === activeId ? getState().project : await loadProjectById(entry.id)
        if (local && entry.updatedAt <= local.updatedAt) {
          remoteUpdatedAts[entry.id] = entry.updatedAt
          continue
        }
        const remote = await readContent(entry.id)
        if (!remote) continue
        remoteUpdatedAts[entry.id] = entry.updatedAt
        if (entry.id === activeId) await adoptRemoteProject(remote)
        else await saveRemoteProjectToDb(remote)
      } catch {
        failedIds.push(entry.id)
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

/** Reads the small project document before writing: if it moved to something newer than what
 * this device last saw, that is a real conflict, replacing the sha check the GitHub PUT used. */
async function pushProjectDoc(project: Project): Promise<Project | null> {
  const meta = await readMeta(project.id)
  if (!meta) {
    await createProjectDoc(project)
  } else {
    if (meta.updatedAt > project.updatedAt && meta.updatedAt !== remoteUpdatedAts[project.id]) {
      const remote = await readContent(project.id)
      if (remote) return remote
    }
    await writeProjectDoc(project)
  }
  remoteUpdatedAts[project.id] = project.updatedAt
  // The share is a mirror, not a second source of truth: a failed mirror must never
  // fail the push that owns the real document.
  if (project.shareToken) {
    await mirrorShare(project.shareToken, project).catch(() => {})
    // Unawaited: footage is far slower than the document, and each finished take pushes
    // its own url through this same path anyway.
    void backUpTakes(project)
  }
  // Also unawaited, and for the same reason: somebody added to this project needs the song,
  // but nothing about this push should wait on five megabytes.
  void backUpSong(project)
  return null
}

/** True when this account may write to this project. An unknown project is one nobody has
 * shared, so it is this account's own until the first pull says otherwise. */
const mayPush = (id: string) => !(id in roles) || canEdit(roles[id])

export async function pushNow(): Promise<void> {
  const user = getCurrentUser()
  const project = getState().project
  if (!user || !project || syncing || getState().shareView || !mayPush(project.id)) return
  syncing = true
  conflict = null
  emit()
  try {
    const remoteConflict = await pushProjectDoc(project)
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
 * project is its own document, so pushing B can never touch A's remote copy. */
export async function pushAllProjects(): Promise<SyncAllResult> {
  const user = getCurrentUser()
  if (!user || syncing || getState().shareView) return { pushed: 0, failed: [] }
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
      if (!mayPush(project.id)) continue
      try {
        const remoteConflict = await pushProjectDoc(project)
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
  if (!getCurrentUser() || getState().readOnly || getState().shareView || !mayPush(project.id)) return
  const remoteUpdatedAt = remoteUpdatedAts[project.id]
  if (remoteUpdatedAt !== undefined && project.updatedAt <= remoteUpdatedAt) return
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => void pushNow(), PUSH_DEBOUNCE)
}

/** Keeps the open project level with what collaborators are writing. Last write wins, which
 * is the whole model: a remote edit newer than what is on screen replaces it. The one thing
 * it will not do is land on top of an edit that has not been saved yet - that is a genuine
 * collision, and the next push surfaces it as a conflict rather than eating it here. */
export function watchProject(id: string | null): void {
  if (watching === id) return
  unwatch?.()
  unwatch = null
  watching = id
  if (!id || !getCurrentUser() || getState().shareView) return
  unwatch = subscribeContent(id, (remote, updatedAt, writerId) => {
    if (writerId === WRITER_ID || hasPendingSave()) return
    const local = getState().project
    if (!local || local.id !== id || updatedAt <= local.updatedAt) return
    remoteUpdatedAts[id] = updatedAt
    void adoptRemoteProject(remote).then(() => flash('Updated by a collaborator'))
  })
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
    if (!mayPush(project.id)) continue
    const remoteUpdatedAt = remoteUpdatedAts[project.id]
    if (remoteUpdatedAt === undefined || project.updatedAt > remoteUpdatedAt) {
      await pushProjectDoc(project).catch(() => {})
    }
  }
}

/** Everything a fresh sign-in owes: move the pre-collaboration library across, turn any
 * invites waiting on this address into real membership, then the usual round trip. Ordered,
 * because a claimed invite has to exist before the pull that lists it. */
export async function onSignedIn(): Promise<void> {
  await migrateLegacyProjects()
  const joined = await claimInvites()
  await pullNow()
  await pushLocalOnlyOrNewer()
  if (joined.length) flash(`${joined.length} project${joined.length === 1 ? '' : 's'} shared with you`)
}

subscribeAuth(() => {
  const user = getCurrentUser()
  const justSignedIn = !wasSignedIn && !!user
  wasSignedIn = !!user
  emit()
  // Before onSignedIn, which has a migration and an invite claim to get through first: the
  // open project is editable on screen for every one of those round trips otherwise.
  void refreshRole()
  if (justSignedIn && !getState().shareView) void onSignedIn()
})
