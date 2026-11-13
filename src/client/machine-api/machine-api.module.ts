/**
 * machine-api — module.
 * Split out of client/machine-api.ts by the module-structure refactor.
 */
import type { MachineSettingsView, NodeState, DockerState, RemoteHostView, HostFacts } from './machine-api.interface.ts'

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
/** Read masked machine settings. */
export function getMachineSettings(projectId: string): Promise<{ settings: MachineSettingsView }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/settings`)
}
/**
 * Save machine settings.
 *
 * An omitted or empty token keeps the stored value, so re-saving the form does
 * not erase a credential the UI only shows as a mask.
 */
export function saveMachineSettings(
  projectId: string,
  patch: {
    cloudflare?: { accountId?: string; zone?: string; token?: string }
    github?: { owner?: string; token?: string }
  },
): Promise<{ settings: MachineSettingsView }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/settings`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}
/** Probe node and nvm. */
export function getNodeState(projectId: string): Promise<{ node: NodeState }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/machine/node`)
}
/** List installable node versions through nvm. */
export function getRemoteNodeVersions(
  projectId: string,
): Promise<{ remote: { versions: string[]; reason?: string } }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/machine/node/remote`)
}
/** Install one node version. */
export function installNodeVersion(
  projectId: string,
  version: string,
): Promise<{ result: { ok: boolean; detail: string } }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/machine/node/install`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  })
}
/** Install nvm itself. */
export function installNvm(projectId: string): Promise<{ result: { ok: boolean; detail: string } }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/machine/nvm/install`, {
    method: 'POST',
  })
}
/** Probe Docker and list images. */
export function getDockerState(projectId: string): Promise<{ docker: DockerState }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/machine/docker`)
}
/** Install Docker. */
export function installDocker(projectId: string): Promise<{ result: { ok: boolean; detail: string } }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/machine/docker/install`, {
    method: 'POST',
  })
}
/** Import teams and agents from a JSON document. */
export function importDefinitions(
  projectId: string,
  json: string,
): Promise<{ imported: { teams: number; agents: number } }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/import`, {
    method: 'POST',
    body: JSON.stringify({ json }),
  })
}
/** Registered remote hosts. */
export function listHosts(projectId: string): Promise<{ hosts: RemoteHostView[] }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/hosts`)
}
/** Add or update a remote host. */
export function saveHost(
  projectId: string,
  input: { id?: string; label?: string; host: string; user: string; port?: number; keyPath?: string },
): Promise<{ host: RemoteHostView }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/hosts`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
/** Remove a remote host. */
export function deleteHost(projectId: string, id: string): Promise<{ removed: boolean }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/hosts`, {
    method: 'DELETE',
    body: JSON.stringify({ id }),
  })
}
/** Probe one host for Node and Docker before using it. */
export function probeHost(
  projectId: string,
  input: { host: string; user: string; port?: number },
): Promise<{ node: NodeState; docker: DockerState; target: string }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/hosts/probe`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
/** Probe the project's own target host for everything. */
export function getHostFacts(projectId: string): Promise<HostFacts> {
  return call<HostFacts>(`/api/projects/${encodeURIComponent(projectId)}/machine`)
}
/** Install git on the project's target host. */
export function installGit(projectId: string): Promise<{ result: { ok: boolean; detail: string } }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/machine/git/install`, { method: 'POST' })
}
/** Probe a named remote host for everything. */
export function probeHostFacts(
  projectId: string,
  input: { host: string; user: string; port?: number },
): Promise<HostFacts> {
  return call<HostFacts>(`/api/projects/${encodeURIComponent(projectId)}/hosts/probe`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}