import { useCallback, useEffect, useState } from 'react'
import {
  emailKey,
  inviteByEmail,
  joinUrl,
  listMembers,
  readMeta,
  removeMember,
  revokeInvite,
  setLinkRole,
  setMemberRole,
  type GrantableRole,
  type Member,
  type ProjectMeta,
} from '../lib/collab'
import { getCurrentUser } from '../lib/firebase'
import { distinctColours, initialsFrom } from '../lib/floor'
import type { Project } from '../lib/types'

type LinkChoice = GrantableRole | 'off'

const ROLE_LABEL: Record<GrantableRole, string> = { editor: 'Can edit', viewer: 'View only' }

const nameOf = (member: Member, myUid: string) => (member.uid === myUid ? 'You' : member.name || member.email)

const Face = ({ colour, label }: { colour: string; label: string }) => (
  <span className="home-av" style={{ background: colour }}>
    {initialsFrom(label)}
  </span>
)

/** Who can get at this project, and how. Separate from the view-only link above it in the
 *  share modal: that one hands out a snapshot to anyone at all, this one hands out the
 *  live document to named accounts. */
export default function SharePeople({ project }: { project: Project }) {
  const me = getCurrentUser()
  const [meta, setMeta] = useState<ProjectMeta | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [email, setEmail] = useState('')
  const [addRole, setAddRole] = useState<GrantableRole>('editor')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const next = await readMeta(project.id).catch(() => null)
    setMeta(next)
    setMembers(next ? await listMembers(project.id).catch(() => []) : [])
  }, [project.id])

  useEffect(() => {
    void load()
  }, [load])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work')
    }
    setBusy(false)
  }

  if (!me) {
    return (
      <div className="hint">
        <i className="ph ph-user-circle i" /> Sign in from Backups to add people to this one.
      </div>
    )
  }
  if (!meta) {
    return (
      <div className="hint">
        <i className="ph ph-cloud-arrow-up i" /> This project has not synced yet. It reaches the cloud a few seconds
        after your next edit, and then you can add people.
      </div>
    )
  }

  const isOwner = meta.ownerUid === me.uid
  // An address that has already claimed its invite is a member now, not a pending one, and
  // nothing rewrites the project's copy of the list at that moment.
  const pending = meta.pending.filter((p) => !members.some((m) => emailKey(m.email) === emailKey(p.email)))
  const linkChoice: LinkChoice = meta.link?.role ?? 'off'
  const url = meta.link ? joinUrl(meta.link.token) : null
  // One palette across members and pending invites together, so the roster never draws two
  // rows the same colour just because they were coloured in separate passes.
  const colours = distinctColours([...members.map((m) => m.uid), ...pending.map((p) => p.email)])

  return (
    <>
      <div className="field">
        <label htmlFor="share-email">Add people</label>
        <div className="share-add">
          <input
            id="share-email"
            placeholder="Email address"
            value={email}
            disabled={!isOwner || busy}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !email.trim()) return
              void run(() => inviteByEmail(project.id, email, addRole)).then(() => setEmail(''))
            }}
          />
          <select id="share-add-role" value={addRole} disabled={!isOwner || busy} onChange={(e) => setAddRole(e.target.value as GrantableRole)}>
            <option value="editor">Can edit</option>
            <option value="viewer">View only</option>
          </select>
          <button
            className="primary"
            disabled={!isOwner || busy || !email.trim()}
            onClick={() => void run(() => inviteByEmail(project.id, email, addRole)).then(() => setEmail(''))}
          >
            Add
          </button>
        </div>
        <div className="faint">
          {isOwner
            ? 'They see it in their library the moment they sign in with that address.'
            : 'Only the owner can add people to this one.'}
        </div>
      </div>

      <div className="field">
        <label>People with access</label>
        {members.map((m, i) => (
          <div key={m.uid} className="share-person">
            <Face colour={colours[i]} label={m.name || m.email || '?'} />
            <div className="who">
              <div className="nm">{nameOf(m, me.uid)}</div>
              {/* An account with no Google display name falls back to its own address, and
                  printing that twice reads as a bug rather than as extra detail. */}
              {nameOf(m, me.uid) !== m.email && <div className="em">{m.email}</div>}
            </div>
            <span className="act">
              {m.role === 'owner' ? (
                <span className="faint">Owner</span>
              ) : (
                <select
                  value={m.role}
                  disabled={!isOwner || busy}
                  onChange={(e) =>
                    void run(() =>
                      e.target.value === 'remove' ? removeMember(project.id, m) : setMemberRole(project.id, m, e.target.value as GrantableRole),
                    )
                  }
                >
                  <option value="editor">Can edit</option>
                  <option value="viewer">View only</option>
                  <option value="remove">Remove</option>
                </select>
              )}
            </span>
          </div>
        ))}

        {pending.map((p, i) => (
          <div key={p.email} className="share-person">
            <Face colour={colours[members.length + i]} label={p.email} />
            <div className="who">
              <div className="nm">{p.email}</div>
              <div className="em">Invited as {ROLE_LABEL[p.role].toLowerCase()}, not signed in yet</div>
            </div>
            {isOwner && (
              <button className="ghost act" disabled={busy} onClick={() => void run(() => revokeInvite(project.id, p.email))}>
                <i className="ph ph-x i" /> Withdraw
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="field">
        <label htmlFor="share-link-role">Anyone with the link</label>
        <div className="share-add">
          <select
            id="share-link-role"
            value={linkChoice}
            disabled={!isOwner || busy}
            onChange={(e) =>
              void run(() => setLinkRole(project.id, e.target.value === 'off' ? null : (e.target.value as GrantableRole)))
            }
          >
            <option value="off">Off</option>
            <option value="editor">Can edit</option>
            <option value="viewer">View only</option>
          </select>
          {url && (
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(url)
                setCopied(true)
              }}
            >
              <i className="ph ph-copy i" /> {copied ? 'Copied' : 'Copy edit link'}
            </button>
          )}
        </div>
        {url && <input readOnly value={url} onFocus={(e) => e.target.select()} />}
        {meta.link && (
          <div className="hint">
            <i className="ph ph-warning i" /> Anyone holding this link can{' '}
            {meta.link.role === 'editor' ? 'change the choreography' : 'read the whole plan'}, and has to sign in with
            Google to open it. The view-only link on the other tab needs no account at all.
          </div>
        )}
      </div>

      {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
    </>
  )
}
