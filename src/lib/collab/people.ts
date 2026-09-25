import { deleteDoc, getDoc, runTransaction, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { inviteRef, memberRef, metaRef, requireUser } from './refs'
import { emailKey, type GrantableRole, type Member, type ProjectMeta } from './types'

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
