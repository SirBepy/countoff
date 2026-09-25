import { useState } from 'react'
import { signInWithGoogle } from './firebase'

/**
 * Owns the "call signInWithGoogle, show it's in flight, report a failure" sequence that used
 * to be copied onto every screen offering a sign-in (Home, JoinLink, BackupModal all had their
 * own `signingIn` boolean plus a try/catch around the same call). The one thing that genuinely
 * differs per screen is how a failure surfaces (toast vs inline error text), so the caller
 * supplies that as `onError`; `signIn` resolves to whether it actually signed in, for callers
 * that only have something to do after success (BackupModal's "Signed in. Syncing..." toast).
 */
export function useSignIn(onError: () => void) {
  const [signingIn, setSigningIn] = useState(false)

  async function signIn(): Promise<boolean> {
    setSigningIn(true)
    try {
      await signInWithGoogle()
      return true
    } catch {
      onError()
      return false
    } finally {
      setSigningIn(false)
    }
  }

  return { signingIn, signIn }
}
