import { useEffect, useRef, useState } from 'react'
import { joinViaLink, resolveLink, type ResolvedLink } from '../lib/collab'
import { signInWithGoogle } from '../lib/firebase'
import { openProjectById } from '../lib/openProject'
import { useSyncStatus } from '../lib/syncEngine'

/** What a collaborator link does when it lands. Unlike the view-only link, this one grants
 *  access to a live document, so it cannot open anonymously: the member record that IS the
 *  grant has to be written by a signed-in account. */
export default function JoinLink({ token, onOpened }: { token: string; onOpened: () => void }) {
  const sync = useSyncStatus()
  const [link, setLink] = useState<ResolvedLink | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  // Joining twice is harmless but the second run races the first's project open.
  const claimed = useRef(false)

  useEffect(() => {
    void resolveLink(token)
      .then((resolved) => {
        if (!resolved) setError('That link does not point at anything.')
        setLink(resolved)
      })
      .catch(() => setError('That link could not be checked. Are you online?'))
  }, [token])

  useEffect(() => {
    if (!sync.configured || claimed.current) return
    claimed.current = true
    void (async () => {
      try {
        const projectId = await joinViaLink(token)
        if (!(await openProjectById(projectId))) throw new Error('That project could not be opened')
        onOpened()
      } catch (e) {
        claimed.current = false
        setError(e instanceof Error ? e.message : 'That link did not open')
      }
    })()
  }, [sync.configured, token, onOpened])

  async function signIn() {
    setSigningIn(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch {
      setError('Could not sign in')
    }
    setSigningIn(false)
  }

  const what = link?.role === 'viewer' ? 'read this choreography' : 'edit this choreography'

  return (
    <div className="drop">
      <div className="drop-inner">
        <div style={{ fontSize: 44, marginBottom: 10 }}>
          <i className={`ph ${error ? 'ph-link-break' : 'ph-users-three'}`} />
        </div>
        <h1 style={{ margin: '0 0 6px', fontSize: 26, letterSpacing: '-0.02em' }}>
          {error ? 'That link did not open' : `You have been invited to ${what}`}
        </h1>
        <p className="muted" style={{ margin: '0 0 22px' }}>
          {error ??
            (sync.configured
              ? 'Opening it now...'
              : 'Sign in with Google so the project lands in your library and stays there.')}
        </p>
        {!sync.configured && !error && (
          <button className="primary" disabled={signingIn} onClick={() => void signIn()}>
            <i className="ph ph-google-logo i" /> {signingIn ? 'Signing in...' : 'Sign in and open it'}
          </button>
        )}
        {error && (
          <button onClick={onOpened}>
            <i className="ph ph-house i" /> Go to my choreographies
          </button>
        )}
      </div>
    </div>
  )
}
