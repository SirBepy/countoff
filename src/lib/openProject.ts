import { audio } from './audio'
import { readContent, readMeta, readMyRole, type Role } from './collab'
import { loadAudio, loadProjectById, migrateProject, saveProjectRecord, setActiveProjectId } from './db'
import { getCurrentUser } from './firebase'
import { fetchSong } from './songFile'
import { cancelPendingSave, flash, getState, replaceProject, set } from './store'
import { attachTakes } from './takes'
import type { Project } from './types'

/** Hands the transport the song for a project, from this device if it has ever had the file
 *  and from the project's own upload otherwise. That second path is what makes a project
 *  somebody shared with you playable at all: they picked the file, you never did. */
export async function attachAudio(project: Project): Promise<boolean> {
  let blob = await loadAudio(project.id)
  let remote: string | null = null
  if (!blob && getCurrentUser()) {
    const meta = await readMeta(project.id).catch(() => null)
    remote = meta?.audioUrl ?? null
    if (remote) blob = (await fetchSong(project.id, remote)) ?? undefined
  }
  // Streaming the upload straight into the media element needs no CORS grant, only the
  // download token in the URL, so a bucket without one still plays. What is lost is the
  // offline copy and the decoded buffer the waveform and the tempo detector read.
  const source = blob ? URL.createObjectURL(blob) : remote
  if (!source) return false
  const previous = getState().audioUrl
  audio.load(source, project.name)
  set({ audioUrl: source }, false)
  if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous)
  return true
}

/**
 * Opens a project by id, wherever it lives: this device, or a collaborator's copy this
 * device has never seen. Order from the spec: kill the debounced save, swap the document,
 * only then load its audio, or the old project's pending write lands on top of the one
 * just opened.
 */
export async function openProjectById(id: string): Promise<boolean> {
  let target = await loadProjectById(id)
  let role: Role | null = null
  if (getCurrentUser()) role = await readMyRole(id).catch(() => null)

  if (!target) {
    const remote = await readContent(id).catch(() => null)
    if (!remote) return false
    target = migrateProject(remote)
    await saveProjectRecord(target)
  }

  cancelPendingSave()
  setActiveProjectId(id)
  replaceProject(
    target,
    {
      selection: null,
      view: target.blocks.length === 0 ? 'setup' : 'sheet',
      role,
      readOnly: role === 'viewer',
      shareView: false,
    },
    false,
  )
  if (!(await attachAudio(target))) flash('No song on this device for that one yet. Pick the file from Backups.')
  void attachTakes(target)
  return true
}
