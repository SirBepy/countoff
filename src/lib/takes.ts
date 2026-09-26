import { audio } from './audio'
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

/** Resolves at the next moment playback is not advancing: immediately if the audio
 *  element is already paused, otherwise at the next 'pause' event - which also fires
 *  when a song simply reaches its end. */
function waitForPause(): Promise<void> {
  if (audio.el.paused) return Promise.resolve()
  return new Promise((resolve) => audio.el.addEventListener('pause', () => resolve(), { once: true }))
}

/**
 * Downloads one take without competing with the video element streaming that same
 * object: reads the response body in chunks and stops - cancelling the fetch, so the
 * browser actually releases the link rather than merely deprioritising it - the instant
 * playback starts, resuming with a Range request from the last byte read once playback
 * stops again (paused, between songs, or the song ending). Falls back to a plain
 * whole-file read if the response carries no readable stream.
 */
async function downloadWhilePaused(url: string): Promise<Blob> {
  let parts: BlobPart[] = []
  let received = 0
  for (;;) {
    await waitForPause()
    const res = await fetch(url, { priority: 'low', headers: received ? { Range: `bytes=${received}-` } : {} })
    // `fetch` rejects on a dropped link but not on an HTTP error status, so without this
    // the error page's body reads as footage and the caller saves it as this take's cached
    // file - corruption that outlives the session, since a local copy wins over Storage on
    // every later visit. Throwing reaches the caller's catch, which leaves the take
    // streaming; the next visit retries, so a transient 5xx needs no retry loop here.
    if (!res.ok) throw new Error(`take download answered ${res.status}`)
    // The server ignoring Range and answering with the whole object again (200
    // instead of 206) would otherwise duplicate the bytes already collected.
    if (received > 0 && res.status !== 206) {
      parts = []
      received = 0
    }
    // The reset above has to come first: on a 200-for-a-Range this response IS the whole
    // object, and `parts` is empty by then. On a 206 it is only the tail, so the bytes
    // already collected go in front of it.
    if (!res.body) return new Blob([...parts, await res.blob()])
    const reader = res.body.getReader()
    try {
      for (;;) {
        if (!audio.el.paused) break
        const { done, value } = await reader.read()
        if (done) return new Blob(parts)
        parts.push(value)
        received += value.byteLength
      }
    } finally {
      void reader.cancel().catch(() => {})
    }
  }
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
  // the cost of one reload of a local blob under the clip on screen. One take at a
  // time, in cut order: that clip is streaming over the same link, and `priority: 'low'`
  // alone does not stop a `fetch(...).blob()` from pulling the whole file regardless of
  // the hint, which is bandwidth taken straight from the frame the viewer is watching.
  // `downloadWhilePaused` is the actual mitigation: it only pulls bytes while the song
  // is not advancing, in project-open idle time, between songs, or after a song ends.
  void (async () => {
    for (const take of byFirstCut(project, pending)) {
      try {
        const blob = await downloadWhilePaused(take.url!)
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
