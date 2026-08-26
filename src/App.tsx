import { useEffect, useState } from 'react'
import DropAudio from './components/DropAudio'
import LyricsModal from './components/LyricsModal'
import MoveLibrary from './components/MoveLibrary'
import MoveModal from './components/MoveModal'
import Rehearse from './components/Rehearse'
import Sheet from './components/Sheet'
import SongMap from './components/SongMap'
import Transport from './components/Transport'
import { audio } from './lib/audio'
import { loadAudio, loadProject, wipe } from './lib/db'
import { segmentAt, timeToBeat } from './lib/grid'
import { markAt, splitSongAt } from './lib/markers'
import { flushSave, getState, hasPendingSave, removeBlocks, set, updateProject, useStore } from './lib/store'
import { requestPersistence } from './lib/backup'
import BackupModal from './components/BackupModal'

export default function App() {
  const project = useStore((s) => s.project)
  const view = useStore((s) => s.view)
  const status = useStore((s) => s.status)
  const [booted, setBooted] = useState(false)
  const [segmentId, setSegmentId] = useState<string | null>(null)
  const [lyricsFor, setLyricsFor] = useState<string | null>(null)
  const [moveFor, setMoveFor] = useState<string | null>(null)
  const [showBackup, setShowBackup] = useState(false)

  useEffect(() => {
    void (async () => {
      const [saved, blob] = await Promise.all([loadProject(), loadAudio()])
      if (saved && blob) {
        const url = URL.createObjectURL(blob)
        audio.load(url, saved.name)
        set({ project: saved, audioUrl: url }, false)
        setSegmentId(saved.segments[0]?.id ?? null)
      }
      setBooted(true)
      // Asking early means the grant is in place before there is work to lose.
      void requestPersistence()
    })()
  }, [])

  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!hasPendingSave()) return
      flushSave()
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
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
      } else if (e.key === 'm') {
        audio.setMetronome(!audio.getMetronome())
      } else if (e.key === 'r') {
        set({ view: getState().view === 'sheet' ? 'rehearse' : 'sheet' }, false)
      } else if (e.key === 'Escape') {
        set({ view: 'sheet', selection: null }, false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [project])

  if (!booted) return null
  if (!project) return <DropAudio />

  if (view === 'rehearse') return <Rehearse project={project} />

  const lyricSegment = project.segments.find((s) => s.id === lyricsFor)

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="dot" /> Countoff
        </div>
        <input
          value={project.name}
          onChange={(e) => updateProject({ name: e.target.value })}
          style={{ width: 220, background: 'transparent', border: '1px solid transparent' }}
        />
        <span className="chip">
          <i className="ph ph-waveform i" /> {project.audioName}
        </span>
        <span className="chip">
          <i className="ph ph-list-numbers i" /> {project.blocks.length} moves placed
        </span>
        <span className="chip">
          <i className="ph ph-flag i" /> {project.segments.length} songs, {project.markers.length} marks
        </span>
        <div className="spacer" />
        <span className="faint" style={{ fontSize: 11 }}>
          <kbd>Space</kbd> play · <kbd>S</kbd>ong · <kbd>T</kbd>ransition · <kbd>D</kbd>rop · <kbd>M</kbd> click · <kbd>R</kbd>ehearse
        </span>
        <button className="ghost" onClick={() => setShowBackup(true)} title="Backups, export, storage protection">
          <i className="ph ph-shield-check i" /> Data
        </button>
        <button
          className="ghost"
          title="Delete this project and start from a new song"
          onClick={async () => {
            if (!confirm('Delete this choreography and start over? This cannot be undone.')) return
            await wipe()
            location.reload()
          }}
        >
          <i className="ph ph-arrow-counter-clockwise i" /> Start over
        </button>
      </div>

      <div className="body">
        <aside className="rail">
          <MoveLibrary project={project} onEditMove={setMoveFor} />
        </aside>

        <main className="main">
          <SongMap project={project} selectedSegmentId={segmentId} onSelectSegment={setSegmentId} />
          <div className="scroll">
            <Sheet
              project={project}
              selectedSegmentId={segmentId}
              onSelectSegment={setSegmentId}
              onEditLyrics={setLyricsFor}
            />
          </div>
        </main>
      </div>

      <Transport project={project} />

      {lyricSegment && <LyricsModal segment={lyricSegment} onClose={() => setLyricsFor(null)} />}
      {moveFor && <MoveModal project={project} moveId={moveFor} onClose={() => setMoveFor(null)} />}
      {showBackup && <BackupModal project={project} onClose={() => setShowBackup(false)} />}
      {status && <div className="toast">{status}</div>}
    </div>
  )
}
