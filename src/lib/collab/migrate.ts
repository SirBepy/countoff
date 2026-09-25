import { collection, getDocs } from 'firebase/firestore'
import { db, getCurrentUser } from '../firebase'
import type { Project } from '../types'
import { readMeta } from './read'
import { createProjectDoc } from './write'

const MIGRATED_KEY = 'countoff.collab.migrated'

/** Lifts the pre-collaboration library at users/{uid}/projects into /projects, where a
 *  document can have more than one editor. The originals are deliberately left in place:
 *  they cost nothing and they are the only copy an older build of the app can still read. */
export async function migrateLegacyProjects(): Promise<number> {
  const user = getCurrentUser()
  if (!user) return 0
  const key = `${MIGRATED_KEY}.${user.uid}`
  if (localStorage.getItem(key)) return 0
  let moved = 0
  try {
    const legacy = await getDocs(collection(db, 'users', user.uid, 'projects'))
    for (const docSnap of legacy.docs) {
      if (await readMeta(docSnap.id)) continue
      await createProjectDoc(docSnap.data() as Project)
      moved++
    }
    localStorage.setItem(key, String(Date.now()))
  } catch (e) {
    // Leaving the flag unset means the next sign-in tries again, which is the right
    // failure: the old documents are still there and nothing has been lost.
    console.error('legacy project migration failed', e)
  }
  return moved
}
