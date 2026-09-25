import { deleteDoc, setDoc, updateDoc } from 'firebase/firestore'
import { getCurrentUser } from '../firebase'
import { stripUndefined } from '../share'
import { deleteSong } from '../songFile'
import type { Project } from '../types'
import { contentRef, derived, displayName, inviteRef, linkRef, memberRef, metaRef, requireUser, type ContentDoc } from './refs'
import { listMembers, readMeta } from './read'
import { emailKey, WRITER_ID, type Member, type ProjectMeta } from './types'

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
