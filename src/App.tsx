import { useEffect, useState } from 'react'
import BackupModal from './components/BackupModal'
import BottomBar from './components/BottomBar'
import DropAudio from './components/DropAudio'
import Floor from './components/Floor'
import LyricsModal from './components/LyricsModal'
import MarkerModal from './components/MarkerModal'
import MoveLibrary from './components/MoveLibrary'
import MoveModal from './components/MoveModal'
import ProjectMenu from './components/ProjectMenu'
import ProjectsModal from './components/ProjectsModal'
import Rehearse from './components/Rehearse'
import Sheet from './components/Sheet'
import SongMap from './components/SongMap'
import SongSetup from './components/SongSetup'
import SongStrip from './components/SongStrip'
import { audio } from './lib/audio'
import { requestPersistence } from './lib/backup'
import { getActiveProjectId, loadAudio, loadProject, migrateKeySpace } from './lib/db'
import { beatToTime, segmentAt, timeToBeat } from './lib/grid'
import { splitSongAt } from './lib/markers'
import { getCurrentUser } from './lib/firebase'
import { useIsDesktop } from './lib/media'
import { flushSave, getState, hasPendingSave, redo, removeBlocks, set, undo, updateProject, useStore } from './lib/store'
import { pullNow, scheduleSync } from './lib/syncEngine'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export default function App() {
  const project = useStore((s) => s.project)
  const view = useStore((s) => s.view)
  const status = useStore((s) => s.status)
  const libraryOpen = useStore((s) => s.libraryOpen)
  const canUndo = useStore((s) => s.canUndo)
  const canRedo = useStore((s) => s.canRedo)
  const [booted, setBooted] = useState(false)
  const [segmentId, setSegmentId] = useState<string | null>(null)
  const [lyricsFor, setLyricsFor] = useState<string | null>(null)
  const [moveFor, setMoveFor] = useState<string | null>(null)
  const [markerFor, setMarkerFor] = useState<string | null>(null)
  const [showBackup, setShowBackup] = useState(false)
  const [showProjects, setShowProjects] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [creating, setCreating] = useState(false)
  const isDesktop = useIsDesktop()

  useEffect(() => {
    void (async () => {
      await migrateKeySpace()
      const activeId = getActiveProjectId()
      const [saved, blob] = await Promise.all([loadProject(), activeId ? loadAudio(activeId) : Promise.resolve(undefined)])
      if (saved && blob) {
        const url = URL.createObjectURL(blob)
        audio.load(url, saved.name)
        // No blocks placed yet means he hasn't started choreographing; land on setup.
        const view = saved.blocks.length === 0 ? 'setup' : 'sheet'
        set({ project: saved, audioUrl: url, view }, false)
        setSegmentId(saved.segments[0]?.id ?? null)
        if (getCurrentUser()) void pullNow()
      }
      setBooted(true)
      // Asking early means the grant is in place before there is work to lose.
      void requestPersistence()
    })()
  }, [])

  // Switching or creating a project changes which document is open, so the
  // deliberate "New" screen (opened without a null project) always steps aside.
  useEffect(() => {
    setCreating(false)
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
            b.startBeat < selection.startBeat + selection.beats &&
            b.startBeat + b.beats > selection.startBeat,
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

  if (!booted) return null
  if (!project || creating) return <DropAudio onCancel={project ? () => setCreating(false) : undefined} />
  if (view === 'rehearse') return <Rehearse project={project} />
  if (view === 'setup') return <SongSetup project={project} />
  if (view === 'floor') return <Floor project={project} />

  const lyricSegment = project.segments.find((s) => s.id === lyricsFor)
  const marker = project.markers.find((m) => m.id === markerFor)

  return (
    <div className="app">
      <div className="appbar">
        <div className="brand only-wide">
          <span className="dot" /> Countoff
        </div>
        <button className="app-title only-narrow" onClick={() => setShowMenu(true)} title="Project name, setup, projects and backups">
          <span className="name">{project.name}</span>
          <i className="ph ph-caret-down" />
        </button>
        <input
          className="project-name only-wide"
          value={project.name}
          onChange={(e) => updateProject({ name: e.target.value }, 'project-name')}
        />
        <span className="chip only-wide">
          <i className="ph ph-list-numbers i" /> {project.blocks.length} placed
        </span>
        <span className="chip only-wide">
          <i className="ph ph-flag i" /> {plural(project.segments.length, 'song')}, {plural(project.markers.length, 'mark')}
        </span>
        <div className="spacer only-wide" />
        <span className="faint only-wide" style={{ fontSize: 11 }}>
          <kbd>Space</kbd> play · <kbd>S</kbd>ong · <kbd>R</kbd>ehearse
        </span>
        <button className="ghost icon only-wide" onClick={() => set({ view: 'setup' }, false)} title="Song setup: cuts, transitions, downbeats, tempo">
          <i className="ph ph-sliders-horizontal i" />
        </button>
        <button className="ghost icon only-wide" onClick={() => set({ view: 'floor' }, false)} title="Floor: who is dancing when, and where they stand">
          <i className="ph ph-users-three i" />
        </button>
        <button className="ghost icon only-wide" onClick={() => setShowProjects(true)} title="Projects: switch, duplicate, start a new one">
          <i className="ph ph-folders i" />
        </button>
        <button className="ghost icon only-wide" onClick={() => setShowBackup(true)} title="Backups, export, storage protection">
          <i className="ph ph-shield-check i" />
        </button>
        <button className="ghost icon" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          <i className="ph ph-arrow-counter-clockwise i" />
        </button>
        <button className="ghost icon" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z or Ctrl+Y)">
          <i className="ph ph-arrow-clockwise i" />
        </button>
      </div>

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
          <div className="scroll">
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
      {showMenu && (
        <ProjectMenu
          project={project}
          onClose={() => setShowMenu(false)}
          onProjects={() => setShowProjects(true)}
          onBackup={() => setShowBackup(true)}
        />
      )}
      {showProjects && (
        <ProjectsModal
          activeProjectId={project.id}
          onClose={() => setShowProjects(false)}
          onCreateNew={() => {
            setShowProjects(false)
            setCreating(true)
          }}
        />
      )}
      {status && <div className="toast">{status}</div>}
    </div>
  )
}
