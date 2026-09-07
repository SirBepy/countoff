import { updateDoc } from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { metaRef, readMeta } from './collab'
import { loadAudio, saveAudio } from './db'
import { getCurrentUser, storage } from './firebase'
import type { Project } from './types'

/** Mirrors the ceiling in storage.rules. The rule is the real guard; this is the half that
 *  can say so before spending the upload. */
const MAX_SONG_BYTES = 100 * 1024 * 1024

// One at a time: a second upload would only fight the first for the same uplink.
let running = false
const warned = new Set<string>()

/** A blob round-tripped through IndexedDB can come back without a type, and the rule demands
 *  an audio one. Everything this app ingests is a file the browser could already decode. */
const contentTypeOf = (blob: Blob) => (blob.type.startsWith('audio/') ? blob.type : 'audio/mpeg')

/** Random rather than the project id, so knowing a project id reveals no storage path.
 *  Storage rules cannot read Firestore, so this and the URL's own token are the guard. */
const songPath = (uid: string) => `songs/${uid}/${crypto.randomUUID()}`

function upload(path: string, blob: Blob, onProgress?: (fraction: number) => void): Promise<string> {
  const task = uploadBytesResumable(ref(storage, path), blob, { contentType: contentTypeOf(blob) })
  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snap) => onProgress?.(snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0),
      reject,
      () => getDownloadURL(task.snapshot.ref).then(resolve, reject),
    )
  })
}

/** Sends the song up once, so somebody added to this project does not open it to silence.
 *  Skipped outright when the project document already names one: the track never changes
 *  under a project, and re-picking the file swaps the project rather than the audio. */
export async function backUpSong(project: Project, onProgress?: (fraction: number) => void): Promise<void> {
  const user = getCurrentUser()
  if (running || !user) return
  running = true
  try {
    const meta = await readMeta(project.id)
    // Not synced yet, or the song is already up there.
    if (!meta || meta.audioUrl) return
    // Only the owner may write the storage path onto the project, and only their own uid
    // is a legal upload target, so an editor's copy is nobody's to send.
    if (meta.ownerUid !== user.uid) return

    const blob = await loadAudio(project.id)
    if (!blob) return
    if (blob.size > MAX_SONG_BYTES) {
      if (!warned.has(project.id)) {
        warned.add(project.id)
        console.warn(`song too large to share: ${Math.round(blob.size / 1e6)}MB, limit 100MB`)
      }
      return
    }

    const path = songPath(user.uid)
    const url = await upload(path, blob, onProgress)
    await updateDoc(metaRef(project.id), {
      audioUrl: url,
      audioKey: path,
      audioName: project.audioName,
      updatedBy: user.uid,
    })
  } catch (e) {
    // Logged rather than surfaced: a project whose song has not made it up yet still works
    // perfectly for the person who picked the file, which is whoever is looking at this.
    console.error('song backup failed', e)
  } finally {
    running = false
  }
}

/** Pulls the song for a project this device has never had the file for. Returns null when
 *  the bytes cannot be read cross-origin, which is a bucket CORS setting rather than a
 *  missing file: `fetchSongUrl` still plays it, only the offline copy is lost. */
export async function fetchSong(projectId: string, url: string): Promise<Blob | null> {
  const local = await loadAudio(projectId)
  if (local) return local
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await response.blob()
    await saveAudio(projectId, blob)
    return blob
  } catch (e) {
    console.error('could not download the song', e)
    return null
  }
}

export async function deleteSong(key: string | null): Promise<void> {
  if (!key) return
  await deleteObject(ref(storage, key)).catch(() => {})
}
