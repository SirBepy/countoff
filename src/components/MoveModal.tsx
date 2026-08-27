import { useEffect, useRef, useState } from 'react'
import { deleteClip, saveClip } from '../lib/db'
import { invalidateClip, useClip } from '../lib/clips'
import { flash, removeMove, upsertMove } from '../lib/store'
import type { Move, Project } from '../lib/types'

const BEAT_OPTIONS = [1, 2, 4, 8, 16]

interface Props {
  project: Project
  moveId: string
  onClose: () => void
}

export default function MoveModal({ project, moveId, onClose }: Props) {
  const existing = project.moves.find((m) => m.id === moveId)
  const [draft, setDraft] = useState<Move>(
    existing ?? { id: moveId, name: '', beats: 4, energy: 2, note: '' },
  )
  const [clipVersion, setClipVersion] = useState(0)
  const clipUrl = useClip(draft.hasClip ? `${draft.id}` : null, draft.hasClip)
  const fileInput = useRef<HTMLInputElement>(null)

  const patch = (p: Partial<Move>) => setDraft((d) => ({ ...d, ...p }))

  async function attach(blob: Blob) {
    await saveClip(draft.id, blob)
    invalidateClip(draft.id)
    patch({ hasClip: true })
    setClipVersion((v) => v + 1)
  }

  async function dropClip() {
    await deleteClip(draft.id)
    invalidateClip(draft.id)
    patch({ hasClip: false })
    setClipVersion((v) => v + 1)
  }

  function save() {
    if (!draft.name.trim()) {
      flash('Give the move a name')
      return
    }
    upsertMove({ ...draft, name: draft.name.trim(), builtin: existing?.builtin }, `move-${draft.id}`)
    onClose()
  }

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header>
          <i className="ph ph-person-simple-walk i" />
          {existing ? 'Edit move' : 'New move'}
          <div className="spacer" />
          <button className="ghost icon" onClick={onClose}>
            <i className="ph ph-x" />
          </button>
        </header>

        <div className="content">
          <div className="field">
            <label>Name</label>
            <input autoFocus value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Hip bump right" />
          </div>

          <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>How many beats</label>
              <div className="row">
                {BEAT_OPTIONS.map((b) => (
                  <button key={b} className={draft.beats === b ? 'on' : ''} onClick={() => patch({ beats: b })}>
                    {b}
                  </button>
                ))}
              </div>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Energy</label>
              <div className="row">
                {([1, 2, 3] as const).map((e) => (
                  <button key={e} className={draft.energy === e ? 'on' : ''} onClick={() => patch({ energy: e })}>
                    {['Chill', 'Medium', 'Big'][e - 1]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="field">
            <label>Note for the dancers</label>
            <input value={draft.note ?? ''} onChange={(e) => patch({ note: e.target.value })} placeholder="Step out, tap foot in" />
          </div>

          <div className="field">
            <label>Clip</label>
            {draft.hasClip && clipUrl ? (
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <video key={clipVersion} src={clipUrl} controls loop muted playsInline style={{ width: 260, borderRadius: 8, border: '1px solid var(--line)' }} />
                <button className="ghost" onClick={dropClip} style={{ color: 'var(--danger)' }}>
                  <i className="ph ph-trash i" /> Remove clip
                </button>
              </div>
            ) : (
              <Recorder onRecorded={attach} onPickFile={() => fileInput.current?.click()} />
            )}
            <input
              ref={fileInput}
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void attach(file)
              }}
            />
          </div>
        </div>

        <footer>
          {existing && (
            <button
              className="ghost"
              style={{ color: 'var(--danger)', marginRight: 'auto' }}
              onClick={() => {
                removeMove(draft.id)
                void dropClip()
                onClose()
              }}
            >
              <i className="ph ph-trash i" /> Delete move
            </button>
          )}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </footer>
      </div>
    </div>
  )
}

const RECORD_SECONDS = 5

function Recorder({ onRecorded, onPickFile }: { onRecorded: (blob: Blob) => void; onPickFile: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [state, setState] = useState<'idle' | 'ready' | 'counting' | 'recording' | 'error'>('idle')
  const [count, setCount] = useState(3)

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), [])

  async function openCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
      streamRef.current = stream
      if (video.current) video.current.srcObject = stream
      setState('ready')
    } catch {
      setState('error')
    }
  }

  function record() {
    const stream = streamRef.current
    if (!stream) return
    setState('counting')
    setCount(3)
    let n = 3
    const tick = setInterval(() => {
      n -= 1
      setCount(n)
      if (n > 0) return
      clearInterval(tick)
      setState('recording')
      const chunks: Blob[] = []
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      recorder.onstop = () => {
        onRecorded(new Blob(chunks, { type: 'video/webm' }))
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        setState('idle')
      }
      recorder.start()
      setTimeout(() => recorder.stop(), RECORD_SECONDS * 1000)
    }, 700)
  }

  if (state === 'error') {
    return (
      <div className="row">
        <span className="muted">Camera unavailable.</span>
        <button onClick={onPickFile}>
          <i className="ph ph-upload-simple i" /> Upload a video instead
        </button>
      </div>
    )
  }

  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div style={{ position: 'relative' }}>
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          style={{ width: 260, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', display: state === 'idle' ? 'none' : 'block' }}
        />
        {state === 'counting' && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 70, fontWeight: 800 }}>{count}</div>
        )}
        {state === 'recording' && (
          <div style={{ position: 'absolute', top: 8, left: 8 }} className="chip">
            <i className="ph ph-record i" style={{ color: 'var(--danger)' }} /> Recording {RECORD_SECONDS}s
          </div>
        )}
      </div>
      <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        {state === 'idle' && (
          <button onClick={openCamera}>
            <i className="ph ph-video-camera i" /> Use webcam
          </button>
        )}
        {state === 'ready' && (
          <button className="primary" onClick={record}>
            <i className="ph ph-record i" /> Record {RECORD_SECONDS}s
          </button>
        )}
        <button onClick={onPickFile}>
          <i className="ph ph-upload-simple i" /> Upload a video
        </button>
      </div>
    </div>
  )
}
