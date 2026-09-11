import { useEffect, useRef, useState } from 'react'
import { OwnerRowStrandedError, deleteProjectDoc, leaveProject, listLibrary, type LibraryEntry, type Member, type Role } from '../lib/collab'
import { deleteProject, duplicateProject, listProjects, loadProjectById, saveProjectRecord } from '../lib/db'
import { signInWithGoogle, signOutUser } from '../lib/firebase'
import { colourFor, distinctColours, initialsFrom } from '../lib/floor'
import { openProjectById } from '../lib/openProject'
import { flash } from '../lib/store'
import { getLibrary, useSyncStatus } from '../lib/syncEngine'

/** One project as the home screen reads it, whether it is on the service or only on this
 *  device. `role` null is the local-only case: nothing has ever synced it, so there is
 *  nobody to share it with yet. */
interface Card {
  id: string
  name: string
  songs: number
  placed: number
  updatedAt: number
  role: Role | null
  ownerName: string
  members: Member[]
  shared: boolean
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function ago(at: number): string {
  const gap = Date.now() - at
  if (gap < MINUTE) return 'just now'
  if (gap < HOUR) return `${Math.round(gap / MINUTE)} min ago`
  if (gap < DAY) return `${Math.round(gap / HOUR)} hours ago`
  if (gap < 30 * DAY) return `${Math.round(gap / DAY)} days ago`
  return new Date(at).toLocaleDateString()
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Four faces then a count: past that the stack stops saying who and starts saying how many. */
function AvatarStack({ members }: { members: Member[] }) {
  if (!members.length) return null
  const shown = members.slice(0, 4)
  const colours = distinctColours(shown.map((m) => m.uid))
  const rest = members.length - shown.length
  return (
    <div className="home-stack">
      {shown.map((m, i) => (
        <span key={m.uid} className="home-av" style={{ background: colours[i] }} title={m.email || m.name}>
          {initialsFrom(m.name || m.email || '?')}
        </span>
      ))}
      {rest > 0 && <span className="home-av more">+{rest}</span>}
    </div>
  )
}

/** What the chip has to answer differs by row: on somebody else's project it is what you may
 *  do with it, and on your own it is who else can see it, which is the thing you cannot tell
 *  from the card otherwise. */
function RoleChip({ card }: { card: Card }) {
  if (card.role === 'editor') return <span className="chip home-chip edit"><i className="ph ph-pencil-simple" /> Can edit</span>
  if (card.role === 'viewer') return <span className="chip home-chip"><i className="ph ph-eye" /> View only</span>
  if (card.role === 'owner')
    return card.shared ? (
      <span className="chip home-chip mine"><i className="ph ph-users-three" /> Shared</span>
    ) : (
      <span className="chip home-chip"><i className="ph ph-lock-simple" /> Private</span>
    )
  return <span className="chip home-chip"><i className="ph ph-device-mobile" /> This device</span>
}

export default function Home({ onNewProject, onOpened }: { onNewProject: () => void; onOpened?: () => void }) {
  const sync = useSyncStatus()
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const cardsRef = useRef<HTMLDivElement>(null)

  /** The library is the union of two sources that disagree on purpose: the service knows
   *  what was shared with you, this device knows what has never been signed in for. */
  async function refresh(remote: LibraryEntry[] | null) {
    const [local, entries] = await Promise.all([listProjects(), remote ? Promise.resolve(remote) : listLibrary().catch(() => [])])
    const byId = new Map<string, Card>()
    for (const e of entries) {
      byId.set(e.id, {
        id: e.id,
        name: e.name,
        songs: e.songs,
        placed: e.placed,
        updatedAt: e.updatedAt,
        role: e.role,
        ownerName: e.ownerName,
        members: e.members,
        shared: e.members.length > 1 || !!e.link || e.pending.length > 0,
      })
    }
    for (const p of local) {
      const known = byId.get(p.id)
      // The local copy is the one being edited, so its counts are the truthful ones.
      if (known) {
        if (p.updatedAt >= known.updatedAt) Object.assign(known, { name: p.name, songs: p.segments.length, placed: p.blocks.length, updatedAt: p.updatedAt })
        continue
      }
      byId.set(p.id, {
        id: p.id,
        name: p.name,
        songs: p.segments.length,
        placed: p.blocks.length,
        updatedAt: p.updatedAt,
        role: null,
        ownerName: '',
        members: [],
        shared: false,
      })
    }
    setCards([...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt))
    setLoading(false)
  }

  useEffect(() => {
    // Paint from whatever the last pull left behind, then go and ask again: a cold home
    // screen behind a collection-group query is a second of nothing.
    void refresh(getLibrary().length ? getLibrary() : null).then(() => {
      if (getLibrary().length) void refresh(null)
    })
  }, [sync.configured, sync.lastSyncedAt])

  useEffect(() => {
    const close = () => setMenuFor(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])

  async function open(id: string) {
    if (await openProjectById(id)) onOpened?.()
    else flash('Could not open that project')
  }

  async function signIn() {
    setSigningIn(true)
    try {
      await signInWithGoogle()
    } catch {
      flash('Could not sign in')
    }
    setSigningIn(false)
  }

  async function commitRename(card: Card, raw: string) {
    setRenamingId(null)
    const name = raw.trim()
    if (!name || name === card.name) return
    const target = await loadProjectById(card.id)
    if (!target) return
    await saveProjectRecord({ ...target, name, updatedAt: Date.now() })
    void refresh(null)
  }

  async function duplicate(card: Card) {
    const copy = await duplicateProject(card.id)
    flash(`Duplicated as "${copy.name}"`)
    void refresh(null)
  }

  /** Three different endings wearing one button: the owner destroys it for everybody, a
   *  collaborator walks away from it, and a local-only project just stops existing here. */
  async function remove(card: Card) {
    const owned = card.role === 'owner' || card.role === null
    const question = owned
      ? `Delete "${card.name}"?${card.shared ? ' Everyone you shared it with loses it too.' : ''} This cannot be undone.`
      : `Leave "${card.name}"? You can get back in with a new invite.`
    if (!confirm(question)) return
    if (card.role === 'owner')
      await deleteProjectDoc(card.id).catch((e: unknown) =>
        flash(e instanceof OwnerRowStrandedError ? 'Removed, but a leftover trace of it did not clear' : 'Could not remove it from the cloud'),
      )
    else if (card.role) await leaveProject(card.id).catch(() => flash('Could not leave that project'))
    await deleteProject(card.id)
    void refresh(null)
  }

  const mine = cards.filter((c) => c.role === 'owner' || c.role === null)
  const shared = cards.filter((c) => c.role === 'editor' || c.role === 'viewer')

  const card = (c: Card) => (
    <div
      key={c.id}
      className="home-card"
      onClick={() => renamingId !== c.id && void open(c.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && void open(c.id)}
    >
      <div className="home-card-top">
        <span className={`home-cover${c.role && c.role !== 'owner' ? ' guest' : ''}`}>
          <i className="ph ph-waveform" />
        </span>
        <div className="home-card-text">
          {renamingId === c.id ? (
            <input
              autoFocus
              className="home-rename"
              defaultValue={c.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => void commitRename(c, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setRenamingId(null)
              }}
            />
          ) : (
            <div className="home-name">{c.name}</div>
          )}
          <div className="home-meta">
            {c.role && c.role !== 'owner'
              ? `${c.ownerName} · ${ago(c.updatedAt)}`
              : `${plural(c.songs, 'song')} · ${c.placed} placed · ${ago(c.updatedAt)}`}
          </div>
        </div>
      </div>
      <div className="home-card-foot">
        <AvatarStack members={c.members} />
        <RoleChip card={c} />
        <button
          className="ghost icon sm home-more"
          title="More"
          onClick={(e) => {
            e.stopPropagation()
            setMenuFor(menuFor === c.id ? null : c.id)
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <i className="ph ph-dots-three" />
        </button>
      </div>
      {menuFor === c.id && (
        <div className="home-menu" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <button className="ghost" onClick={() => void open(c.id)}>
            <i className="ph ph-folder-open i" /> Open
          </button>
          {c.role !== 'viewer' && (
            <button
              className="ghost"
              onClick={() => {
                setMenuFor(null)
                setRenamingId(c.id)
              }}
            >
              <i className="ph ph-pencil-simple i" /> Rename
            </button>
          )}
          <button
            className="ghost"
            onClick={() => {
              setMenuFor(null)
              void duplicate(c)
            }}
          >
            <i className="ph ph-copy i" /> Duplicate
          </button>
          <button
            className="ghost danger"
            onClick={() => {
              setMenuFor(null)
              void remove(c)
            }}
          >
            <i className={`ph ${c.role && c.role !== 'owner' ? 'ph-sign-out' : 'ph-trash'} i`} />{' '}
            {c.role && c.role !== 'owner' ? 'Leave' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div className="home">
      <div className="appbar home-bar">
        <div className="brand">
          <span className="dot" /> Countoff
        </div>
        <div className="spacer" />
        {sync.configured ? (
          <>
            {/* The avatar rides along on a phone too: without it the bar says somebody is
                signed in without ever saying who, and Joe has two accounts. */}
            <span className="home-account" title={sync.email ?? undefined}>
              <span className="home-av" style={{ background: colourFor(sync.email ?? '') }}>
                {initialsFrom(sync.email ?? '?')}
              </span>
              <span className="only-wide">{sync.email}</span>
            </span>
            <button className="ghost icon" title="Sign out" onClick={() => void signOutUser()}>
              <i className="ph ph-sign-out" />
            </button>
          </>
        ) : (
          <button disabled={signingIn} onClick={() => void signIn()}>
            <i className="ph ph-google-logo i" /> {signingIn ? 'Signing in...' : 'Sign in'}
          </button>
        )}
      </div>

      <div className="home-body" ref={cardsRef}>
        <h1>Your choreographies</h1>
        <p className="home-sub">
          {sync.configured
            ? 'Everything you own, plus everything someone has shared with you.'
            : 'On this device only, until you sign in.'}
        </p>

        {!sync.configured && (
          <div className="home-signin">
            <i className="ph ph-users-three" />
            <div className="home-signin-text">
              <div className="home-signin-title">Sign in to see what people shared with you</div>
              <div className="faint">
                Your own projects stay on this device either way. Signing in carries the choreography and the song.
              </div>
            </div>
            <button className="primary" disabled={signingIn} onClick={() => void signIn()}>
              <i className="ph ph-google-logo i" /> Sign in
            </button>
          </div>
        )}

        <div className="home-sec">
          <h2>{sync.configured ? 'Yours' : 'On this device'}</h2>
          {!loading && <span className="home-count">{mine.length}</span>}
        </div>
        <div className="home-grid">
          <div className="home-card new" onClick={onNewProject} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onNewProject()}>
            <div className="home-new-big">
              <i className="ph ph-music-notes-plus" />
            </div>
            <div className="home-new-title">New choreography</div>
            <div className="faint">Drop a song, or choose a file</div>
          </div>
          {mine.map(card)}
        </div>

        {shared.length > 0 && (
          <>
            <div className="home-sec">
              <h2>Shared with you</h2>
              <span className="home-count">{shared.length}</span>
            </div>
            <div className="home-grid">{shared.map(card)}</div>
          </>
        )}
      </div>
    </div>
  )
}
