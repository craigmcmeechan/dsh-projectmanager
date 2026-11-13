/**
 * profile-api — module.
 * Split out of client/profile-api.ts by the module-structure refactor.
 */
import type { Technology, Convention, FeatureSpec, ProjectProfile, Team, TeamMember, WorkflowStage, Workflow, StageDefinition } from './profile-api.interface.ts'

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
/** Load defaults, technologies, conventions, and rendered documentation. */
export function getProfile(projectId: string): Promise<ProjectProfile> {
  return call<ProjectProfile>(`/api/projects/${encodeURIComponent(projectId)}/profile`)
}
/** Save any part of the profile. */
export function saveProfile(
  projectId: string,
  patch: {
    defaults?: Record<string, string>
    technologies?: Array<Omit<Technology, 'id'>>
    conventions?: Array<Omit<Convention, 'id'>>
  },
): Promise<unknown> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/profile`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}
/** Read one feature's specification and attached team. */
export function getFeatureSpec(
  projectId: string,
  featureId: string,
): Promise<{ spec: FeatureSpec; team: { id: string; name: string; purpose: string } | null }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureId)}/spec`)
}
/** Save a feature's specification. */
export function saveFeatureSpec(
  projectId: string,
  featureId: string,
  spec: Partial<FeatureSpec>,
): Promise<unknown> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureId)}/spec`, {
    method: 'PUT',
    body: JSON.stringify(spec),
  })
}
/** List every team. */
export function listTeams(projectId: string): Promise<{ teams: Team[] }> {
  return call<{ teams: Team[] }>(`/api/projects/${encodeURIComponent(projectId)}/teams`)
}
/** Create a team, optionally with its members in one request. */
export function createTeam(
  projectId: string,
  input: { name: string; purpose?: string; members?: Array<Omit<TeamMember, 'id'>> },
): Promise<{ teamId: string }> {
  return call<{ teamId: string }>(`/api/projects/${encodeURIComponent(projectId)}/teams`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
/** Members of one team. */
export function listTeamMembers(projectId: string, teamId: string): Promise<{ members: TeamMember[] }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/teams/${encodeURIComponent(teamId)}`)
}
/** Add a member to a team. */
export function addTeamMember(
  projectId: string,
  teamId: string,
  input: { role: string; name: string; responsibility?: string },
): Promise<{ memberId: string }> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/teams/${encodeURIComponent(teamId)}/members`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
/** Assign a team to a feature. */
export function assignTeam(
  projectId: string,
  featureId: string,
  teamId: string,
): Promise<unknown> {
  return call(`/api/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureId)}/team`, {
    method: 'POST',
    body: JSON.stringify({ teamId }),
  })
}
/** Workflows owned by one team. */
export function listWorkflows(projectId: string, teamId: string): Promise<{ workflows: Workflow[] }> {
  return call<{ workflows: Workflow[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(teamId)}`,
  )
}
/** Create a workflow from a tier's default stage set. */
export function createWorkflow(
  projectId: string,
  teamId: string,
  input: { name: string; tier: string; purpose?: string; concurrency?: number },
): Promise<{ workflowId: string }> {
  return call<{ workflowId: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(teamId)}`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}
/** Stages of one workflow. */
export function getWorkflowStages(
  projectId: string,
  teamId: string,
  workflowId: string,
): Promise<{ stages: WorkflowStage[] }> {
  return call<{ stages: WorkflowStage[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(teamId)}/${encodeURIComponent(workflowId)}`,
  )
}
/** Replace a workflow's stages. */
export function setWorkflowStages(
  projectId: string,
  teamId: string,
  workflowId: string,
  stages: Array<Omit<WorkflowStage, 'id' | 'position'>>,
): Promise<unknown> {
  return call(
    `/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(teamId)}/${encodeURIComponent(workflowId)}`,
    { method: 'PUT', body: JSON.stringify({ stages }) },
  )
}
/** Capabilities held by a team member. */
export function getCapabilities(
  projectId: string,
  memberId: string,
): Promise<{ capabilities: string[] }> {
  return call<{ capabilities: string[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberId)}/capabilities`,
  )
}
/** Replace a team member's capabilities. */
export function setCapabilities(
  projectId: string,
  memberId: string,
  capabilities: string[],
): Promise<unknown> {
  return call(
    `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberId)}/capabilities`,
    { method: 'PUT', body: JSON.stringify({ capabilities }) },
  )
}
/** Every stage kind with its role, deliverable, and exit criteria. */
export function listStageDefinitions(projectId: string): Promise<{ stages: StageDefinition[] }> {
  return call<{ stages: StageDefinition[] }>(`/api/projects/${encodeURIComponent(projectId)}/stages`)
}
/** The full instruction a given stage would give its agent for a feature. */
export function getStageInstruction(
  projectId: string,
  featureId: string,
  kind: string,
): Promise<{ instruction: string }> {
  return call<{ instruction: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(featureId)}/${encodeURIComponent(kind)}`,
  )
}