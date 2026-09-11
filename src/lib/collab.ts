import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db, getCurrentUser } from './firebase'
import { randomWords, stripUndefined } from './share'
import { deleteSong } from './songFile'
import type { Project } from './types'

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

const CONTENT_DOC = 'project'

export const metaRef = (pid: string) => doc(db, 'projects', pid)
export const contentRef = (pid: string) => doc(db, 'projects', pid, 'content', CONTENT_DOC)
const membersCol = (pid: string) => collection(db, 'projects', pid, 'members')
const memberRef = (pid: string, uid: string) => doc(db, 'projects', pid, 'members', uid)
const linkRef = (token: string) => doc(db, 'links', token)
const invitesCol = (email: string) => collection(db, 'invites', email, 'for')
const inviteRef = (email: string, pid: string) => doc(db, 'invites', email, 'for', pid)

/** Addresses are compared and keyed lowercased, because the token Google hands back is not
 *  guaranteed to carry the same case the owner typed into the share panel. */
export const emailKey = (email: string) => email.trim().toLowerCase()

/** Identifies THIS TAB, not this account. A live listener has to drop the echo of its own
 *  push while still adopting a write the same person made on their phone, and a uid cannot
 *  tell those two apart. */
export const WRITER_ID = crypto.randomUUID()

interface ContentDoc {
  data: Project
  updatedAt: number
  writerId: string
}

function requireUser() {
  const user = getCurrentUser()
  if (!user) throw new Error('Sign in first')
  return user
}

const displayName = (user: { displayName: string | null; email: string | null }) =>
  user.displayName ?? user.email ?? 'Someone'

/** The fields derived from the choreography itself, so a card can say "5 songs, 214 placed"
 *  without reading the whole document. */
const derived = (project: Project) => ({
  name: project.name,
  songs: project.segments.length,
  placed: project.blocks.length,
})

// -- reading ---------------------------------------------------------------------------

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

// -- writing ---------------------------------------------------------------------------

/** Order matters and is enforced by the rules: the project document names the owner, the
 *  owner's member document is what every later permission check reads, and only then does
 *  the choreography have somewhere it is allowed to land. */
export async function createProjectDoc(project: Project): Promise<void> {
  const user = requireUser()
  const meta: ProjectMeta = {
    ownerUid: user.uid,
    ownerName: displayName(user),
    ownerEmail: user.email ?? '',
    ...derived(project),
    updatedAt: project.updatedAt,
    updatedBy: user.uid,
    link: null,
    pending: [],
    audioUrl: null,
    audioKey: null,
    audioName: project.audioName,
  }
  await setDoc(metaRef(project.id), meta)
  await setDoc(memberRef(project.id, user.uid), {
    uid: user.uid,
    role: 'owner',
    email: user.email ?? '',
    name: displayName(user),
    at: Date.now(),
  } satisfies Member)
  await writeContent(project.id, project)
}

const writeContent = (pid: string, project: Project) =>
  setDoc(contentRef(pid), {
    data: stripUndefined(project),
    updatedAt: project.updatedAt,
    writerId: WRITER_ID,
  } satisfies ContentDoc)

/** The push path. Updates rather than replaces the project document, so an editor's write
 *  leaves `link` and `pending` byte-identical: the rules refuse the write otherwise, and
 *  that refusal is the only thing stopping an editor from granting access. */
export async function writeProjectDoc(project: Project): Promise<void> {
  const user = requireUser()
  if (!(await readMeta(project.id))) return createProjectDoc(project)
  await updateDoc(metaRef(project.id), {
    ...derived(project),
    updatedAt: project.updatedAt,
    updatedBy: user.uid,
    audioName: project.audioName,
  })
  await writeContent(project.id, project)
}

/** Thrown only by the trailing owner-row delete below: everything before it, including the
 *  project document itself, already succeeded. A caller must not tell someone the delete
 *  failed when the project is actually gone and only this last cleanup step did not land. */
export class OwnerRowStrandedError extends Error {}

