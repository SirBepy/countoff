import { useSyncExternalStore } from 'react'
import { getActiveProjectId, listProjects, loadClipFor, loadProjectById, migrateProject, saveClipFor, saveProject, saveProjectRecord } from './db'
import {
  clipChanged,
  deleteLegacyProject,
  getConfig,
  getLastSyncedAt,
  isConfigured,
  listRemoteClips,
  listRemoteProjects,
  markClipPushed,
  pullClip,
  pullLegacyProject,
  pullProjectById,
  pushClip,
  pushProjectById,
  setLastSyncedAt,
  SyncConflictError,
  type SyncConfig,
} from './sync'
import { cancelPendingSave, flash, getState, replaceProject, set } from './store'
import type { Project } from './types'

// A GitHub PUT is a real commit over the network, not a local write. This waits
// well past the 400ms local-save debounce (store.ts) for edits to actually settle
// before spending an API call, so a burst of drags does not fire one commit each.
const PUSH_DEBOUNCE = 8_000

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
// Per project id: the remote layout is one file per project, so each tracks its own sha.
const remoteShas: Record<string, string> = {}
const remoteUpdatedAts: Record<string, number> = {}
let pushTimer: ReturnType<typeof setTimeout> | undefined

const listeners = new Set<() => void>()

export interface SyncStatus {
  configured: boolean
  syncing: boolean
  lastError: string | null
  lastSyncedAt: number | null
  conflict: Conflict | null
}

const buildStatus = (): SyncStatus => ({
  configured: isConfigured(),
  syncing,
  lastError,
  lastSyncedAt: getLastSyncedAt(),
  conflict,
})

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

/** Forces subscribers to re-read config state after setConfig/clearConfig, which don't emit themselves. */
export const refreshStatus = () => emit()

/** Writes to IndexedDB, cancels the debounced local save, then adopts in memory.
 * Cancels before the clip fetch: a network call can easily outlast the 400ms window ad4299b guards. */
async function adoptRemoteProject(remoteProject: Project, config: SyncConfig) {
  const project = migrateProject(remoteProject)
  await saveProject(project)
  cancelPendingSave()
  const remoteClipIds = await listRemoteClips(config, project.id)
  for (const moveId of remoteClipIds) {
    if (await loadClipFor(project.id, moveId)) continue
    const blob = await pullClip(config, project.id, moveId)
    if (blob) await saveClipFor(project.id, moveId, blob)
  }
  // Undoing past a document that arrived from the other device is incoherent.
  replaceProject(project, { selection: null }, false)
}

/** Same shape as adoptRemoteProject but for a project that isn't the open one:
 * write straight to IndexedDB, never touch which project is active or in memory. */
async function saveRemoteProjectToDb(remoteProject: Project, config: SyncConfig) {
  const project = migrateProject(remoteProject)
  await saveProjectRecord(project)
  const remoteClipIds = await listRemoteClips(config, project.id)
  for (const moveId of remoteClipIds) {
    if (await loadClipFor(project.id, moveId)) continue
    const blob = await pullClip(config, project.id, moveId)
    if (blob) await saveClipFor(project.id, moveId, blob)
  }
}

/** No-op once migrated: pulls the pre-library root project.json, if any, re-saves it
 * under its own projects/<id>.json, then deletes the root file. */
async function migrateLegacyProject(config: SyncConfig): Promise<void> {
  const legacy = await pullLegacyProject(config)
  if (!legacy) return
  await pushProjectById(config, legacy.project, null)
  await deleteLegacyProject(config, legacy.sha)
}

export async function pullNow(): Promise<void> {
  const config = getConfig()
  if (!config || syncing) return
  syncing = true
  emit()
  const failedIds: string[] = []
  try {
    try {
      await migrateLegacyProject(config)
    } catch {
      failedIds.push('legacy')
    }
    const remoteIds = await listRemoteProjects(config)
    const activeId = getActiveProjectId()
    for (const id of remoteIds) {
      try {
        const remote = await pullProjectById(config, id)
        if (!remote) continue
        remoteShas[id] = remote.sha
        remoteUpdatedAts[id] = remote.project.updatedAt
        const local = id === activeId ? getState().project : await loadProjectById(id)
        if (!local || remote.project.updatedAt > local.updatedAt) {
          if (id === activeId) await adoptRemoteProject(remote.project, config)
          else await saveRemoteProjectToDb(remote.project, config)
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

async function pushChangedClips(config: SyncConfig, project: Project) {
  for (const move of project.moves) {
    if (!move.hasClip) continue
    const blob = await loadClipFor(project.id, move.id)
    if (!blob || !(await clipChanged(project.id, move.id, blob))) continue
    await pushClip(config, project.id, move.id, blob)
    await markClipPushed(project.id, move.id, blob)
  }
}

export async function pushNow(): Promise<void> {
  const config = getConfig()
  const project = getState().project
  if (!config || !project || syncing) return
  syncing = true
  conflict = null
  emit()
  try {
    remoteShas[project.id] = await pushProjectById(config, project, remoteShas[project.id] ?? null)
    remoteUpdatedAts[project.id] = project.updatedAt
    await pushChangedClips(config, project)
    setLastSyncedAt(Date.now())
    lastError = null
  } catch (e) {
    if (e instanceof SyncConflictError) {
      const remote = await pullProjectById(config, project.id).catch(() => null)
      if (remote) {
        remoteShas[project.id] = remote.sha
        conflict = { local: project, remote: remote.project }
      }
      flash('Sync conflict: the remote copy changed since your last sync')
    } else {
      lastError = e instanceof Error ? e.message : 'Push failed'
      flash('Sync push failed')
    }
  } finally {
    syncing = false
    emit()
  }
}

/** Pushes every project in the local library, not just the open one. A conflict on one
 * project is collected, not fatal: the loop keeps going so the rest still sync. */
export async function pushAllProjects(): Promise<SyncAllResult> {
  const config = getConfig()
  if (!config || syncing) return { pushed: 0, failed: [] }
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
        remoteShas[project.id] = await pushProjectById(config, project, remoteShas[project.id] ?? null)
        remoteUpdatedAts[project.id] = project.updatedAt
        await pushChangedClips(config, project)
        pushed++
      } catch (e) {
        if (e instanceof SyncConflictError) {
          const remote = await pullProjectById(config, project.id).catch(() => null)
          if (remote) {
            remoteShas[project.id] = remote.sha
            if (project.id === activeId) conflict = { local: project, remote: remote.project }
          }
        }
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
  if (!isConfigured()) return
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
  const config = getConfig()
  if (!conflict || !config) return
  const remote = conflict.remote
  conflict = null
  await adoptRemoteProject(remote, config)
  remoteUpdatedAts[remote.id] = remote.updatedAt
  setLastSyncedAt(Date.now())
  emit()
}
