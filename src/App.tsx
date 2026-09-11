import { useEffect, useRef, useState } from 'react'
import AppBar from './components/AppBar'
import BackupModal from './components/BackupModal'
import CommentsModal from './components/CommentsModal'
import BottomBar from './components/BottomBar'
import DropAudio from './components/DropAudio'
import Floor from './components/Floor'
import Home from './components/Home'
import JoinLink from './components/JoinLink'
import LyricsModal from './components/LyricsModal'
import MarkerModal from './components/MarkerModal'
import MoveLibrary from './components/MoveLibrary'
import MoveModal from './components/MoveModal'
import ProjectMenu from './components/ProjectMenu'
import Rehearse from './components/Rehearse'
import Sheet from './components/Sheet'
import SongMap from './components/SongMap'
import SetupFlow from './components/SetupFlow'
import ShareLoading from './components/ShareLoading'
import ShareModal from './components/ShareModal'
import SongStrip from './components/SongStrip'
import VideoScreen from './components/VideoScreen'
import { WhoAreYou } from './components/ViewAs'
import { audio } from './lib/audio'
import { requestPersistence } from './lib/backup'
import { joinTokenFromUrl, readMyRole } from './lib/collab'
import { getActiveProjectId, loadProject, migrateKeySpace, migrateProject } from './lib/db'
import { attachAudio } from './lib/openProject'
import { beatToTime, rangesOverlap, segmentAt, timeToBeat } from './lib/grid'
import { splitSongAt } from './lib/markers'
import { loadShare, sharePersonFromUrl, shareTokenFromUrl } from './lib/share'
import { attachSharedTakes, attachTakes } from './lib/takes'
import { getCurrentUser } from './lib/firebase'
import { useIsDesktop } from './lib/media'
import {
  flushSave,
  getSheetScrollTop,
  getState,
  hasPendingSave,
  readHideCast,
  readViewAs,
  redo,
  replaceProject,
  removeBlocks,
  set,
  setSheetScrollTop,
  undo,
  useStore,
} from './lib/store'
import { pullNow, scheduleSync, watchProject } from './lib/syncEngine'

// Read once: a share link never changes while the tab is open, and the whole app
// boots differently when it is present.
const VIEW_TOKEN = shareTokenFromUrl(location.hash, location.pathname)
// The dancer a per-person link names, read at the same moment and for the same reason.
const VIEW_PERSON = sharePersonFromUrl(location.hash)
// A collaborator link, which grants a role rather than handing over a snapshot, so it
// boots through a sign-in rather than straight into the app.
const JOIN_TOKEN = joinTokenFromUrl(location.hash)

