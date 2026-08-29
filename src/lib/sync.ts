import type { Project } from './types'

const KEY_TOKEN = 'countoff.sync.token'
const KEY_REPO = 'countoff.sync.repo'
const KEY_DEVICE = 'countoff.sync.deviceId'
const KEY_LAST_SYNC = 'countoff.sync.lastSyncedAt'
const KEY_CLIP_HASHES = 'countoff.sync.clipHashes'
export const DEFAULT_REPO = 'SirBepy/countoff-data'
const API_VERSION = '2022-11-28'

export interface SyncConfig {
  token: string
  repo: string
  deviceId: string
}

export function getConfig(): SyncConfig | null {
  const token = localStorage.getItem(KEY_TOKEN)
  if (!token) return null
  const repo = localStorage.getItem(KEY_REPO) || DEFAULT_REPO
  let deviceId = localStorage.getItem(KEY_DEVICE)
  if (!deviceId) {
    deviceId = crypto.randomUUID()
    localStorage.setItem(KEY_DEVICE, deviceId)
  }
  return { token, repo, deviceId }
}

export function setConfig(token: string, repo: string = DEFAULT_REPO) {
  localStorage.setItem(KEY_TOKEN, token)
  localStorage.setItem(KEY_REPO, repo)
  if (!localStorage.getItem(KEY_DEVICE)) localStorage.setItem(KEY_DEVICE, crypto.randomUUID())
}

export function clearConfig() {
  localStorage.removeItem(KEY_TOKEN)
  localStorage.removeItem(KEY_REPO)
  localStorage.removeItem(KEY_LAST_SYNC)
}

export const isConfigured = () => !!localStorage.getItem(KEY_TOKEN)

export function getLastSyncedAt(): number | null {
  const raw = localStorage.getItem(KEY_LAST_SYNC)
  return raw ? Number(raw) : null
}

export function setLastSyncedAt(at: number) {
  localStorage.setItem(KEY_LAST_SYNC, String(at))
}

/** Thrown when a PUT's sha no longer matches HEAD: something else pushed since our last read. */
export class SyncConflictError extends Error {
  constructor() {
    super('sync conflict')
    this.name = 'SyncConflictError'
  }
}

// btoa/atob only handle Latin1. Clips and non-ASCII project names need real byte-level base64.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64.replace(/\s/g, ''))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const utf8ToBase64 = (s: string) => bytesToBase64(new TextEncoder().encode(s))
const base64ToUtf8 = (b: string) => new TextDecoder().decode(base64ToBytes(b))

async function api(config: Pick<SyncConfig, 'token' | 'repo'>, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.github.com/repos/${config.repo}/contents/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      ...(init.headers ?? {}),
    },
  })
}

export type ConnectionResult =
  | { ok: true }
  | { ok: false; reason: 'bad-token' | 'no-access' | 'not-found' | 'network'; message: string }

export async function testConnection(config: Pick<SyncConfig, 'token' | 'repo'>): Promise<ConnectionResult> {
  let repoRes: Response
  try {
    repoRes = await fetch(`https://api.github.com/repos/${config.repo}`, {
      headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION },
    })
  } catch {
    return { ok: false, reason: 'network', message: 'Could not reach GitHub.' }
  }
  if (repoRes.status === 401) return { ok: false, reason: 'bad-token', message: 'Token is invalid or expired.' }
  if (repoRes.status === 404) return { ok: false, reason: 'not-found', message: `Repo ${config.repo} not found, or the token is not scoped to it.` }
  if (!repoRes.ok) return { ok: false, reason: 'network', message: `GitHub returned ${repoRes.status}.` }

  // The metadata check above only proves the token can see the repo, not that it can read its Contents.
  try {
    const contentsRes = await api(config, '')
    if (contentsRes.status === 403) return { ok: false, reason: 'no-access', message: 'Token lacks Contents permission on this repo.' }
  } catch {
    return { ok: false, reason: 'network', message: 'Could not reach GitHub.' }
  }
  return { ok: true }
}

