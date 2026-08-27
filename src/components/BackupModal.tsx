import { useEffect, useRef, useState } from 'react'
import {
  download,
  exportBackup,
  importBackup,
  readSnapshots,
  requestPersistence,
  restoreSnapshot,
  storageEstimate,
  type Snapshot,
} from '../lib/backup'
import { audio } from '../lib/audio'
import { saveAudio, wipe } from '../lib/db'
import { cancelPendingSave, flash, replaceProject, updateProject } from '../lib/store'
import { clearConfig, DEFAULT_REPO, getConfig, testConnection, setConfig as setSyncConfig } from '../lib/sync'
import { pullNow, pushNow, refreshStatus, resolveConflictKeepMine, resolveConflictTakeRemote, useSyncStatus } from '../lib/syncEngine'
import type { Project } from '../lib/types'

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

export default function BackupModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState({ used: 0, quota: 0 })
  const [tokenInput, setTokenInput] = useState('')
  const [connecting, setConnecting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const audioInput = useRef<HTMLInputElement>(null)
  const syncStatus = useSyncStatus()

  useEffect(() => {
    setSnapshots(readSnapshots())
    void navigator.storage?.persisted?.().then(setPersisted)
    void storageEstimate().then(setUsage)
  }, [])

  async function askPersistence() {
    const ok = await requestPersistence()
    setPersisted(ok)
    flash(ok ? 'Storage is now protected from cleanup' : 'The browser declined. Export a backup file instead.')
  }

  async function doExport() {
    try {
      download(await exportBackup(), `${project.name || 'countoff'}-backup.json`)
      flash('Backup downloaded')
    } catch {
      flash('Export failed')
    }
  }

  /**
   * Re-attaches a song without touching the choreography. A backup deliberately
   * leaves the audio out, so restoring on another device needs this to finish.
   */
  async function replaceAudio(file: File) {
    try {
      const ctx = new AudioContext()
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
      void ctx.close()
      await saveAudio(file)
      audio.load(URL.createObjectURL(file), project.name)
      updateProject({ audioName: file.name, duration: buffer.duration })
      flash(`Loaded ${file.name}. Counts and lyrics are unchanged.`)
    } catch {
      flash('Could not read that audio file')
    }
  }

  async function doImport(file: File) {
    try {
      const restored = await importBackup(file)
      // Adopt the restored project in memory and drop any queued write first,
      // or the unload flush puts the old project straight back on top of it.
      cancelPendingSave()
      replaceProject(restored, { selection: null }, false)
      flash('Backup restored. Reloading...')
      setTimeout(() => location.reload(), 700)
    } catch {
      flash('That file is not a Countoff backup')
    }
  }

  async function connect() {
    const token = tokenInput.trim()
    if (!token) return
    setConnecting(true)
    const result = await testConnection({ token, repo: DEFAULT_REPO })
    setConnecting(false)
    if (!result.ok) {
      flash(result.message)
      return
    }
    setSyncConfig(token)
    setTokenInput('')
    refreshStatus()
    flash('Connected. Syncing...')
    await pullNow()
  }

  function disconnect() {
    if (!confirm('Disconnect sync and forget the stored token on this device?')) return
    clearConfig()
    refreshStatus()
    flash('Disconnected')
  }

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header>
          <i className="ph ph-shield-check i" /> Your data
          <div className="spacer" />
          <button className="ghost icon" onClick={onClose}>
            <i className="ph ph-x" />
          </button>
        </header>

        <div className="content">
          <div className="field">
            <label>Where it lives</label>
            <p className="muted" style={{ margin: 0 }}>
              The choreography, your move clips and the audio are stored in this browser on this machine. Nothing is
              uploaded anywhere. Clearing site data, or using a different browser, means starting over.
            </p>
          </div>

          <div className="result" style={{ cursor: 'default' }}>
            <i
              className={`ph ${persisted ? 'ph-shield-check' : 'ph-warning'} i`}
              style={{ color: persisted ? 'var(--e1)' : 'var(--e2)', fontSize: 20 }}
            />
            <div style={{ flex: 1 }}>
              <div className="move-name">{persisted ? 'Protected from browser cleanup' : 'Not protected yet'}</div>
              <div className="move-note">
                {persisted
                  ? `Using ${mb(usage.used)} of ${mb(usage.quota)}`
                  : 'The browser may evict this data if the disk gets full'}
              </div>
            </div>
            {!persisted && (
              <button className="primary" onClick={askPersistence}>
                Protect it
              </button>
            )}
          </div>

          <div className="field">
            <label>Song file</label>
            <div className="row wrap">
              <span className="chip">
                <i className="ph ph-waveform i" /> {project.audioName}
              </span>
              <button onClick={() => audioInput.current?.click()}>
                <i className="ph ph-music-notes i" /> Load a different file
              </button>
            </div>
            <span className="faint" style={{ fontSize: 11 }}>
              Swaps the audio and keeps every count, move and lyric. Use this after restoring a backup, or on a new
              device. Pick the same file and nothing shifts.
            </span>
            <input
              ref={audioInput}
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void replaceAudio(file)
              }}
            />
          </div>

          <div className="field">
            <label>Backup file</label>
            <div className="row">
              <button className="primary" onClick={doExport}>
                <i className="ph ph-download-simple i" /> Export backup
              </button>
              <button onClick={() => fileInput.current?.click()}>
                <i className="ph ph-upload-simple i" /> Restore from file
              </button>
            </div>
            <span className="faint" style={{ fontSize: 11 }}>
              Contains the choreography, moves, lyrics, markers and every move clip. The song itself is not included, so
              pick the same audio file again after restoring.
            </span>
            <input
              ref={fileInput}
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void doImport(file)
              }}
            />
          </div>

          <div className="field">
            <label>Start over</label>
            <p className="muted" style={{ margin: 0 }}>
              Deletes this choreography and its moves from this device and starts a new song from scratch.
            </p>
            <button
              className="ghost"
              style={{ color: 'var(--danger)' }}
              onClick={async () => {
                if (!confirm('Delete this choreography and start over? This cannot be undone.')) return
                await wipe()
                location.reload()
              }}
            >
              <i className="ph ph-trash i" /> Delete and start over
            </button>
          </div>

          <div className="field">
            <label>Sync across devices</label>
            {syncStatus.configured ? (
              <>
                <div className="result" style={{ cursor: 'default' }}>
                  <i className="ph ph-cloud-check i" style={{ color: 'var(--e1)', fontSize: 20 }} />
                  <div style={{ flex: 1 }}>
                    <div className="move-name">Connected to {getConfig()?.repo}</div>
                    <div className="move-note">
                      {syncStatus.syncing
                        ? 'Syncing...'
                        : syncStatus.lastSyncedAt
                          ? `Last synced ${new Date(syncStatus.lastSyncedAt).toLocaleString()}`
                          : 'Not synced yet'}
                    </div>
                  </div>
                  <button onClick={() => void pushNow()} disabled={syncStatus.syncing}>
                    Sync now
                  </button>
                </div>
                <span className="faint" style={{ fontSize: 11 }}>
                  Pushes the choreography and any new or changed move clips to the private repo, and pulls in
                  whatever changed elsewhere. The song itself never leaves this device.
                </span>
                <button className="ghost" onClick={disconnect}>
                  Disconnect
                </button>
              </>
            ) : (
              <>
                <p className="muted" style={{ margin: 0 }}>
                  Connect a private GitHub repo to carry this choreography between devices. Paste a fine-grained
                  personal access token scoped to that one repo, with read and write access to Contents.
                </p>
                <div className="row">
                  <input
                    type="password"
                    placeholder="GitHub token"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button className="primary" disabled={!tokenInput.trim() || connecting} onClick={connect}>
                    {connecting ? 'Connecting...' : 'Connect'}
                  </button>
                </div>
              </>
            )}
          </div>

          {syncStatus.conflict && (
            <div className="field">
              <label>Sync conflict</label>
              <p className="muted" style={{ margin: 0 }}>
                This device saved at {new Date(syncStatus.conflict.local.updatedAt).toLocaleString()}. GitHub has a
                version saved at {new Date(syncStatus.conflict.remote.updatedAt).toLocaleString()}, the{' '}
                {syncStatus.conflict.remote.updatedAt > syncStatus.conflict.local.updatedAt ? 'newer' : 'older'} one.
              </p>
              <div className="row">
                <button className="primary" onClick={() => void resolveConflictKeepMine()}>
                  Keep this device's version
                </button>
                <button onClick={() => void resolveConflictTakeRemote()}>Take the GitHub version</button>
              </div>
            </div>
          )}

          <div className="field">
            <label>Automatic history ({snapshots.length})</label>
            {snapshots.length ? (
              snapshots.map((snap, i) => (
                <div key={i} className="result" style={{ cursor: 'default' }}>
                  <i className="ph ph-clock-counter-clockwise i" />
                  <div style={{ flex: 1 }}>
                    <div className="move-name">{new Date(snap.at).toLocaleString()}</div>
                    <div className="move-note">
                      {snap.label} · {snap.project.segments.length} songs
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm('Replace the current choreography with this version?')) return
                      const restored = await restoreSnapshot(snap)
                      replaceProject(restored)
                      flash('Restored')
                      onClose()
                    }}
                  >
                    Restore
                  </button>
                </div>
              ))
            ) : (
              <span className="faint" style={{ fontSize: 11 }}>
                A version is kept automatically about once a minute while you work.
              </span>
            )}
          </div>
        </div>

        <footer>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}
