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
import { deleteProject, saveAudio } from '../lib/db'
import { signInWithGoogle, signOutUser } from '../lib/firebase'
import { cancelPendingSave, flash, replaceProject, updateProject } from '../lib/store'
import { pushAllProjects, pushNow, resolveConflictKeepMine, resolveConflictTakeRemote, useSyncStatus } from '../lib/syncEngine'
import type { Project } from '../lib/types'

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

export default function BackupModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState({ used: 0, quota: 0 })
  const [signingIn, setSigningIn] = useState(false)
  const [syncingAll, setSyncingAll] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const audioInput = useRef<HTMLInputElement>(null)
  const syncStatus = useSyncStatus()

  useEffect(() => {
    setSnapshots(readSnapshots(project.id))
    void navigator.storage?.persisted?.().then(setPersisted)
    void storageEstimate().then(setUsage)
  }, [project.id])

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
      await saveAudio(project.id, file)
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

  async function connectGoogle() {
    setSigningIn(true)
    try {
      await signInWithGoogle()
      flash('Signed in. Syncing...')
    } catch {
      flash('Google sign-in failed')
    } finally {
      setSigningIn(false)
    }
  }

  async function syncAll() {
    setSyncingAll(true)
    const result = await pushAllProjects()
    setSyncingAll(false)
    flash(
      result.failed.length
        ? `Synced ${result.pushed}, ${result.failed.length} failed: ${result.failed.map((f) => f.name).join(', ')}`
        : `Synced ${result.pushed} project${result.pushed === 1 ? '' : 's'}`,
    )
  }

  function disconnect() {
    if (!confirm('Sign out on this device?')) return
    void signOutUser()
    flash('Signed out')
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
                await deleteProject(project.id)
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
                    <div className="move-name">Signed in as {syncStatus.email}</div>
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
                  Pushes the choreography to your Google account and pulls in whatever changed elsewhere. Move
                  clips and the song itself stay on this device only.
                </span>
                <div className="row">
                  <button onClick={() => void syncAll()} disabled={syncStatus.syncing || syncingAll}>
                    <i className="ph ph-cloud-arrow-up i" /> {syncingAll ? 'Syncing all...' : 'Sync all projects'}
                  </button>
                  <button className="ghost" onClick={disconnect}>
                    Sign out
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="muted" style={{ margin: 0 }}>
                  Sign in with Google to carry this choreography between devices. No token to copy, no repo to set
                  up.
                </p>
                <button className="primary" disabled={signingIn} onClick={() => void connectGoogle()}>
                  <i className="ph ph-google-logo i" /> {signingIn ? 'Signing in...' : 'Sign in with Google'}
                </button>
              </>
            )}
          </div>

          {syncStatus.conflict && (
            <div className="field">
              <label>Sync conflict</label>
              <p className="muted" style={{ margin: 0 }}>
                This device saved at {new Date(syncStatus.conflict.local.updatedAt).toLocaleString()}. The cloud has a
                version saved at {new Date(syncStatus.conflict.remote.updatedAt).toLocaleString()}, the{' '}
                {syncStatus.conflict.remote.updatedAt > syncStatus.conflict.local.updatedAt ? 'newer' : 'older'} one.
              </p>
              <div className="row">
                <button className="primary" onClick={() => void resolveConflictKeepMine()}>
                  Keep this device's version
                </button>
                <button onClick={() => void resolveConflictTakeRemote()}>Take the cloud version</button>
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
