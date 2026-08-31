import { initializeApp } from 'firebase/app'
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

// Public by design: a Firebase web config is not a secret. Access is controlled by
// the Firestore rules (users can only touch their own uid) plus who is signed in.
const firebaseConfig = {
  apiKey: 'AIzaSyCMxWyGRJScXgsl1qa_nNbUdIs5o86w83Y',
  authDomain: 'generic-sirbepy-project.firebaseapp.com',
  projectId: 'generic-sirbepy-project',
  messagingSenderId: '639863367604',
  appId: '1:639863367604:web:1e18472a22556ba919f4e1',
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

export const signInWithGoogle = () => signInWithPopup(auth, new GoogleAuthProvider())
export const signOutUser = () => signOut(auth)
export const getCurrentUser = (): User | null => auth.currentUser

const listeners = new Set<() => void>()
onAuthStateChanged(auth, () => listeners.forEach((l) => l()))

/** Fires on every sign-in/sign-out so store-style state elsewhere can re-read getCurrentUser(). */
export function subscribeAuth(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
