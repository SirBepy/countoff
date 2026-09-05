import SongSetup from './SongSetup'
import type { Project } from '../lib/types'

/**
 * Step 2 stub. Todo 09 replaces this body with beat detection and adjustment
 * once every cut is settled; until then it renders the full flat setup list so
 * nothing already working is taken away mid-flow.
 */
export default function SetupBeats({ project }: { project: Project }) {
  return <SongSetup project={project} />
}
