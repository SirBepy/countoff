// Barrel for src/lib/collab/, split along the five concerns the old single file banner-commented
// itself into. Re-exports only what the pre-split file exported, so every import site outside
// this directory (`from './collab'` / `from '../lib/collab'`) resolves here unchanged.
export type { GrantableRole, LibraryEntry, Member, PendingInvite, ProjectMeta, Role, ShareLink } from './types'
export { WRITER_ID, canEdit, emailKey } from './types'
export { contentRef, metaRef } from './refs'
export { listLibrary, listMembers, readContent, readMeta, readMyRole, subscribeContent } from './read'
export { OwnerRowStrandedError, createProjectDoc, deleteProjectDoc, writeProjectDoc } from './write'
export { inviteByEmail, leaveProject, removeMember, revokeInvite, setMemberRole } from './people'
export { claimInvites, joinTokenFromUrl, joinUrl, joinViaLink, resolveLink, setLinkRole } from './link'
export type { ResolvedLink } from './link'
export { migrateLegacyProjects } from './migrate'
