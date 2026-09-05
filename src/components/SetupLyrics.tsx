import SongSetup from './SongSetup'
import type { Project } from '../lib/types'

/**
 * Step 3 stub. Todo 10 replaces this body with naming songs and fitting lyrics;
 * until then it renders the full flat setup list so nothing already working is
 * taken away mid-flow.
 */
export default function SetupLyrics({ project }: { project: Project }) {
  return <SongSetup project={project} />
}