export default function App() {
  const project = useStore((s) => s.project)
  const view = useStore((s) => s.view)
  const status = useStore((s) => s.status)
  const libraryOpen = useStore((s) => s.libraryOpen)
  const readOnly = useStore((s) => s.readOnly)
  const askWhoAreYou = useStore((s) => s.askWhoAreYou)
  const [booted, setBooted] = useState(false)
  const [shareProgress, setShareProgress] = useState<{ done: number; total: number } | null>(null)
  const [viewToken, setViewToken] = useState(VIEW_TOKEN)
  const [segmentId, setSegmentId] = useState<string | null>(null)
  const [lyricsFor, setLyricsFor] = useState<string | null>(null)
  const [moveFor, setMoveFor] = useState<string | null>(null)
  const [markerFor, setMarkerFor] = useState<string | null>(null)
  const [showBackup, setShowBackup] = useState(false)
  const [showHome, setShowHome] = useState(false)
  const [joinToken, setJoinToken] = useState(JOIN_TOKEN)
  const [joining, setJoining] = useState(!!JOIN_TOKEN)
  const [showMenu, setShowMenu] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [creating, setCreating] = useState(false)
  const isDesktop = useIsDesktop()
  const scrollRef = useRef<HTMLDivElement>(null)

  async function adoptActiveProject(): Promise<boolean> {
    const activeId = getActiveProjectId()
    const saved = activeId ? await loadProject() : undefined
    if (!saved) return false
    // The song may only exist in the project's own upload, if this device never picked it.
    // Attached BEFORE the project reaches the store, so returning false leaves nothing
    // half-adopted: a project in the store with no audio renders the whole editor over a
    // silent transport, reachable from the home screen by starting a new one and cancelling.
    // Opening one by hand is the deliberate exception, and openProject.ts says why there.
    if (!(await attachAudio(saved))) return false
    // What this account may do with it, which for a project shared by somebody else is the
    // difference between the whole app and a read of it.
    const role = getCurrentUser() ? await readMyRole(saved.id).catch(() => null) : null
    // No blocks placed yet means he hasn't started choreographing; land on setup.
    const view = saved.blocks.length === 0 ? 'setup' : 'sheet'
    set({ project: saved, view, role, readOnly: role === 'viewer', shareView: false }, false)
    setSegmentId(saved.segments[0]?.id ?? null)
    void attachTakes(saved)
    if (getCurrentUser()) void pullNow()
    return true
  }

  /** A /v/<token> boot always reads the share doc itself, but the audio and any
   *  footage this device already cached for it are reused instead of re-downloaded
   *  when the doc says nothing changed. */
  async function adoptShare(token: string) {
    try {
      const { project: shared, audio: blob, token: resolved, previous } = await loadShare(token, (done, total) =>
        setShareProgress({ done, total }),
      )
      setViewToken(resolved)
      if (blob) audio.load(URL.createObjectURL(blob), shared.name)
      const migrated = migrateProject(shared)
      const withFootage = await attachSharedTakes(migrated, previous)
      replaceProject(withFootage, { readOnly: true, shareView: true, view: 'rehearse' }, false)
      setSegmentId(shared.segments[0]?.id ?? null)
    } catch (e) {
      console.error('share load failed', e)
      set({ status: 'The share may have been taken down, or the link is wrong.' }, false)
    }
  }

  useEffect(() => {
    void (async () => {
      if (VIEW_TOKEN) {
        await adoptShare(VIEW_TOKEN)
        setBooted(true)
        return
      }
      await migrateKeySpace()
      // A collaborator link opens its own project once the sign-in lands, so booting the
      // last one first would only put the wrong choreography on screen for a second.
      if (!JOIN_TOKEN && !(await adoptActiveProject())) setShowHome(true)
      setBooted(true)
      // Asking early means the grant is in place before there is work to lose.
      void requestPersistence()
    })()
  }, [])

  // A collaborator link opened in a tab that already has Countoff in it is a same-document
  // navigation: the hash changes, nothing reloads, and the token read at module scope stays
  // whatever it was. Without this the link silently does nothing, which is exactly what it
  // looks like when it has been revoked.
  useEffect(() => {
    const onHash = () => {
      const next = joinTokenFromUrl(location.hash)
      if (!next) return
      setJoinToken(next)
      setJoining(true)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Keeps the open project level with what collaborators are writing to it.
  useEffect(() => {
    watchProject(project?.id ?? null)
    return () => watchProject(null)
  }, [project?.id])

  // Switching or creating a project changes which document is open, so the
  // deliberate "New" screen (opened without a null project) always steps aside.
  useEffect(() => {
    setCreating(false)
    if (!project) return
    const answer = readViewAs(project.id)
    // A link naming a dancer opens straight into their view; otherwise the stored answer
    // stands, and only a shared link with a cast asks someone who has never answered.
    const named = VIEW_PERSON ? project.people.find((p) => p.id === VIEW_PERSON || p.name.toLowerCase() === VIEW_PERSON) : null
    set(
      {
        hideCast: readHideCast(project.id),
        viewAs: named?.id ?? (answer.personId && project.people.some((p) => p.id === answer.personId) ? answer.personId : null),
        askWhoAreYou: !named && !answer.answered && !!VIEW_TOKEN && project.people.length > 0,
      },
      false,
    )
  }, [project?.id])

  // Pull whenever the tab comes back into view, and push once local edits settle.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && getState().project && getCurrentUser()) void pullNow()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  useEffect(() => {
    if (project) scheduleSync(project)
  }, [project])

  // Flush the debounced save on the way out. Never preventDefault here: that
  // pops a "Leave site?" dialog on every navigation, and the flush already ran.
  useEffect(() => {
    const flush = () => {
      if (hasPendingSave()) flushSave()
    }
    const onHide = () => document.visibilityState === 'hidden' && flush()
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])

  // The click has to follow whichever song is playing, so remap on every change.
  useEffect(() => {
    if (!project) return audio.setBeatMapper(null)
    audio.setBeatMapper((time) => {
      const segment = segmentAt(project.segments, time)
      return segment ? timeToBeat(segment, time) : 0
    })
  }, [project])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      const { selection } = getState()
      const key = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if ((e.ctrlKey || e.metaKey) && key === 'y') {
        e.preventDefault()
        redo()
      } else if (e.code === 'Space') {
        e.preventDefault()
        audio.toggle()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const segment = project && segmentAt(project.segments, audio.el.currentTime)
        if (!segment) return
        // Rounded first, so a playhead sitting between counts snaps onto the grid
        // instead of carrying its offset through every press.
        const beat = Math.round(timeToBeat(segment, audio.el.currentTime))
        audio.seek(beatToTime(segment, beat + (e.key === 'ArrowRight' ? 1 : -1)))
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selection || !project) return
        const doomed = project.blocks.filter(
          (b) =>
            b.segmentId === selection.segmentId &&
            rangesOverlap(
              b.startBeat,
              b.startBeat + b.beats,
              selection.startBeat,
              selection.startBeat + selection.beats,
            ),
        )
        removeBlocks(doomed.map((b) => b.id))
      } else if (e.key === 's') {
        void splitSongAt(audio.el.currentTime).then((id) => id && setSegmentId(id))
      } else if (e.key === 'm') {
        audio.setMetronome(!audio.getMetronome())
      } else if (e.key === 'r') {
        set({ view: getState().view === 'sheet' ? 'rehearse' : 'sheet' }, false)
      } else if (e.key === 'Escape') {
        if (getState().sheetMenu) return set({ sheetMenu: null }, false)
        set({ view: 'sheet', selection: null, libraryOpen: false }, false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [project])

  // A trip into a setup step (App.tsx:260) fully unmounts the sheet's scroll
  // container, so a bare `el.scrollTop = x` on remount races the sheet's own
  // rows laying out: the browser clamps to whatever scrollHeight exists on
  // that first frame. Re-applying across a few frames lets it converge once
  // layout catches up, without touching Sheet itself.
  useEffect(() => {
    if (view !== 'sheet') return
    const el = scrollRef.current
    const target = getSheetScrollTop()
    if (!el || target <= 0) return
    let frame = 0
    let tries = 0
    const attempt = () => {
      el.scrollTop = target
      tries += 1
      if (Math.abs(el.scrollTop - target) > 1 && tries < 12) frame = requestAnimationFrame(attempt)
    }
    frame = requestAnimationFrame(attempt)
    return () => cancelAnimationFrame(frame)
  }, [view])

  if (!booted) return VIEW_TOKEN ? <ShareLoading progress={shareProgress} /> : null
  if (joinToken && joining)
    return (
      <JoinLink
        token={joinToken}
        onOpened={() => {
          // The token is spent once the membership exists; leaving it in the address bar
          // would re-run the whole join on every refresh of an already-open project.
          history.replaceState(null, '', location.pathname + location.search)
          setJoining(false)
          setShowHome(!getState().project)
        }}
      />
    )
  if (VIEW_TOKEN && !project) {
    return (
      <div className="drop">
        <div className="drop-inner">
          <div style={{ fontSize: 44, marginBottom: 10 }}>
            <i className="ph ph-link-break" />
          </div>
          <h1 style={{ margin: '0 0 6px', fontSize: 26, letterSpacing: '-0.02em' }}>That link did not open</h1>
          <p className="muted" style={{ margin: 0 }}>{status}</p>
        </div>
      </div>
    )
  }
  if (creating)
    return (
      <DropAudio
        onCancel={project ? () => setCreating(false) : undefined}
        onHome={() => {
          setCreating(false)
          setShowHome(true)
        }}
      />
    )
  if (!project || showHome)
    return (
      <Home
        onOpened={() => setShowHome(false)}
        onNewProject={() => {
          setShowHome(false)
          setCreating(true)
        }}
      />
    )
  // The viewer's token comes from the URL; the owner's comes off the project itself.
  const commentToken = readOnly ? viewToken : project.shareToken

  // Offered on whichever screen the link happened to open on, so it is never missed.
  const whoAreYou = askWhoAreYou ? <WhoAreYou project={project} /> : null
  // One definition, joined onto every view below (including the sheet's own return
  // further down), so a flash raised anywhere reaches the screen instead of only the
  // views that happened to carry their own copy of this markup.
  const toast = status ? <div className="toast">{status}</div> : null

  if (view === 'rehearse')
    return (
      <>
        <Rehearse project={project} commentToken={commentToken} onComments={() => setShowComments(true)} />
        {showComments && commentToken && <CommentsModal token={commentToken} onClose={() => setShowComments(false)} />}
        {whoAreYou}
        {toast}
      </>
    )
  if (view === 'setup')
    return (
      <>
        <SetupFlow project={project} />
        {whoAreYou}
        {toast}
      </>
    )
  if (view === 'floor')
    return (
      <>
        <Floor project={project} />
        {whoAreYou}
        {toast}
      </>
    )
  if (view === 'video')
    return (
      <>
        <VideoScreen project={project} />
        {whoAreYou}
        {toast}
      </>
    )

  const lyricSegment = project.segments.find((s) => s.id === lyricsFor)
  const marker = project.markers.find((m) => m.id === markerFor)

  return (
    <>
      <div className="app">
        <AppBar
          project={project}
          commentToken={commentToken}
          onShowMenu={() => setShowMenu(true)}
          onShowHome={() => setShowHome(true)}
          onShowBackup={() => setShowBackup(true)}
          onShowShare={() => setShowShare(true)}
          onShowComments={() => setShowComments(true)}
        />

        {!isDesktop && <SongStrip project={project} />}

        <div className="body">
          {libraryOpen && <div className="rail-scrim" onPointerDown={() => set({ libraryOpen: false }, false)} />}
          <aside className={`rail${libraryOpen ? ' open' : ''}`}>
            <MoveLibrary project={project} onEditMove={setMoveFor} />
          </aside>

          <main className="main">
            {isDesktop && (
              <SongMap
                project={project}
                selectedSegmentId={segmentId}
                onSelectSegment={setSegmentId}
                onEditMarker={setMarkerFor}
              />
            )}
            <div className="scroll" ref={scrollRef} onScroll={(e) => setSheetScrollTop(e.currentTarget.scrollTop)}>
              <Sheet
                project={project}
                selectedSegmentId={segmentId}
                onSelectSegment={setSegmentId}
                onEditLyrics={setLyricsFor}
                onEditMarker={setMarkerFor}
                onEditMove={setMoveFor}
              />
            </div>
          </main>
        </div>

        <BottomBar project={project} onNewSegment={setSegmentId} />

        {lyricSegment && <LyricsModal project={project} segment={lyricSegment} onClose={() => setLyricsFor(null)} />}
        {moveFor && <MoveModal project={project} moveId={moveFor} onClose={() => setMoveFor(null)} />}
        {marker && <MarkerModal marker={marker} onClose={() => setMarkerFor(null)} />}
        {showBackup && <BackupModal project={project} onClose={() => setShowBackup(false)} />}
        {showShare && <ShareModal project={project} onClose={() => setShowShare(false)} />}
        {showComments && commentToken && <CommentsModal token={commentToken} onClose={() => setShowComments(false)} />}
        {showMenu && (
          <ProjectMenu
            project={project}
            onClose={() => setShowMenu(false)}
            onProjects={() => setShowHome(true)}
            onBackup={() => setShowBackup(true)}
            onShare={() => setShowShare(true)}
          />
        )}
      </div>
      {whoAreYou}
      {toast}
    </>
  )
}
