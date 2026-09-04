import { useState } from 'react'
import { loadAudio } from '../lib/db'
import { getCurrentUser } from '../lib/firebase'
import { newShareToken, publishShare, shareUrl, unpublishShare } from '../lib/share'
import { updateProject } from '../lib/store'
import type { Project } from '../lib/types'

export default function ShareModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [sent, setSent] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const token = project.shareToken
  const url = token ? shareUrl(token) : null

  // A ten-minute track is 20-odd separate writes, so a bare "Updating..." reads as a hang.
  const status = sent ? `Sending the song, ${sent.done} of ${sent.total}` : busy

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label)
    setSent(null)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work')
    } finally {
      setBusy(null)
      setSent(null)
    }
  }

  const onProgress = (done: number, total: number) => setSent({ done, total })

  const create = () =>
    run('Publishing', async () => {
      if (!getCurrentUser()) throw new Error('Sign in from Backups first, so the share belongs to you')
      const next = newShareToken()
      await publishShare(next, { ...project, shareToken: next }, (await loadAudio(project.id)) ?? null, onProgress)
      updateProject({ shareToken: next })
    })

  const republish = () =>
    run('Updating', async () => {
      if (!token) return
      await publishShare(token, project, (await loadAudio(project.id)) ?? null, onProgress)
    })

  const stop = () =>
    run('Stopping', async () => {
      if (!token) return
      await unpublishShare(token)
      updateProject({ shareToken: undefined })
    })

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header>
          <i className="ph ph-share-network i" /> Share
          <div className="spacer" />
          <button className="ghost icon" onClick={onClose} title="Close">
            <i className="ph ph-x" />
          </button>
        </header>

        <div className="content">
          <div className="hint">
            <i className="ph ph-warning i" /> Anyone with the link can open this choreography and read every name in
            the cast. They can comment, but never edit.
          </div>

          {url ? (
            <>
              <div className="field">
                <label htmlFor="share-url">Link</label>
                <input id="share-url" readOnly value={url} onFocus={(e) => e.target.select()} />
              </div>
              <div className="row wrap">
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(url)
                    setCopied(true)
                  }}
                >
                  <i className="ph ph-copy i" /> {copied ? 'Copied' : 'Copy link'}
                </button>
                <button onClick={() => void republish()} disabled={!!busy}>
                  <i className="ph ph-arrows-clockwise i" /> Update now
                </button>
                <button className="ghost" style={{ color: 'var(--danger)' }} onClick={() => void stop()} disabled={!!busy}>
                  <i className="ph ph-trash i" /> Stop sharing
                </button>
              </div>
              <div className="faint">Every sync push rewrites the share, so viewers keep up with your edits.</div>
            </>
          ) : (
            <button className="primary" onClick={() => void create()} disabled={!!busy}>
              <i className="ph ph-link i" /> {status ?? 'Create a view-only link'}
            </button>
          )}

          {status && url && <div className="faint">{status}...</div>}
          {sent && sent.total > 0 && (
            <div style={{ height: 3, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${(sent.done / sent.total) * 100}%`,
                  background: 'var(--accent)',
                  transition: 'width 120ms linear',
                }}
              />
            </div>
          )}
          {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
        </div>
      </div>
    </div>
  )
}
