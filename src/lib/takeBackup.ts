import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { loadTakeFile } from './db'
import { getCurrentUser, storage } from './firebase'
import { flash, getState, setTakeRemoteUrl, setTakeUploadProgress } from './store'
import type { Project, Take } from './types'

/** Mirrors the ceiling in storage.rules. The rule is the real guard; this is the half
 *  that can say so before spending the upload. */
export const MAX_TAKE_BYTES = 200 * 1024 * 1024

// One at a time, project-wide: a second backup would only fight the first for the same
// uplink, and the queue has nowhere to be.
let running = false
// Every sync push runs a backup pass, so an oversize take would re-warn forever.
const warned = new Set<string>()

const takePath = (uid: string, takeId: string) => `takes/${uid}/${takeId}`

/** The rule demands a video content type, and a blob round-tripped through IndexedDB
 *  can come back without one. */
const contentTypeOf = (blob: Blob) => (blob.type.startsWith('video/') ? blob.type : 'video/mp4')

function uploadTake(uid: string, take: Take, blob: Blob): Promise<string> {
  const task = uploadBytesResumable(ref(storage, takePath(uid, take.id)), blob, { contentType: contentTypeOf(blob) })
  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snap) => setTakeUploadProgress(take.id, snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0),
      reject,
      () => getDownloadURL(task.snapshot.ref).then(resolve, reject),
    )
  })
}

/** Backs a shared project's footage up, one take at a time. Footage only leaves the device
 *  once the project has a share token, which is why this is not part of importing a take. */
export async function backUpTakes(project: Project): Promise<void> {
  const user = getCurrentUser()
  if (running || !user || !project.shareToken || getState().readOnly) return
  running = true
  try {
    for (const take of project.takes) {
      // Switching projects mid-backup would write the finished url onto the wrong document.
      if (getState().project?.id !== project.id) return
      if (take.url) continue

      const blob = await loadTakeFile(take.id)
      // Picked on another device, so there is nothing here to send up.
      if (!blob) continue
      if (blob.size > MAX_TAKE_BYTES) {
        if (!warned.has(take.id)) {
          warned.add(take.id)
          flash(`"${take.name}" is too big to share: ${Math.round(blob.size / 1e6)}MB, limit 200MB`)
        }
        continue
      }

      try {
        const url = await uploadTake(user.uid, take, blob)
        if (getState().project?.id === project.id) setTakeRemoteUrl(take.id, url)
      } catch (e) {
        // Logged as well as flashed: a rules denial and a misconfigured bucket read
        // identically in the toast, and only the console tells them apart.
        console.error('take backup failed', take.id, e)
        flash(`Could not back up "${take.name}"`)
        return
      } finally {
        setTakeUploadProgress(take.id, null)
      }
    }
  } finally {
    running = false
  }
}

/** How much of a shared project's footage the viewer of its link can actually play. */
export function backupState(project: Project): { done: number; total: number } {
  return { done: project.takes.filter((t) => t.url).length, total: project.takes.length }
}