/** Legacy single-project layout, retired 2026-08-29 in favour of one file per project. */
export async function pullLegacyProject(config: SyncConfig): Promise<{ project: Project; sha: string } | null> {
  const res = await api(config, 'project.json')
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Pull failed (${res.status})`)
  const data = await res.json()
  return { project: JSON.parse(base64ToUtf8(data.content)) as Project, sha: data.sha as string }
}

export async function deleteLegacyProject(config: SyncConfig, sha: string): Promise<void> {
  const res = await api(config, 'project.json', {
    method: 'DELETE',
    body: JSON.stringify({ message: 'sync: migrate to per-project layout', sha }),
  })
  if (!res.ok) throw new Error(`Delete failed (${res.status})`)
}

export async function listRemoteProjects(config: SyncConfig): Promise<string[]> {
  const res = await api(config, 'projects')
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`List failed (${res.status})`)
  const entries = (await res.json()) as { name: string }[]
  return entries.filter((e) => e.name.endsWith('.json')).map((e) => e.name.slice(0, -'.json'.length))
}

export async function pullProjectById(config: SyncConfig, id: string): Promise<{ project: Project; sha: string } | null> {
  const res = await api(config, `projects/${encodeURIComponent(id)}.json`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Pull failed (${res.status})`)
  const data = await res.json()
  return { project: JSON.parse(base64ToUtf8(data.content)) as Project, sha: data.sha as string }
}

export async function pushProjectById(config: SyncConfig, project: Project, sha: string | null): Promise<string> {
  const body: Record<string, unknown> = {
    message: `sync: ${project.name || 'project'}`,
    content: utf8ToBase64(JSON.stringify(project)),
  }
  if (sha) body.sha = sha
  const res = await api(config, `projects/${encodeURIComponent(project.id)}.json`, { method: 'PUT', body: JSON.stringify(body) })
  if (res.status === 409 || res.status === 422) throw new SyncConflictError()
  if (!res.ok) throw new Error(`Push failed (${res.status})`)
  const data = await res.json()
  return data.content.sha as string
}

export async function listRemoteClips(config: SyncConfig, projectId: string): Promise<string[]> {
  const res = await api(config, `clips/${encodeURIComponent(projectId)}`)
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`List failed (${res.status})`)
  const entries = (await res.json()) as { name: string }[]
  return entries.filter((e) => e.name.endsWith('.webm')).map((e) => e.name.slice(0, -'.webm'.length))
}

export async function pullClip(config: SyncConfig, projectId: string, moveId: string): Promise<Blob | null> {
  const res = await api(config, `clips/${encodeURIComponent(projectId)}/${encodeURIComponent(moveId)}.webm`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Clip pull failed (${res.status})`)
  const data = await res.json()
  return new Blob([base64ToBytes(data.content)], { type: 'video/webm' })
}

export async function pushClip(config: SyncConfig, projectId: string, moveId: string, blob: Blob): Promise<void> {
  const path = `clips/${encodeURIComponent(projectId)}/${encodeURIComponent(moveId)}.webm`
  const existing = await api(config, path)
  const sha = existing.ok ? ((await existing.json()).sha as string) : undefined
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const body: Record<string, unknown> = { message: `sync: clip ${moveId}`, content: bytesToBase64(bytes) }
  if (sha) body.sha = sha
  const res = await api(config, path, { method: 'PUT', body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Clip push failed (${res.status})`)
}

async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return bytesToBase64(new Uint8Array(digest))
}

function getClipHashes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY_CLIP_HASHES) ?? '{}')
  } catch {
    return {}
  }
}

// Keyed by projectId:moveId, not moveId alone: starter moves share ids across
// projects, and a hash recorded for one project's clip must not gate another's.
const clipHashKey = (projectId: string, moveId: string) => `${projectId}:${moveId}`

/** True (and remembers the hash) when a clip's content differs from what was last pushed. */
export async function clipChanged(projectId: string, moveId: string, blob: Blob): Promise<boolean> {
  const hash = await hashBlob(blob)
  return getClipHashes()[clipHashKey(projectId, moveId)] !== hash
}

export async function markClipPushed(projectId: string, moveId: string, blob: Blob): Promise<void> {
  const map = getClipHashes()
  map[clipHashKey(projectId, moveId)] = await hashBlob(blob)
  localStorage.setItem(KEY_CLIP_HASHES, JSON.stringify(map))
}
