import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, setDoc, updateDoc } from 'firebase/firestore'
import { db, getCurrentUser } from './firebase'
import type { Project } from './types'

export interface ShareComment {
  id: string
  name: string
  text: string
  /** Wall-clock time the comment was written, taken on the writer's device. */
  at: number
}

interface ShareDoc {
  ownerUid: string
  project: Project
  audioName: string
  chunks: number
  updatedAt: number
}

// Firestore caps a document at 1 MiB including field names and overhead, and base64
// inflates bytes by 4/3. 600k chars per chunk leaves room for both.
const CHUNK_CHARS = 600_000

export const NAME_MAX = 40
export const TEXT_MAX = 800

const shareRef = (token: string) => doc(db, 'shares', token)
const chunksCol = (token: string) => collection(db, 'shares', token, 'audio')
const commentsCol = (token: string) => collection(db, 'shares', token, 'comments')

/** 128 bits of randomness in the URL, which is the only thing guarding a share. */
export const newShareToken = () => crypto.randomUUID().replace(/-/g, '')

// The token rides in the hash: GitHub Pages serves the app from a repo subpath and
// rewrites nothing, so a /v/<token> path 404s before the app can ever boot.
export const shareUrl = (token: string) => `${location.origin}${location.pathname}#/v/${token}`

const TOKEN_IN_URL = /(?:^|\/)v\/([A-Za-z0-9_-]{8,})\/?$/

// The path form still resolves, for a host that does rewrite (firebase.json does).
export const shareTokenFromUrl = (hash: string, pathname: string): string | null =>
  hash.match(TOKEN_IN_URL)?.[1] ?? pathname.match(TOKEN_IN_URL)?.[1] ?? null

// Firestore rejects undefined field values (Move.note, Block.note, Segment.lrcSource);
// round-tripping through JSON drops them the way JSON.stringify already does.
export const stripUndefined = <T,>(value: T): T => JSON.parse(JSON.stringify(value))

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the audio'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(blob)
  })
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

/** Writes the project copy. The audio is a separate, much more expensive write, so it
 *  only happens when the share has none yet: a track never changes under a project. */
export async function publishShare(
  token: string,
  project: Project,
  audioBlob: Blob | null,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const user = getCurrentUser()
  if (!user) throw new Error('Sign in before sharing')
  const existing = await getDoc(shareRef(token))
  const hadAudio = existing.exists() && (existing.data() as ShareDoc).chunks > 0

  const chunks = hadAudio ? (existing.data() as ShareDoc).chunks : 0

  // The parent lands first, always. The audio rule resolves ownerUid by get()ing this
  // document, so a chunk written before it exists is denied outright.
  const shareDoc: ShareDoc = {
    ownerUid: user.uid,
    project: stripUndefined(project),
    audioName: project.audioName,
    chunks,
    updatedAt: Date.now(),
  }
  await setDoc(shareRef(token), shareDoc)
  if (hadAudio || !audioBlob) return

  const base64 = await blobToBase64(audioBlob)
  const parts: string[] = []
  for (let i = 0; i < base64.length; i += CHUNK_CHARS) parts.push(base64.slice(i, i + CHUNK_CHARS))
  onProgress?.(0, parts.length)
  for (const [i, data] of parts.entries()) {
    await setDoc(doc(chunksCol(token), String(i).padStart(4, '0')), { data, type: audioBlob.type })
    onProgress?.(i + 1, parts.length)
  }
  await updateDoc(shareRef(token), { chunks: parts.length, updatedAt: Date.now() })
}

/** Re-writes only the project copy, for the live mirror on every sync push. */
export async function mirrorShare(token: string, project: Project): Promise<void> {
  const snap = await getDoc(shareRef(token))
  if (!snap.exists()) return
  const existing = snap.data() as ShareDoc
  await setDoc(shareRef(token), { ...existing, project: stripUndefined(project), updatedAt: Date.now() })
}

export async function unpublishShare(token: string): Promise<void> {
  const chunks = await getDocs(chunksCol(token))
  for (const chunk of chunks.docs) await deleteDoc(chunk.ref)
  await deleteDoc(shareRef(token))
}

export interface LoadedShare {
  project: Project
  audio: Blob | null
}

export async function loadShare(token: string): Promise<LoadedShare> {
  const snap = await getDoc(shareRef(token))
  if (!snap.exists()) throw new Error('That link does not point at anything')
  const data = snap.data() as ShareDoc
  if (!data.chunks) return { project: data.project, audio: null }
  // Ordered by document id, which is the zero-padded chunk index.
  const chunks = await getDocs(query(chunksCol(token)))
  const sorted = chunks.docs.sort((a, b) => a.id.localeCompare(b.id))
  const type = (sorted[0]?.data().type as string) || 'audio/mpeg'
  return { project: data.project, audio: base64ToBlob(sorted.map((d) => d.data().data as string).join(''), type) }
}

export function subscribeComments(token: string, cb: (comments: ShareComment[]) => void): () => void {
  return onSnapshot(query(commentsCol(token), orderBy('at')), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ShareComment, 'id'>) }))),
  )
}

export async function addShareComment(token: string, name: string, text: string): Promise<void> {
  const id = crypto.randomUUID()
  await setDoc(doc(commentsCol(token), id), {
    name: name.slice(0, NAME_MAX),
    text: text.slice(0, TEXT_MAX),
    at: Date.now(),
  })
}