/** Sweeps a project off the service: content, roster, link and invites before the project
 *  document, which is what grants the permission to delete any of them. The owner's own
 *  member row goes last of all - the delete rule only allows it once the project document
 *  is gone, so this is the one order every one of these deletes can pass under. */
export async function deleteProjectDoc(pid: string): Promise<void> {
  const meta = await readMeta(pid)
  if (!meta) {
    // The project document is already gone - either a previous run of this same function
    // finished the sweep but died before this last line, or someone else's call did. There
    // is nothing left to sweep, but the caller's own member row might be exactly that
    // survivor: firestore.rules:119-120 allows deleting a non-owner row unconditionally and
    // an owner row once the project document is gone, and this is the one branch of this
    // function that ever runs in that state, so it is the only thing that can still reach it.
    const user = getCurrentUser()
    if (user) await deleteDoc(memberRef(pid, user.uid)).catch(() => {})
    return
  }
  // The song lives in Storage, not in anything swept below, and `audioKey` is only readable
  // while `meta` is still alive - so it goes first, and its own failure (already missing,
  // denied) is swallowed here too rather than trusted to `deleteSong`'s internals, so a
  // storage hiccup can never abort the Firestore sweep that follows. A project that fails to
  // delete because its audio was already gone is worse than one leaked object, and storage
  // access is gated by uid ownership (storage.rules), never by anything this sweep deletes,
  // so a failure here can always be retried independently later.
  await deleteSong(meta.audioKey).catch(() => {})
  // NOT swallowed, unlike the rest of this sweep: the content document is gated purely on
  // isMember(pid) (firestore.rules:79-82) with no per-actor escape hatch, unlike every other
  // delete below (an invitee can always clear their own invite by address, the owner can
  // always delete their own link by uid, and a member can always delete their own row by
  // uid) - each of those stays reachable through some path independent of this sweep even if
  // skipped here. Content has no such path: once every member row is gone, which this very
  // function does, ending with the owner's own row, nobody can ever read or write it again.
  // A failure here has to abort before the project document goes, or that credential is
  // spent while a child only reachable through it is still alive.
  await deleteDoc(contentRef(pid))
  // Recoverable by the invitee themselves at any time (`hasEmail() && myEmail() == email`,
  // firestore.rules:131), independent of this sweep, so a failure here is safe to swallow.
  for (const invite of meta.pending) await deleteDoc(inviteRef(emailKey(invite.email), pid)).catch(() => {})
  // Recoverable by the owner at any time (`resource.data.ownerUid == request.auth.uid`,
  // firestore.rules:142), a field on the link document itself rather than anything this
  // sweep touches, so a failure here is safe to swallow too.
  if (meta.link) await deleteDoc(linkRef(meta.link.token)).catch(() => {})
  // Recoverable by that member themselves at any time (`request.auth.uid == memberUid`,
  // firestore.rules:120, and the role != 'owner' half of :119 is unconditional for a
  // non-owner row), so a failure here is likewise safe to swallow.
  for (const member of await listMembers(pid)) {
    if (member.role !== 'owner') await deleteDoc(memberRef(pid, member.uid)).catch(() => {})
  }
  await deleteDoc(metaRef(pid))
  // Only reachable once the line above has actually removed the project document: the
  // rules refuse this exact delete otherwise (firestore.rules:119-120). Everything the
  // caller cares about is already gone by this point, so a failure here is reported as
  // `OwnerRowStrandedError` rather than swallowed or treated the same as an earlier one -
  // the `!meta` branch above is what eventually cleans it up, given the same pid again.
  await deleteDoc(memberRef(pid, meta.ownerUid)).catch((e: unknown) => {
    throw new OwnerRowStrandedError(e instanceof Error ? e.message : String(e))
  })
}

// -- people ----------------------------------------------------------------------------

