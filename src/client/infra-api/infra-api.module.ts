/**
 * infra-api — module.
 * Split out of client/infra-api.ts by the module-structure refactor.
 */
import type { InfraRequirement, DockerProbe } from './infra-api.interface.ts'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  })
  const text = await response.text()
  const payload = (text.length > 0 ? JSON.parse(text) : {}) as { ok?: boolean; error?: { message?: string } } & T
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error?.message ?? `request failed (${response.status})`)
  }
  return payload
}
/** Read Docker availability, options, and image presence. */
export function dockerProbe(projectId: string): Promise<DockerProbe> {
  return call<DockerProbe>(`/api/projects/${encodeURIComponent(projectId)}/docker`)
}
/** Recorded infrastructure requirements. */
export function listInfrastructure(
  projectId: string,
): Promise<{ requirements: InfraRequirement[] }> {
  return call<{ requirements: InfraRequirement[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/infrastructure`,
  )
}
/** Add one requirement. */
export function saveInfrastructure(
  projectId: string,
  input: { provider: string; settings?: Record<string, unknown>; necessity?: string },
): Promise<unknown> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/infrastructure`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}
/** Remove one requirement. */
export function removeInfrastructure(
  projectId: string,
  kind: string,
  provider: string,
): Promise<unknown> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/infrastructure`, {
    method: 'DELETE',
    body: JSON.stringify({ kind, provider }),
  })
}
/** Pull one offered image. Explicit, never automatic. */
export function pullImage(
  projectId: string,
  image: string,
): Promise<{ result: { image: string; ok: boolean; detail: string } }> {
  return call<{ result: { image: string; ok: boolean; detail: string } }>(
    `/api/projects/${encodeURIComponent(projectId)}/docker/pull`,
    { method: 'POST', body: JSON.stringify({ image }) },
  )
}