/**
 * profile-api — interface.
 * Split out of client/profile-api.ts by the module-structure refactor.
 */
/**
 * Client access to the project profile and feature specification APIs.
 */

/** A technology the project uses. */
export interface Technology {
  id: string
  category: string
  name: string
  version: string
  rationale: string
}
/** A coding or process convention. */
export interface Convention {
  id: string
  category: string
  title: string
  body: string
}
/** A feature's specification. */
export interface FeatureSpec {
  requirements: string
  acceptance: string
  exclusions: string
}
/** The project profile as the host renders it. */
export interface ProjectProfile {
  defaults: Record<string, string>
  technologies: Technology[]
  conventions: Convention[]
  documentation: string
}
/** A team assembled to deliver features. */
export interface Team {
  id: string
  name: string
  purpose: string
  status: string
  memberCount: number
  createdAt: number
}
/** One member of a team. */
export interface TeamMember {
  id: string
  role: string
  name: string
  responsibility: string
}
/** A workflow stage. */
export interface WorkflowStage {
  id: string
  kind: string
  name: string
  position: number
  parallel: boolean
  role: string
  exitCriteria: string
  optional: boolean
  /** A workflow's own instruction; empty means the built-in applies. */
  prompt: string
  /** A workflow's own deliverable line. */
  deliverable: string
  /** Free-form note shown on the graph node. */
  notes: string
  /** Provider route for this stage's subagent; empty inherits the parent. */
  provider: string
  /** Model id for this stage's subagent; empty inherits the parent. */
  model: string
  /** low | medium | high; empty inherits. */
  reasoning: string
}
/** A workflow: the ordered stages a feature moves through. */
export interface Workflow {
  id: string
  name: string
  purpose: string
  tier: string
  concurrency: number
  isDefault: boolean
  stageCount: number
}
/** What a stage asks its agent to do. */
export interface StageDefinition {
  kind: string
  role: string
  deliverable: string
  exitCriteria: string
  /** The built-in instruction body, used to seed the editor. */
  prompt: string
}