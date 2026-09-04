import { deleteTakeFile, loadTakeFile, saveTakeFile } from './db'
import { addTake, flash, removeTake, setTakeUrl, uid } from './store'
import type { Project, Take } from './types'

/** Reads a picked file's length off a throwaway element; the file itself carries no length. */
function durationOf(url: string): Promise<number> {
  return new Promise((resolve) => {
    const probe = document.createElement('video')
    probe.preload = 'metadata'
    probe.onloadedmetadata = () => resolve(isFinite(probe.duration) ? probe.duration : 0)
    probe.onerror = () => resolve(0)
    probe.src = url
  })
}

/** Takes a picked file into the project: on disk here, registered as a take, playable now. */
export async function importTake(file: File): Promise<Take | null> {
  const id = uid()
  const url = URL.createObjectURL(file)
  const duration = await durationOf(url)
  if (!duration) {
    URL.revokeObjectURL(url)
    flash('That file did not open as video')
    return null
  }
  await saveTakeFile(id, file)
  setTakeUrl(id, url)
  const take: Take = { id, name: file.name, duration, bytes: file.size }
  addTake(take)
  return take
}

/**
 * Re-attaches this device's footage after a reload. A take whose file was picked on
 * another device simply has none here until it has been uploaded.
 */
export async function attachTakes(project: Project): Promise<void> {
  for (const take of project.takes) {
    if (take.url) continue
    const blob = await loadTakeFile(take.id)
    if (blob) setTakeUrl(take.id, URL.createObjectURL(blob))
  }
}

export async function dropTake(takeId: string): Promise<void> {
  setTakeUrl(takeId, null)
  removeTake(takeId)
  await deleteTakeFile(takeId)
}
