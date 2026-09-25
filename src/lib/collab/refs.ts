import { collection, doc } from 'firebase/firestore'
import { db, getCurrentUser } from '../firebase'
import type { Project } from '../types'

const CONTENT_DOC = 'project'

export const metaRef = (pid: string) => doc(db, 'projects', pid)
export const contentRef = (pid: string) => doc(db, 'projects', pid, 'content', CONTENT_DOC)
export const membersCol = (pid: string) => collection(db, 'projects', pid, 'members')
export const memberRef = (pid: string, uid: string) => doc(db, 'projects', pid, 'members', uid)
export const linkRef = (token: string) => doc(db, 'links', token)
export const invitesCol = (email: string) => collection(db, 'invites', email, 'for')
export const inviteRef = (email: string, pid: string) => doc(db, 'invites', email, 'for', pid)

export interface ContentDoc {
  data: Project
  updatedAt: number
  writerId: string
}

export function requireUser() {
  const user = getCurrentUser()
  if (!user) throw new Error('Sign in first')
  return user
}

export const displayName = (user: { displayName: string | null; email: string | null }) =>
  user.displayName ?? user.email ?? 'Someone'

/** The fields derived from the choreography itself, so a card can say "5 songs, 214 placed"
 *  without reading the whole document. */
export const derived = (project: Project) => ({
  name: project.name,
  songs: project.segments.length,
  placed: project.blocks.length,
})
