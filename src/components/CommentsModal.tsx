import { useEffect, useState } from 'react'
import { NAME_MAX, TEXT_MAX, addShareComment, subscribeComments, type ShareComment } from '../lib/share'

// Only so a second comment on the same link does not mean retyping your name after
// the tab is closed and reopened. Never leaves the device.
const NAME_KEY = 'countoff.share.name'

const when = (at: number) => new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

export default function CommentsModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [comments, setComments] = useState<ShareComment[] | null>(null)
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => subscribeComments(token, setComments), [token])

  const canSend = !sending && name.trim().length > 0 && text.trim().length > 0

  async function send() {
    if (!canSend) return
    setSending(true)
    setError(null)
    try {
      localStorage.setItem(NAME_KEY, name.trim())
      await addShareComment(token, name.trim(), text.trim())
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not leave that comment')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header>
          <i className="ph ph-chat-circle-text i" /> Comments
          <div className="spacer" />
          <button className="ghost icon" onClick={onClose} title="Close">
            <i className="ph ph-x" />
          </button>
        </header>

        <div className="content">
          <div className="comment-thread">
            {comments === null && <div className="faint">Loading...</div>}
            {comments !== null && comments.length === 0 && <div className="faint">Nothing here yet. Say the first thing.</div>}
            {comments?.map((c) => (
              <div key={c.id} className="comment">
                <div className="who">
                  <b>{c.name}</b>
                  <span className="faint">{when(c.at)}</span>
                </div>
                <div className="what">{c.text}</div>
              </div>
            ))}
          </div>

          <div className="field">
            <label htmlFor="comment-name">Your name</label>
            <input id="comment-name" maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="comment-text">Comment</label>
            <textarea
              id="comment-text"
              rows={3}
              maxLength={TEXT_MAX}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
        </div>

        <footer>
          <button className="primary" disabled={!canSend} onClick={() => void send()}>
            <i className="ph ph-paper-plane-tilt i" /> {sending ? 'Sending...' : 'Leave comment'}
          </button>
        </footer>
      </div>
    </div>
  )
}
