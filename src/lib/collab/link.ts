import { deleteDoc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { getCurrentUser } from '../firebase'
import { randomWords } from '../share'
import { displayName, invitesCol, linkRef, memberRef, metaRef, requireUser } from './refs'
import { readMeta } from './read'
import { emailKey, type GrantableRole, type Member, type Role, type ShareLink } from './types'

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
