import { useEffect, useState } from 'react'
import BackupModal from './components/BackupModal'
import DropAudio from './components/DropAudio'
import LyricsModal from './components/LyricsModal'
import MarkerModal from './components/MarkerModal'
import MoveLibrary from './components/MoveLibrary'
import MoveModal from './components/MoveModal'
import Rehearse from './components/Rehearse'
import SelectionBar from './components/SelectionBar'
import Sheet from './components/Sheet'
import SongMap from './components/SongMap'
import Transport from './components/Transport'
import { audio } from './lib/audio'
import { requestPersistence } from './lib/backup'
import { loadAudio, loadProject, wipe } from './lib/db'
import { segmentAt, timeToBeat } from './lib/grid'
import { addLyricAt } from './lib/lrc'
import { markAt, splitSongAt } from './lib/markers'
import { flushSave, getState, hasPendingSave, removeBlocks, set, updateProject, useStore } from './lib/store'
import { isConfigured } from './lib/sync'
import { pullNow, scheduleSync } from './lib/syncEngine'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export default function App() {
  const project = useStore((s) => s.project)
  const view = useStore((s) => s.view)
  const status = useStore((s) => s.status)
  const libraryOpen = useStore((s) => s.libraryOpen)
  const [booted, setBooted] = useState(false)
  const [segmentId, setSegmentId] = useState<string | null>(null)
  const [lyricsFor, setLyricsFor] = useState<string | null>(null)
  const [moveFor, setMoveFor] = useState<string | null>(null)
  const [markerFor, setMarkerFor] = useState<string | null>(null)
  const [showBackup, setShowBackup] = useState(false)

  useEffect(() => {
    void (async () => {
      const [saved, blob] = await Promise.all([loadProject(), loadAudio()])
      if (saved && blob) {
        const url = URL.createObjectURL(blob)
        audio.load(url, saved.name)
        set({ project: saved, audioUrl: url }, false)
        setSegmentId(saved.segments[0]?.id ?? null)
        if (isConfigured()) void pullNow()
      }
      setBooted(true)
      // Asking early means the grant is in place before there is work to lose.
      void requestPersistence()
    })()
  }, [])

  // Pull whenever the tab comes back into view, and push once local edits settle.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && getState().project && isConfigured()) void pullNow()
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
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      const { selection } = getState()
      if (e.code === 'Space') {
        e.preventDefault()
        audio.toggle()
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
        const id = splitSongAt(audio.el.currentTime)
        if (id) setSegmentId(id)
      } else if (e.key === 't') {
        markAt(audio.el.currentTime, 'transition')
      } else if (e.key === 'd') {
        markAt(audio.el.currentTime, 'drop')
      } else if (e.key === 'b') {
        markAt(audio.el.currentTime, 'break')
      } else if (e.key === 'l') {
        // The new line's input autofocuses within this same keydown dispatch, so without
        // this the browser's own keypress action types a literal "l" into it.
        e.preventDefault()
        const id = addLyricAt(audio.el.currentTime)
        if (id) set({ editingLyricId: id }, false)
      } else if (e.key === 'm') {
        audio.setMetronome(!audio.getMetronome())
      } else if (e.key === 'r') {
        set({ view: getState().view === 'sheet' ? 'rehearse' : 'sheet' }, false)
      } else if (e.key === 'Escape') {
        set({ view: 'sheet', selection: null, libraryOpen: false }, false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [project])

  if (!booted) return null
  if (!project) return <DropAudio />
  if (view === 'rehearse') return <Rehearse project={project} />

  const lyricSegment = project.segments.find((s) => s.id === lyricsFor)
  const marker = project.markers.find((m) => m.id === markerFor)

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="dot" /> Countoff
        </div>
        <input className="project-name" value={project.name} onChange={(e) => updateProject({ name: e.target.value })} />
        <span className="chip only-wide">
          <i className="ph ph-list-numbers i" /> {project.blocks.length} placed
        </span>
        <span className="chip only-wide">
          <i className="ph ph-flag i" /> {plural(project.segments.length, 'song')}, {plural(project.markers.length, 'mark')}
        </span>
        <div className="spacer only-wide" />
        <span className="faint only-wide" style={{ fontSize: 11 }}>
          <kbd>Space</kbd> play · <kbd>S</kbd>ong · <kbd>T</kbd>ransition · <kbd>D</kbd>rop · <kbd>L</kbd>yric · <kbd>R</kbd>ehearse
        </span>
        <button className="ghost icon" onClick={() => setShowBackup(true)} title="Backups, export, storage protection">
          <i className="ph ph-shield-check i" />
        </button>
        <button
          className="ghost icon"
          title="Delete this project and start from a new song"
          onClick={async () => {
            if (!confirm('Delete this choreography and start over? This cannot be undone.')) return
            await wipe()
            location.reload()
          }}
        >
          <i className="ph ph-arrow-counter-clockwise i" />
        </button>
      </div>

      <div className="body">
        {libraryOpen && <div className="rail-scrim" onPointerDown={() => set({ libraryOpen: false }, false)} />}
        <aside className={`rail${libraryOpen ? ' open' : ''}`}>
          <MoveLibrary project={project} onEditMove={setMoveFor} />
        </aside>

        <main className="main">
          <SongMap
            project={project}
            selectedSegmentId={segmentId}
            onSelectSegment={setSegmentId}
            onEditMarker={setMarkerFor}
          />
          <div className="scroll">
            <Sheet
              project={project}
              selectedSegmentId={segmentId}
              onSelectSegment={setSegmentId}
              onEditLyrics={setLyricsFor}
              onEditMarker={setMarkerFor}
            />
          </div>
        </main>
      </div>

      <SelectionBar project={project} />
      <Transport project={project} />

      {lyricSegment && <LyricsModal segment={lyricSegment} onClose={() => setLyricsFor(null)} />}
      {moveFor && <MoveModal project={project} moveId={moveFor} onClose={() => setMoveFor(null)} />}
      {marker && <MarkerModal marker={marker} onClose={() => setMarkerFor(null)} />}
      {showBackup && <BackupModal project={project} onClose={() => setShowBackup(false)} />}
      {status && <div className="toast">{status}</div>}
    </div>
  )
}
