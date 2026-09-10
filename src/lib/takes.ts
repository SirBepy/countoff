import { deleteTakeFileIfUnused, getActiveProjectId, loadTakeFile, saveTakeFile } from './db'
import { addTake, flash, removeTake, setTakeUrl, uid } from './store'
import { backUpTakes } from './takeBackup'
import type { Project, Take } from './types'
import { orderedClips } from './video'

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
    // Attached even when the take carries an uploaded url. Sharing a project sets that
    // url, and reading past it meant the owner streamed their own footage back out of
    // Storage while the file sat on this disk; `takeSrc` prefers the local copy.
    const blob = await loadTakeFile(take.id)
    if (blob) setTakeUrl(take.id, URL.createObjectURL(blob))
  }
  // Resumes a backup the last session left half done; a no-op unless this project is shared.
  void backUpTakes(project)
}

/** The order the song will ask for the takes in, so a download lands the one needed
 *  soonest first. A take no cut uses comes last. */
function byFirstCut(project: Project, takes: Take[]): Take[] {
  const firstCut = new Map<string, number>()
  for (const clip of orderedClips(project)) if (!firstCut.has(clip.takeId)) firstCut.set(clip.takeId, clip.songStart)
  return [...takes].sort((a, b) => (firstCut.get(a.id) ?? Infinity) - (firstCut.get(b.id) ?? Infinity))
}

/** A viewer's version of attachTakes: a take whose remote url matches `previous`
 *  (this device's last cache of the same share) plays local, no Storage hit. The
 *  rest still stream remotely now, and get fetched into the background for next time. */
export async function attachSharedTakes(project: Project, previous?: Project): Promise<Project> {
  const priorUrl = new Map((previous?.takes ?? []).map((t) => [t.id, t.url]))
  const pending: Take[] = []
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
      pending.push(take)
      return take
    }),
  )
  // Live, not just next session: `takeSrc` prefers this copy the moment it lands, at
  // the cost of one reload of a local blob under the clip on screen. One take at a time,
  // in cut order, at low priority: that clip is streaming over the same link, and every
  // download racing it at once is bandwidth taken from the frame the viewer is watching.
  void (async () => {
    for (const take of byFirstCut(project, pending)) {
      try {
        const blob = await (await fetch(take.url!, { priority: 'low' })).blob()
        await saveTakeFile(take.id, blob)
        setTakeUrl(take.id, URL.createObjectURL(blob))
      } catch {
        // The bucket answering without CORS, or the link dropping: it keeps streaming.
      }
    }
  })()
  return { ...project, takes }
}

export async function dropTake(takeId: string): Promise<void> {
  setTakeUrl(takeId, null)
  removeTake(takeId)
  await deleteTakeFileIfUnused(takeId, getActiveProjectId())
}
