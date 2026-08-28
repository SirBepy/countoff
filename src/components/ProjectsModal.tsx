import { useEffect, useState } from 'react'
import { audio } from '../lib/audio'
import { deleteProject, duplicateProject, listProjects, loadAudio, loadProjectById, saveProjectRecord, setActiveProjectId } from '../lib/db'
import { cancelPendingSave, flash, getState, replaceProject, set, updateProject } from '../lib/store'
import type { Project } from '../lib/types'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export default function ProjectsModal({
  activeProjectId,
  onClose,
  onCreateNew,
}: {
  activeProjectId: string
  onClose: () => void
  onCreateNew: () => void
}) {
  const [projects, setProjects] = useState<Project[]>([])
  const [renamingId, setRenamingId] = useState<string | null>(null)

  useEffect(() => {
    void listProjects().then(setProjects)
  }, [])

  /** Order from the spec: kill the debounced save, swap the document, only then load its audio,
   * or the old project's pending write lands on top of the one just opened. */
  async function openProject(id: string) {
    if (id === activeProjectId) return onClose()
    const target = await loadProjectById(id)
    if (!target) {
      flash('Could not open that project')
      return
    }
    cancelPendingSave()
    setActiveProjectId(id)
    replaceProject(target, { selection: null, view: target.blocks.length === 0 ? 'setup' : 'sheet' }, false)
    const blob = await loadAudio(id)
    if (blob) {
      const prevUrl = getState().audioUrl
      const url = URL.createObjectURL(blob)
      audio.load(url, target.name)
      set({ audioUrl: url }, false)
      if (prevUrl) URL.revokeObjectURL(prevUrl)
    }
    onClose()
  }

  async function duplicate(id: string) {
    const copy = await duplicateProject(id)
    setProjects(await listProjects())
    flash(`Duplicated as "${copy.name}"`)
  }

  async function commitRename(id: string, rawName: string) {
    setRenamingId(null)
    const name = rawName.trim()
    if (!name) return
    if (id === activeProjectId) {
      updateProject({ name })
    } else {
      const target = await loadProjectById(id)
      if (!target) return
      await saveProjectRecord({ ...target, name, updatedAt: Date.now() })
    }
    setProjects(await listProjects())
  }

  async function remove(id: string, name: string) {
    if (projects.length <= 1) {
      flash('Keep at least one project')
      return
    }
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    await deleteProject(id)
    const remaining = await listProjects()
    setProjects(remaining)
    if (id === activeProjectId && remaining[0]) await openProject(remaining[0].id)
  }

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header>
          <i className="ph ph-folders i" /> Projects
          <div className="spacer" />
          <button className="ghost icon" onClick={onClose}>
            <i className="ph ph-x" />
          </button>
        </header>

        <div className="content">
          <div className="field">
            {projects.map((p) => (
              <div className="result" style={{ cursor: 'default' }} key={p.id}>
                <i
                  className={`ph ${p.id === activeProjectId ? 'ph-check-circle' : 'ph-folder'} i`}
                  style={{ color: p.id === activeProjectId ? 'var(--e1)' : undefined, fontSize: 20 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {renamingId === p.id ? (
                    <input
                      autoFocus
                      className="project-name"
                      defaultValue={p.name}
                      onBlur={(e) => void commitRename(p.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                    />
                  ) : (
                    <div className="move-name">{p.name}</div>
                  )}
                  <div className="move-note">
                    {plural(p.segments.length, 'song')} &middot; edited {new Date(p.updatedAt).toLocaleString()}
                  </div>
                </div>
                <div className="row wrap">
                  {p.id !== activeProjectId && <button onClick={() => void openProject(p.id)}>Open</button>}
                  <button className="ghost icon" title="Duplicate" onClick={() => void duplicate(p.id)}>
                    <i className="ph ph-copy" />
                  </button>
                  <button className="ghost icon" title="Rename" onClick={() => setRenamingId(p.id)}>
                    <i className="ph ph-pencil-simple" />
                  </button>
                  <button
                    className="ghost icon"
                    title="Delete"
                    style={{ color: 'var(--danger)' }}
                    disabled={projects.length <= 1}
                    onClick={() => void remove(p.id, p.name)}
                  >
                    <i className="ph ph-trash" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <footer>
          <button className="primary" onClick={onCreateNew}>
            <i className="ph ph-plus i" /> New project
          </button>
        </footer>
      </div>
    </div>
  )
}
