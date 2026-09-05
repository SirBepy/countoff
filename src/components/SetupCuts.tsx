import SongSetup from './SongSetup'
import type { Project } from '../lib/types'

/**
 * Step 1 stub. Todo 08 replaces this body with a cuts-only, millisecond-precision
 * editor; until then it renders the full flat setup list so nothing already
 * working is taken away mid-flow.
 */
export default function SetupCuts({ project }: { project: Project }) {
  return <SongSetup project={project} />
}
