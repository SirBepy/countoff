import { set, toggleHideCast, updateProject, useStore } from '../lib/store'
import type { Project } from '../lib/types'

interface Props {
  project: Project
  onClose: () => void
  onProjects: () => void
  onBackup: () => void
}

/** The phone's title button opens this: three destinations that were unlabelled
 *  top-bar icons, plus the rename that competed with them for width. */
export default function ProjectMenu({ project, onClose, onProjects, onBackup }: Props) {
  const hideCast = useStore((s) => s.hideCast)
  const go = (run: () => void) => () => {
    onClose()
    run()
  }

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header>
          <i className="ph ph-music-notes-simple i" /> Project
          <div className="spacer" />
          <button className="ghost icon" onClick={onClose} title="Close">
            <i className="ph ph-x" />
          </button>
        </header>

        <div className="content">
          <div className="field">
            <label htmlFor="project-name">Name</label>
            <input
              id="project-name"
              value={project.name}
              onChange={(e) => updateProject({ name: e.target.value }, 'project-name')}
            />
          </div>

          <button className="menu-item" onClick={go(() => set({ view: 'setup' }, false))}>
            <i className="ph ph-sliders-horizontal" />
            <span>
              Song setup
              <div className="sub">Cuts, transitions, downbeats, tempo</div>
            </span>
          </button>
          <button className="menu-item" onClick={go(() => set({ view: 'floor' }, false))}>
            <i className="ph ph-users-three" />
            <span>
              Floor
              <div className="sub">Who dances when, and where they stand</div>
            </span>
          </button>
          <button className="menu-item" onClick={go(toggleHideCast)}>
            <i className={`ph ${hideCast ? 'ph-eye-closed' : 'ph-eye'}`} />
            <span>
              {hideCast ? 'Show the cast' : 'Hide the cast'}
              <div className="sub">Whose cue tags crowd the sheet on a full number</div>
            </span>
          </button>
          <button className="menu-item" onClick={go(onProjects)}>
            <i className="ph ph-folders" />
            <span>
              Projects
              <div className="sub">Switch, duplicate, start a new one</div>
            </span>
          </button>
          <button className="menu-item" onClick={go(onBackup)}>
            <i className="ph ph-shield-check" />
            <span>
              Backups
              <div className="sub">Export, sync and storage protection</div>
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
