import { useRef, useState } from 'react'
import { detectTempo } from '../lib/bpm'
import { saveAudio, saveProject } from '../lib/db'
import { STARTER_MOVES } from '../lib/moves'
import { flash, replaceProject, uid } from '../lib/store'
import type { Project } from '../lib/types'
import { audio } from '../lib/audio'

export default function DropAudio() {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function accept(file: File) {
    setBusy('Reading audio')
    const bytes = await file.arrayBuffer()
    setBusy('Decoding')
    const ctx = new AudioContext()
    const buffer = await ctx.decodeAudioData(bytes.slice(0))
    setBusy('Finding the tempo')
    // Sample the middle of the track: intros and fades skew the estimate.
    const from = Math.min(20, buffer.duration * 0.1)
    const estimate = detectTempo(buffer, from, Math.min(from + 60, buffer.duration))
    void ctx.close()

    const project: Project = {
      id: uid(),
      name: file.name.replace(/\.[^.]+$/, ''),
      audioName: file.name,
      duration: buffer.duration,
      segments: [
        {
          id: uid(),
          name: 'Song 1',
          start: 0,
          bpm: estimate.bpm,
          anchor: estimate.phase,
          beatsPerBar: 4,
          lyrics: [],
          lyricOffset: 0,
        },
      ],
      blocks: [],
      markers: [],
      moves: STARTER_MOVES,
      updatedAt: Date.now(),
    }

    await saveAudio(file)
    await saveProject(project)
    const url = URL.createObjectURL(file)
    audio.load(url)
    replaceProject(project, { audioUrl: url })
    flash(`Detected ${estimate.bpm} BPM. Check the "1" before building.`)
    setBusy(null)
  }

  return (
    <div className="drop">
      <div
        className={`drop-inner${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const file = e.dataTransfer.files[0]
          if (file) void accept(file)
        }}
      >
        <div style={{ fontSize: 44, marginBottom: 10 }}>
          <i className="ph ph-music-notes-plus" />
        </div>
        <h1 style={{ margin: '0 0 6px', fontSize: 26, letterSpacing: '-0.02em' }}>Drop your medley</h1>
        <p className="muted" style={{ margin: '0 0 22px' }}>
          One audio file. Countoff finds the tempo, you confirm the "1", then you build the choreo on top of the lyrics.
        </p>
        <button className="primary" disabled={!!busy} onClick={() => input.current?.click()}>
          {busy ? (
            <>
              <i className="ph ph-spinner i" /> {busy}...
            </>
          ) : (
            <>
              <i className="ph ph-folder-open i" /> Choose a file
            </>
          )}
        </button>
        <input
          ref={input}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void accept(file)
          }}
        />
        <p className="faint" style={{ marginTop: 22, marginBottom: 0, fontSize: 12 }}>
          Everything stays on this machine. Nothing is uploaded.
        </p>
      </div>
    </div>
  )
}
