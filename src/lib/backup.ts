import { loadProject, migrateProject, saveProject } from './db'
import { uid } from './store'
import type { Project } from './types'

const snapshotKey = (projectId: string) => `countoff.snapshots.${projectId}`
const MAX_SNAPSHOTS = 20
const FORMAT = 'countoff-backup-1'

export interface Snapshot {
  at: number
  label: string
  project: Project
}

/**
 * Asks the browser not to evict this origin under storage pressure. Without it
 * IndexedDB is "best effort" and a browser cleanup can take the whole project.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted?.()) return true
  return navigator.storage.persist()
}

export async function storageEstimate() {
  const est = await navigator.storage?.estimate?.()
  return { used: est?.usage ?? 0, quota: est?.quota ?? 0 }
}

/**
 * Rolling history in localStorage, separate from the live IndexedDB record, so
 * a bad edit or a corrupt write still leaves earlier versions recoverable.
 */
export function snapshot(project: Project, label: string) {
  try {
    const list = readSnapshots(project.id)
    const last = list[0]
    // Skip if nothing changed since the previous snapshot.
    if (last && last.project.updatedAt === project.updatedAt) return
    list.unshift({ at: Date.now(), label, project })
    localStorage.setItem(snapshotKey(project.id), JSON.stringify(list.slice(0, MAX_SNAPSHOTS)))
  } catch {
    // Quota full: history is a nicety, never let it break a save.
  }
}

/** Scoped per project so switching projects never shows another one's history. */
export function readSnapshots(projectId: string): Snapshot[] {
  try {
    const raw = localStorage.getItem(snapshotKey(projectId))
    return raw ? (JSON.parse(raw) as Snapshot[]) : []
  } catch {
    return []
  }
}

export async function restoreSnapshot(snap: Snapshot): Promise<Project> {
  const project = migrateProject({ ...snap.project, updatedAt: Date.now() })
  await saveProject(project)
  return project
}

/**
 * Choreography in one file. The audio is left out: re-picking it is cheap, and
 * embedding it would outgrow what a browser will hand over.
 */
export async function exportBackup(): Promise<Blob> {
  const project = await loadProject()
  if (!project) throw new Error('nothing to export')
  return new Blob([JSON.stringify({ format: FORMAT, exportedAt: Date.now(), project })], {
    type: 'application/json',
  })
}

/** Imports as a new library entry rather than overwriting whatever is currently open.
 * An older backup's `clips` field, if present, is simply not read. */
export async function importBackup(file: File): Promise<Project> {
  const data = JSON.parse(await file.text())
  if (data.format !== FORMAT || !data.project) throw new Error('Not a Countoff backup')
  const project = migrateProject({ ...(data.project as Project), id: uid(), updatedAt: Date.now() })
  await saveProject(project)
  return project
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
