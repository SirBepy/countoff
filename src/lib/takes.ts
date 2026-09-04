import { deleteTakeFileIfUnused, getActiveProjectId, loadTakeFile, saveTakeFile } from './db'
import { addTake, flash, removeTake, setTakeUrl, uid } from './store'
import { backUpTakes } from './takeBackup'
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
  // Resumes a backup the last session left half done; a no-op unless this project is shared.
  void backUpTakes(project)
}

/** A viewer's version of attachTakes: a take whose remote url matches `previous`
 *  (this device's last cache of the same share) plays local, no Storage hit. The
 *  rest still stream remotely now, and get fetched into the background for next time. */
export async function attachSharedTakes(project: Project, previous?: Project): Promise<Project> {
  const priorUrl = new Map((previous?.takes ?? []).map((t) => [t.id, t.url]))
  const takes = await Promise.all(
    project.takes.map(async (take): Promise<Take> => {
      if (!take.url) return take
      if (priorUrl.get(take.id) === take.url) {
        const blob = await loadTakeFile(take.id)
        if (blob) {
          setTakeUrl(take.id, URL.createObjectURL(blob))
          return { ...take, url: undefined }
        }
      }
      void fetch(take.url)
        .then((r) => r.blob())
        .then((blob) => saveTakeFile(take.id, blob))
        .catch(() => {})
      return take
    }),
  )
  return { ...project, takes }
}

export async function dropTake(takeId: string): Promise<void> {
  setTakeUrl(takeId, null)
  removeTake(takeId)
  await deleteTakeFileIfUnused(takeId, getActiveProjectId())
}
