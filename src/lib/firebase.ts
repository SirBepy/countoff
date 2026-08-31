import { initializeApp } from 'firebase/app'
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

// Set by the Android shell's WebViewClient, only on the site's own origin. Its signIn()
// resolves or rejects window.__androidAuth{Resolve,Reject}, since a @JavascriptInterface
// method cannot return a Promise directly.
interface AndroidAuthBridge {
  signIn: () => void
}

declare global {
  interface Window {
    AndroidAuth?: AndroidAuthBridge
    __androidAuthResolve?: (idToken: string) => void
    __androidAuthReject?: (reason: string) => void
  }
}

// Public by design: a web config is not a secret; the Firestore rules and the signed-in
// account are what guard the data. authDomain must match the origin the app is served
// from: cross-origin puts /__/auth/handler in a partitioned storage bucket, and mobile
// Chrome then fails sign-in with "missing initial state".
const firebaseConfig = {
  apiKey: 'AIzaSyCMxWyGRJScXgsl1qa_nNbUdIs5o86w83Y',
  authDomain: 'generic-sirbepy-project.firebaseapp.com',
  projectId: 'generic-sirbepy-project',
  messagingSenderId: '639863367604',
  appId: '1:639863367604:web:1e18472a22556ba919f4e1',
}

// Firebase Hosting answers on both <project>.web.app and <project>.firebaseapp.com, but
// only the authDomain one has a registered OAuth redirect. Landing on the other fails
// sign-in with "missing initial state", so send the browser to the canonical host first.
if (location.hostname.endsWith('.web.app') && location.hostname !== firebaseConfig.authDomain) {
  location.replace(`https://${firebaseConfig.authDomain}${location.pathname}${location.search}${location.hash}`)
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

// Opt-in only, and only reachable from a dev build: production never carries this branch.
const useEmulator = import.meta.env.DEV && new URLSearchParams(window.location.search).get('emulator') === '1'
if (useEmulator) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, 'localhost', 8080)
  // No Google popup in an automated test; this email/password path only exists
  // behind the same emulator flag, so a test can seed a fake signed-in user.
  Object.assign(window, {
    __testSignIn: (email: string, password: string) =>
      createUserWithEmailAndPassword(auth, email, password).catch(() => signInWithEmailAndPassword(auth, email, password)),
  })
}

// signInWithPopup needs window.open, which the Android WebView never provides, and Google
// blocks OAuth from embedded WebView user agents anyway. The bridge sidesteps both by doing
// the account picker natively and handing back a plain ID token.
function getAndroidIdToken(bridge: AndroidAuthBridge): Promise<string> {
  return new Promise((resolve, reject) => {
    window.__androidAuthResolve = (idToken) => {
      delete window.__androidAuthResolve
      delete window.__androidAuthReject
      resolve(idToken)
    }
    window.__androidAuthReject = (reason) => {
      delete window.__androidAuthResolve
      delete window.__androidAuthReject
      reject(new Error(reason))
    }
    bridge.signIn()
  })
}

export const signInWithGoogle = () => {
  const bridge = window.AndroidAuth
  if (bridge) {
    return getAndroidIdToken(bridge).then((idToken) =>
      signInWithCredential(auth, GoogleAuthProvider.credential(idToken)),
    )
  }
  return signInWithPopup(auth, new GoogleAuthProvider())
}

export const signOutUser = () => signOut(auth)
export const getCurrentUser = (): User | null => auth.currentUser

const listeners = new Set<() => void>()
onAuthStateChanged(auth, () => listeners.forEach((l) => l()))

/** Fires on every sign-in/sign-out so store-style state elsewhere can re-read getCurrentUser(). */
export function subscribeAuth(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