/** Names someone by address. The invite document is what lets them claim the role later,
 *  and the copy on the project is what lets the owner see they are still pending.
 *
 *  The read and the write run inside one `runTransaction`, so two invites fired without
 *  awaiting each other cannot both compute their new `pending` array from the same stale
 *  read and have the second clobber the first: Firestore re-runs a transaction whose read
 *  version was invalidated by another commit, so the second invite's `filter`-then-append
 *  sees the first invite already sitting in `pending`. `arrayUnion` was the cheaper option
 *  but cannot express this function's existing "replace this address's pending invite with
 *  a different role" behaviour (the `filter` below), so it would have had to drop that case
 *  to fix the race - a transaction fixes the race without touching that behaviour. The rules
 *  are unaffected either way: `isOwner(pid)` already exempts the owner's write from the
 *  pending-unchanged check a transaction or a plain update would both still have to satisfy. */
export async function inviteByEmail(pid: string, rawEmail: string, role: GrantableRole): Promise<void> {
  const user = requireUser()
  const email = emailKey(rawEmail)
  if (!email.includes('@')) throw new Error('That does not look like an email address')
  if (email === emailKey(user.email ?? '')) throw new Error('You already have this one')

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(metaRef(pid)).catch(() => null)
    if (!snap?.exists()) throw new Error('Share this project from a device that has synced it first')
    const meta = snap.data() as ProjectMeta
    tx.set(inviteRef(email, pid), { role, projectId: pid, projectName: meta.name, ownerName: meta.ownerName, at: Date.now() })
    const pending = [...meta.pending.filter((p) => emailKey(p.email) !== email), { email, role, at: Date.now() }]
    tx.update(metaRef(pid), { pending, updatedBy: user.uid })
  })
}

/** Same race, same fix, as `inviteByEmail` above: the read that decides what survives in
 *  `pending` has to be the one the write is checked against. */
export async function revokeInvite(pid: string, rawEmail: string): Promise<void> {
  const user = requireUser()
  const email = emailKey(rawEmail)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(metaRef(pid)).catch(() => null)
    if (!snap?.exists()) return
    const meta = snap.data() as ProjectMeta
    tx.delete(inviteRef(email, pid))
    tx.update(metaRef(pid), { pending: meta.pending.filter((p) => emailKey(p.email) !== email), updatedBy: user.uid })
  })
}

/** Changes what someone already in the project may do. An outstanding invite for the same
 *  address is re-pointed too, or a person who has not signed in yet would claim the old role. */
export async function setMemberRole(pid: string, member: Member, role: GrantableRole): Promise<void> {
  await updateDoc(memberRef(pid, member.uid), { role })
  const invite = await getDoc(inviteRef(emailKey(member.email), pid))
  if (invite.exists()) await updateDoc(inviteRef(emailKey(member.email), pid), { role })
}

export async function removeMember(pid: string, member: Member): Promise<void> {
  await deleteDoc(memberRef(pid, member.uid))
  await deleteDoc(inviteRef(emailKey(member.email), pid)).catch(() => {})
}

/** Leaving is the one thing a viewer may do to the roster, and it is their own row. */
export async function leaveProject(pid: string): Promise<void> {
  const user = requireUser()
  await deleteDoc(memberRef(pid, user.uid))
}

// -- the link --------------------------------------------------------------------------

// Six words out of 471 is ~53 bits. The view-only link settles for four because guessing it
// costs a look; guessing this one costs the choreography.
const LINK_WORDS = 6

/** Turns link access on, changes what it grants, or turns it off. The token survives a role
 *  change so a link already handed out keeps working, which is the whole reason to change a
 *  role rather than mint a new link. */
export async function setLinkRole(pid: string, role: GrantableRole | null): Promise<ShareLink | null> {
  const user = requireUser()
  const meta = await readMeta(pid)
  if (!meta) throw new Error('Share this project from a device that has synced it first')

  if (!role) {
    if (meta.link) await deleteDoc(linkRef(meta.link.token)).catch(() => {})
    await updateDoc(metaRef(pid), { link: null, updatedBy: user.uid })
    return null
  }

  const token = meta.link?.token ?? randomWords(LINK_WORDS)
  const link: ShareLink = { token, role }
  // The link document lands first: the member-create rule proves the token against the
  // project, but the joiner cannot find the project without this one resolving.
  await setDoc(linkRef(token), { projectId: pid, role, ownerUid: user.uid })
  await updateDoc(metaRef(pid), { link, updatedBy: user.uid })
  return link
}

