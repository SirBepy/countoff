import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, setDoc, updateDoc } from 'firebase/firestore'
import { loadShareCache, saveShareCache } from './db'
import { db, getCurrentUser } from './firebase'
import { SHARE_WORDS } from './shareWords'
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

/** What a renamed share leaves behind, so a link already handed out still resolves.
 *  `ownerUid` stays: without it the rules deny every later write to this document. */
interface PointerDoc {
  ownerUid: string
  movedTo: string
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

// Rejection sampling, because a plain modulo would quietly favour the first
// 0x100000000 % length words.
function pickWord(): string {
  const limit = Math.floor(0x1_0000_0000 / SHARE_WORDS.length) * SHARE_WORDS.length
  const buf = new Uint32Array(1)
  do crypto.getRandomValues(buf)
  while (buf[0] >= limit)
  return SHARE_WORDS[buf[0] % SHARE_WORDS.length]
}

/** Four words out of 471 is ~35 bits, not the 128 the old hex token carried, so the
 *  clash that used to be unthinkable gets checked for instead of overwriting a share. */
export async function newShareToken(): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const token = Array.from({ length: 4 }, pickWord).join('-')
    if (!(await getDoc(shareRef(token))).exists()) return token
  }
  throw new Error('Could not find a free link name, try again')
}

// The token rides in the hash: GitHub Pages serves the app from a repo subpath and
// rewrites nothing, so a /v/<token> path 404s before the app can ever boot.
export const shareUrl = (token: string) => `${location.origin}${location.pathname}#${token}`

const LEGACY_IN_URL = /(?:^|\/)v\/([A-Za-z0-9_-]{8,})\/?$/
const TOKEN_IN_HASH = /^#\/?([A-Za-z0-9][A-Za-z0-9_-]{6,}[A-Za-z0-9])$/

// Links minted before the words carried a /v/ prefix, and firebase.json rewrites the
// path form, so both still resolve.
export const shareTokenFromUrl = (hash: string, pathname: string): string | null =>
  hash.match(LEGACY_IN_URL)?.[1] ?? pathname.match(LEGACY_IN_URL)?.[1] ?? hash.match(TOKEN_IN_HASH)?.[1] ?? null

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
  /** Where the share actually lives, which is not the token in the URL once the link
   *  has been renamed. Comments belong on this one. */
  token: string
  /** What this device had cached from the last time this share was viewed, if any:
   *  lets the caller tell which takes still point at footage already downloaded. */
  previous?: Project
}

// Small enough that a slow phone still shows the counter moving, large enough that
// 22 chunks are not 22 sequential round trips.
const FETCH_BATCH = 4
const MAX_HOPS = 4

export async function loadShare(
  token: string,
  onProgress?: (done: number, total: number) => void,
): Promise<LoadedShare> {
  let snap = await getDoc(shareRef(token))
  for (let hop = 0; snap.exists() && (snap.data() as ShareDoc & PointerDoc).movedTo; hop++) {
    if (hop >= MAX_HOPS) throw new Error('That link forwards in a circle')
    token = (snap.data() as PointerDoc).movedTo
    snap = await getDoc(shareRef(token))
  }
  if (!snap.exists()) throw new Error('That link does not point at anything')
  const data = snap.data() as ShareDoc
  const cached = await loadShareCache(token)

  if (!data.chunks) {
    void saveShareCache(token, { project: data.project, chunks: 0, audio: null })
    return { project: data.project, audio: null, token, previous: cached?.project }
  }

  // Audio is only ever uploaded once per token (publishShare skips re-upload whenever
  // chunks is already set), so an unchanged chunk count means unchanged audio bytes.
  if (cached && cached.chunks === data.chunks && cached.audio) {
    void saveShareCache(token, { project: data.project, chunks: data.chunks, audio: cached.audio })
    return { project: data.project, audio: cached.audio, token, previous: cached.project }
  }

  // Ids are the zero-padded chunk index, so the order is known without a query and
  // each batch can be counted off as it lands.
  const ids = Array.from({ length: data.chunks }, (_, i) => String(i).padStart(4, '0'))
  const parts: string[] = []
  let type = 'audio/mpeg'
  onProgress?.(0, ids.length)
  for (let i = 0; i < ids.length; i += FETCH_BATCH) {
    const batch = await Promise.all(ids.slice(i, i + FETCH_BATCH).map((id) => getDoc(doc(chunksCol(token), id))))
    for (const chunk of batch) {
      const value = chunk.data() as { data: string; type?: string } | undefined
      if (!value) continue
      type = value.type || type
      parts.push(value.data)
    }
    onProgress?.(Math.min(i + FETCH_BATCH, ids.length), ids.length)
  }
  const audio = base64ToBlob(parts.join(''), type)
  void saveShareCache(token, { project: data.project, chunks: data.chunks, audio })
  return { project: data.project, audio, token, previous: cached?.project }
}

/** Moves a share onto a fresh token, then strips the old document down to a pointer
 *  at the new one: the audio is re-uploaded from disk, so the old chunks go. */
export async function renameShare(
  oldToken: string,
  project: Project,
  audioBlob: Blob | null,
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  const user = getCurrentUser()
  if (!user) throw new Error('Sign in before sharing')
  const next = await newShareToken()
  await publishShare(next, { ...project, shareToken: next }, audioBlob, onProgress)

  // The dancers' notes are the point of the thread, so they follow the choreography.
  // The originals stay put: the rules forbid deleting a comment, even the owner's.
  const comments = await getDocs(commentsCol(oldToken))
  for (const comment of comments.docs) await setDoc(doc(commentsCol(next), comment.id), comment.data())

  // The pointer lands before the old audio goes: once it is in place nothing reads
  // those chunks, so a failure here costs storage rather than a silent, songless share.
  const pointer: PointerDoc = { ownerUid: user.uid, movedTo: next, updatedAt: Date.now() }
  await setDoc(shareRef(oldToken), pointer)
  const chunks = await getDocs(chunksCol(oldToken))
  for (const chunk of chunks.docs) await deleteDoc(chunk.ref)
  return next
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
