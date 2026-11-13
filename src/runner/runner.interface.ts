/**
 * runner — interface.
 * Split out of runner.ts by the module-structure refactor.
 */
import type { ProjectDatabase } from '../db/index.ts'

/** What a run is doing right now. */
export interface RunState {
  featureId: string
  workflowId: string
  /** running | paused | done | failed | waiting-human */
  status: 'running' | 'paused' | 'done' | 'failed' | 'waiting-human'
  /** Stage id currently executing, if any. */
  currentStageId?: string | undefined
  /** One line about what happened last. */
  message: string
  startedAt: number
  updatedAt: number
}
/** Per-stage outcome recorded after a stage settles. */
export interface StageOutcome {
  stageId: string
  /** done | failed | skipped */
  status: 'done' | 'failed' | 'skipped'
  /** The verdict line the agent produced, verbatim. */
  verdict: string
  /** The agent's full output, truncated for storage. */
  output: string
  /** Child session id, so the UI can link to the subagent. */
  childId?: string
  startedAt: number
  finishedAt: number
}
/** The minimal subagent surface this runner needs. */
export interface SubagentLike {
  startActivation(spec: {
    provider: string
    label: string
    name?: string
    prompt: string
    parent: unknown
    signal: AbortSignal
    delivery: 'parent' | 'caller'
    /** Per-child model route; omitted inherits the parent's choice. */
    agentOptions?: { provider?: string; model?: string; reasoningEffort?: string; maxTokens?: number }
  }): Promise<{
    childId: string
    name: string
    result: Promise<{ result?: { text?: string } } | unknown>
    dispose(): Promise<void>
  }>
}
/** Options for {@link startRun}. */
export interface StartRunOptions {
  db: ProjectDatabase
  featureId: string
  workflowId: string
  /** Provider name registered with the subagent service, e.g. `spawn`. */
  provider: string
  /**
   * The parent Agent. Required by the subagent service; a run started from a
   * browser click has none, in which case this returns a refusal.
   */
  parent: unknown
  subagents: SubagentLike
  /** Abort the whole run. */
  signal: AbortSignal
}