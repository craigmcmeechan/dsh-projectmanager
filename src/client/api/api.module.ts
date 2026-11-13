/**
 * api — module.
 * Split out of client/api.ts by the module-structure refactor.
 */
import type { ProjectConfig, ProjectEntry, DocumentHeader, Feature, WorkItem, Progress } from './api.interface.ts'
import type { Column } from './api.types.ts'

/** Error carrying the host's machine-readable code. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  })
  const text = await response.text()
  let payload: { ok?: boolean; error?: { code?: string; message?: string } } & T
  try {
    payload = (text.length > 0 ? JSON.parse(text) : {}) as typeof payload
  } catch {
    throw new ApiError('bad-response', `unreadable response (${response.status})`)
  }
  if (!response.ok || payload.ok === false) {
    throw new ApiError(payload.error?.code ?? `http-${response.status}`, payload.error?.message ?? response.statusText)
  }
  return payload
}
/** List registered projects. */
export function listProjects(): Promise<{ projects: ProjectEntry[] }> {
  return call<{ projects: ProjectEntry[] }>('/api/projects')
}
/** Create a project. */
export function createProject(input: {
  name: string
  description: string
  mode: 'local' | 'remote'
  directory?: string
  remote?: { host: string; user: string; port?: number; path?: string }
  /** Per-provider credential overrides; omit to inherit this machine's. */
  cloudflare?: Record<string, string>
  github?: Record<string, string>
}): Promise<{ project: ProjectEntry & ProjectConfig }> {
  return call<{ project: ProjectEntry & ProjectConfig }>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
/** One project's full snapshot. */
export function getProject(id: string): Promise<{
  config: ProjectConfig
  documents: DocumentHeader[]
  features: Feature[]
  items: WorkItem[]
  progress: Progress
  events: Array<{ id: number; entity: string; entityId: string; action: string; createdAt: number }>
}> {
  return call(`/api/projects/${encodeURIComponent(id)}`)
}
/** Create a work item. */
export function createItem(
  projectId: string,
  input: { title: string; body?: string; status?: Column; featureId?: string },
): Promise<{ item: WorkItem }> {
  return call<{ item: WorkItem }>(`/api/projects/${encodeURIComponent(projectId)}/items`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
/** Move a card to a column and index. */
export function moveItem(
  projectId: string,
  itemId: string,
  status: Column,
  index: number,
): Promise<{ items: WorkItem[] }> {
  return call<{ items: WorkItem[] }>(`/api/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, index }),
  })
}
/** Create a feature, which also creates its worktree. */
export function createFeature(
  projectId: string,
  input: { title: string; base?: string },
): Promise<{ feature: Feature; warning?: string }> {
  return call<{ feature: Feature; warning?: string }>(`/api/projects/${encodeURIComponent(projectId)}/features`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
/** Merge a feature database into the project. */
export function mergeFeature(
  projectId: string,
  featureId: string,
): Promise<{ report: { itemsAdded: number; eventsAdded: number } }> {
  return call<{ report: { itemsAdded: number; eventsAdded: number } }>(
    `/api/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureId)}/merge`,
    { method: 'POST' },
  )
}
/** Save a document revision. */
export function reviseDocument(
  projectId: string,
  documentId: string,
  body: string,
  summary: string,
): Promise<{ revision: number }> {
  return call<{ revision: number }>(
    `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}`,
    { method: 'PUT', body: JSON.stringify({ body, summary }) },
  )
}
/** Read a document with its current body. */
export function getDocument(
  projectId: string,
  documentId: string,
): Promise<{ document: DocumentHeader & { body: string }; revisions: Array<{ revision: number; summary: string; createdAt: number }> }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}`)
}