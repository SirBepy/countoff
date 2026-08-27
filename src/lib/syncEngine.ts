import { useSyncExternalStore } from 'react'
import { loadClip, saveClip, saveProject } from './db'
import {
  clipChanged,
  getConfig,
  getLastSyncedAt,
  isConfigured,
  listRemoteClips,
  markClipPushed,
  pullClip,
  pullProject,
  pushClip,
  pushProject,
  setLastSyncedAt,
  SyncConflictError,
  type SyncConfig,
} from './sync'
import { cancelPendingSave, flash, getState, set } from './store'
import type { Project } from './types'

// A GitHub PUT is a real commit over the network, not a local write. This waits
// well past the 400ms local-save debounce (store.ts) for edits to actually settle
// before spending an API call, so a burst of drags does not fire one commit each.
const PUSH_DEBOUNCE = 8_000

interface Conflict {
  local: Project
  remote: Project
}

let syncing = false
let lastError: string | null = null
let conflict: Conflict | null = null
let remoteSha: string | null = null
let remoteUpdatedAt: number | null = null
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
async function adoptRemoteProject(project: Project, config: SyncConfig) {
  await saveProject(project)
  cancelPendingSave()
  const remoteClipIds = await listRemoteClips(config)
  for (const moveId of remoteClipIds) {
    if (await loadClip(moveId)) continue
    const blob = await pullClip(config, moveId)
    if (blob) await saveClip(moveId, blob)
  }
  set({ project, selection: null }, false)
}

export async function pullNow(): Promise<void> {
  const config = getConfig()
  if (!config || syncing) return
  syncing = true
  emit()
  try {
    const remote = await pullProject(config)
    if (!remote) {
      setLastSyncedAt(Date.now())
      return
    }
    remoteSha = remote.sha
    remoteUpdatedAt = remote.project.updatedAt
    const local = getState().project
    if (!local || remote.project.updatedAt > local.updatedAt) await adoptRemoteProject(remote.project, config)
    setLastSyncedAt(Date.now())
    lastError = null
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
    const blob = await loadClip(move.id)
    if (!blob || !(await clipChanged(move.id, blob))) continue
    await pushClip(config, move.id, blob)
    await markClipPushed(move.id, blob)
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
    remoteSha = await pushProject(config, project, remoteSha)
    remoteUpdatedAt = project.updatedAt
    await pushChangedClips(config, project)
    setLastSyncedAt(Date.now())
    lastError = null
  } catch (e) {
    if (e instanceof SyncConflictError) {
      const remote = await pullProject(config).catch(() => null)
      if (remote) {
        remoteSha = remote.sha
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

/** Called whenever the in-memory project changes; debounces the next push. */
export function scheduleSync(project: Project) {
  if (!isConfigured()) return
  if (remoteUpdatedAt !== null && project.updatedAt <= remoteUpdatedAt) return
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
  remoteUpdatedAt = remote.updatedAt
  setLastSyncedAt(Date.now())
  emit()
}