/** A collaborator link. Prefixed, so it can never be mistaken for the view-only token that
 *  has always ridden bare in the hash. */
export const joinUrl = (token: string) => `${location.origin}${location.pathname}#join/${token}`

const JOIN_IN_HASH = /^#\/?join\/([A-Za-z0-9][A-Za-z0-9_-]*)$/

export const joinTokenFromUrl = (hash: string): string | null => hash.match(JOIN_IN_HASH)?.[1] ?? null

export interface ResolvedLink {
  projectId: string
  role: GrantableRole
}

export async function resolveLink(token: string): Promise<ResolvedLink | null> {
  const snap = await getDoc(linkRef(token))
  return snap.exists() ? (snap.data() as ResolvedLink) : null
}

/** Writes the member document that IS the access grant, proving the link by writing its
 *  token back: the rules compare it against the project's own copy, which nobody without
 *  the link can read. Already a member is a success, not an error - the usual case is
 *  someone opening the same link a second time. */
export async function joinViaLink(token: string): Promise<string> {
  const user = requireUser()
  const resolved = await resolveLink(token)
  if (!resolved) throw new Error('That link does not point at anything')
  const existing = await getDoc(memberRef(resolved.projectId, user.uid))
  if (existing.exists()) return resolved.projectId
  await setDoc(memberRef(resolved.projectId, user.uid), {
    uid: user.uid,
    role: resolved.role,
    email: user.email ?? '',
    name: displayName(user),
    at: Date.now(),
    token,
  })
  return resolved.projectId
}

/** Turns every invite waiting on this address into real membership. Run on every sign-in:
 *  an invite written while someone was signed out is the whole point of the mechanism.
 *  The member document lands before the invite is cleared, because the rules read the
 *  invite to authorise the member. */
export async function claimInvites(): Promise<string[]> {
  const user = getCurrentUser()
  if (!user?.email) return []
  const email = emailKey(user.email)
  const invites = await getDocs(invitesCol(email)).catch(() => null)
  if (!invites) return []
  const joined: string[] = []
  for (const invite of invites.docs) {
    const pid = invite.id
    const role = (invite.data() as { role: Role }).role
    try {
      const existing = await getDoc(memberRef(pid, user.uid))
      if (!existing.exists()) {
        await setDoc(memberRef(pid, user.uid), {
          uid: user.uid,
          role,
          email: user.email,
          name: displayName(user),
          at: Date.now(),
        } satisfies Member)
      }
      await deleteDoc(invite.ref).catch(() => {})
      joined.push(pid)
    } catch (e) {
      // One withdrawn invite must not stop the rest from landing.
      console.error('could not claim invite', pid, e)
    }
  }
  return joined
}

// -- the one-time move -----------------------------------------------------------------

const MIGRATED_KEY = 'countoff.collab.migrated'

/** Lifts the pre-collaboration library at users/{uid}/projects into /projects, where a
 *  document can have more than one editor. The originals are deliberately left in place:
 *  they cost nothing and they are the only copy an older build of the app can still read. */
export async function migrateLegacyProjects(): Promise<number> {
  const user = getCurrentUser()
  if (!user) return 0
  const key = `${MIGRATED_KEY}.${user.uid}`
  if (localStorage.getItem(key)) return 0
  let moved = 0
  try {
    const legacy = await getDocs(collection(db, 'users', user.uid, 'projects'))
    for (const docSnap of legacy.docs) {
      if (await readMeta(docSnap.id)) continue
      await createProjectDoc(docSnap.data() as Project)
      moved++
    }
    localStorage.setItem(key, String(Date.now()))
  } catch (e) {
    // Leaving the flag unset means the next sign-in tries again, which is the right
    // failure: the old documents are still there and nothing has been lost.
    console.error('legacy project migration failed', e)
  }
  return moved
}
