import { collectionGroup, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { db, getCurrentUser } from '../firebase'
import type { Project } from '../types'
import { contentRef, membersCol, memberRef, metaRef, type ContentDoc } from './refs'
import type { LibraryEntry, Member, ProjectMeta, Role } from './types'

/** Null covers both "no such project" and "not yours to see", because the rules cannot tell
 *  a caller those apart without leaking which project ids exist: reading a document you are
 *  not a member of is a denial, not an empty result. Every caller wants the same answer to
 *  both - there is nothing here for you - and the writes that follow are denied on their
 *  own merits rather than on this read. */
export async function readMeta(pid: string): Promise<ProjectMeta | null> {
  const snap = await getDoc(metaRef(pid)).catch(() => null)
  return snap?.exists() ? (snap.data() as ProjectMeta) : null
}

export async function readContent(pid: string): Promise<Project | null> {
  const snap = await getDoc(contentRef(pid))
  return snap.exists() ? (snap.data() as ContentDoc).data : null
}

export async function readMyRole(pid: string): Promise<Role | null> {
  const user = getCurrentUser()
  if (!user) return null
  const snap = await getDoc(memberRef(pid, user.uid))
  return snap.exists() ? (snap.data() as Member).role : null
}

export const listMembers = async (pid: string): Promise<Member[]> =>
  (await getDocs(membersCol(pid))).docs.map((d) => d.data() as Member)

/** Every project this account is in, owned or shared. One collection-group query answers it;
 *  scanning /projects is denied outright, which is why the member document carries `uid` as
 *  a field as well as being named by it. */
export async function listLibrary(): Promise<LibraryEntry[]> {
  const user = getCurrentUser()
  if (!user) return []
  const memberships = await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', user.uid)))
  const entries = await Promise.all(
    memberships.docs.map(async (m): Promise<LibraryEntry | null> => {
      const pid = m.ref.parent.parent?.id
      if (!pid) return null
      // A project the owner deleted leaves the member document behind for a moment; a card
      // pointing at nothing is worse than one fewer card.
      const meta = await readMeta(pid).catch(() => null)
      if (!meta) return null
      const members = await listMembers(pid).catch(() => [])
      return { ...meta, id: pid, role: (m.data() as Member).role, members }
    }),
  )
  return entries.filter((e): e is LibraryEntry => e !== null).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Fires on every write to the choreography, this tab's own included. The caller is given
 *  `writerId` so it can drop its own echo rather than adopt what it just sent. */
export function subscribeContent(
  pid: string,
  cb: (project: Project, updatedAt: number, writerId: string) => void,
): () => void {
  return onSnapshot(contentRef(pid), (snap) => {
    if (!snap.exists()) return
    const content = snap.data() as ContentDoc
    cb(content.data, content.updatedAt, content.writerId)
  })
}
