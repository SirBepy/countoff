export type Role = 'owner' | 'editor' | 'viewer'
export type GrantableRole = 'editor' | 'viewer'

export const canEdit = (role: Role | null | undefined) => role === 'owner' || role === 'editor'

export interface ShareLink {
  token: string
  role: GrantableRole
}

/** Someone the owner named by address who has not signed in and claimed it yet. Kept on the
 *  project rather than only under /invites so the share panel can list them without a
 *  collection-group query the invitee alone is allowed to run. */
export interface PendingInvite {
  email: string
  role: GrantableRole
  at: number
}

/** The small half of a project: everything the library needs to draw a card, with the
 *  choreography itself in a separate subdocument so listing ten projects is ten small reads
 *  rather than ten whole medleys. */
export interface ProjectMeta {
  ownerUid: string
  ownerName: string
  ownerEmail: string
  name: string
  songs: number
  placed: number
  updatedAt: number
  /** Whose write this was, so a live listener can ignore the echo of its own push. */
  updatedBy: string
  link: ShareLink | null
  pending: PendingInvite[]
  /** The song, uploaded once so a collaborator on another machine is not stuck. */
  audioUrl: string | null
  audioKey: string | null
  audioName: string
}

export interface Member {
  uid: string
  role: Role
  email: string
  name: string
  at: number
}

/** One card on the home screen: the project's own metadata plus what this account may do
 *  with it, which lives on the member document rather than the project. */
export interface LibraryEntry extends ProjectMeta {
  id: string
  role: Role
  /** The roster, so a card can show who else is on it without a second round of queries
   *  once the home screen has already rendered. */
  members: Member[]
}

/** Addresses are compared and keyed lowercased, because the token Google hands back is not
 *  guaranteed to carry the same case the owner typed into the share panel. */
export const emailKey = (email: string) => email.trim().toLowerCase()

/** Identifies THIS TAB, not this account. A live listener has to drop the echo of its own
 *  push while still adopting a write the same person made on their phone, and a uid cannot
 *  tell those two apart. */
export const WRITER_ID = crypto.randomUUID()
