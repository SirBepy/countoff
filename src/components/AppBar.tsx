import { redo, set, toggleHideCast, undo, updateProject, useStore } from '../lib/store'
import type { Project } from '../lib/types'
import { useIsDesktop } from '../lib/media'
import { STEPS, STEP_LABEL } from './SetupFlow'
import ViewAs from './ViewAs'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * The editor's topbar: title, chips, the setup step picker, view-switch buttons and
 * undo/redo. Reads its own slice of the store directly (same pattern as BottomBar,
 * ViewAs) rather than taking it as props; only the handful of things App.tsx alone
 * knows - the project, the derived comment token, and its own modal setters - come
 * in as props.
 */
export default function AppBar({
  project,
  commentToken,
  onShowMenu,
  onShowHome,
  onShowBackup,
  onShowShare,
  onShowComments,
}: {
  project: Project
  commentToken: string | null | undefined
  onShowMenu: () => void
  onShowHome: () => void
  onShowBackup: () => void
  onShowShare: () => void
  onShowComments: () => void
}) {
  const readOnly = useStore((s) => s.readOnly)
  const hideCast = useStore((s) => s.hideCast)
  const canUndo = useStore((s) => s.canUndo)
  const canRedo = useStore((s) => s.canRedo)
  const isDesktop = useIsDesktop()

  return (
    <div className="appbar">
      <div className="brand only-wide">
        <span className="dot" /> Countoff
      </div>
      {readOnly ? (
        <span className="app-title only-narrow">
          <span className="name">{project.name}</span>
        </span>
      ) : (
        <button className="app-title only-narrow" onClick={onShowMenu} title="Project name, setup, projects and backups">
          <span className="name">{project.name}</span>
          <i className="ph ph-caret-down" />
        </button>
      )}
      {readOnly ? (
        <span className="project-name only-wide">{project.name}</span>
      ) : (
        <input
          className="project-name only-wide"
          value={project.name}
          onChange={(e) => updateProject({ name: e.target.value }, 'project-name')}
        />
      )}
      <span className="chip only-wide">
        <i className="ph ph-list-numbers i" /> {project.blocks.length} placed
      </span>
      <span className="chip only-wide">
        <i className="ph ph-flag i" /> {plural(project.segments.length, 'song')}, {plural(project.markers.length, 'mark')}
      </span>
      <div className="spacer only-wide" />
      <span className="faint only-wide" style={{ fontSize: 11 }}>
        <kbd>Space</kbd> play · <kbd>S</kbd>ong · <kbd>R</kbd>ehearse
      </span>
      <div className="setup-picker only-wide" role="group" aria-label="Song setup steps">
        {STEPS.map((step) => (
          <button
            key={step}
            className="setup-picker-chip"
            onClick={() => set({ view: 'setup', setupStep: step }, false)}
            title={`Setup: ${STEP_LABEL[step].toLowerCase()}`}
          >
            {STEP_LABEL[step]}
          </button>
        ))}
      </div>
      <button className="ghost icon only-wide" onClick={() => set({ view: 'floor' }, false)} title="Floor: who is dancing when, and where they stand">
        <i className="ph ph-users-three i" />
      </button>
      {!readOnly && (
        <button className="ghost icon only-wide" onClick={() => set({ view: 'video' }, false)} title="Video: lay your footage over the song">
          <i className="ph ph-film-strip i" />
        </button>
      )}
      <ViewAs project={project} compact={!isDesktop} />
      <button
        className={`ghost icon only-wide${hideCast ? ' on' : ''}`}
        onClick={toggleHideCast}
        title={hideCast ? "Show the cast's cues on the sheet" : "Hide the cast's cues on the sheet"}
      >
        <i className={`ph ${hideCast ? 'ph-eye-closed' : 'ph-eye'} i`} />
      </button>
      {!readOnly && (
        <>
          <button className="ghost icon only-wide" onClick={onShowHome} title="Your choreographies: switch, share, start a new one">
            <i className="ph ph-folders i" />
          </button>
          <button className="ghost icon only-wide" onClick={onShowBackup} title="Backups, export, storage protection">
            <i className="ph ph-shield-check i" />
          </button>
          <button className="ghost icon only-wide" onClick={onShowShare} title="Share: add people who can edit, or a view-only link">
            <i className="ph ph-share-network i" />
          </button>
        </>
      )}
      {commentToken && (
        <button className="ghost icon" onClick={onShowComments} title="Comments on the shared link">
          <i className="ph ph-chat-circle-text i" />
        </button>
      )}
      {readOnly ? (
        <span className="chip">
          <i className="ph ph-eye i" /> View only
        </span>
      ) : (
        <>
          <button className="ghost icon" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            <i className="ph ph-arrow-counter-clockwise i" />
          </button>
          <button className="ghost icon" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z or Ctrl+Y)">
            <i className="ph ph-arrow-clockwise i" />
          </button>
        </>
      )}
    </div>
  )
}
