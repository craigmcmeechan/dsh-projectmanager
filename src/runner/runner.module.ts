/**
 * runner — module.
 * Split out of runner.ts by the module-structure refactor.
 */
import { stageInstruction } from '../stages/index.ts'
import type { RunState, StartRunOptions } from './runner.interface.ts'

/** Verdict patterns per stage kind. A match means the stage produced an opinion. */
const VERDICT_PATTERNS: Record<string, RegExp> = {
  requirement: /REQUIREMENT:\s*(ok|needs-clarification)/i,
  prd: /PRD:\s*(ok|blocked)/i,
  design: /DESIGN:\s*(ok|not-applicable)/i,
  architecture: /ARCHITECTURE:\s*(ok|blocked)/i,
  techspec: /TECHSPEC:\s*(ok|blocked)/i,
  development: /DEV:\s*(done|failed)/i,
  qa: /QA:\s*(pass|fail)/i,
  acceptance: /ACCEPTANCE:\s*(pass|conditional|fail|not-applicable)/i,
}
/** Stages whose failure should stop the pipeline. */
const BLOCKING = new Set(['requirement', 'prd', 'architecture', 'techspec', 'development', 'qa'])
/**
 * Extract the verdict line from an agent's output.
 * @param kind - stage kind, selecting the pattern.
 * @param text - the agent's full output.
 * @returns the matched line, or undefined when none is present.
 */
export function parseVerdict(kind: string, text: string): string | undefined {
  const pattern = VERDICT_PATTERNS[kind]
  if (pattern === undefined) return undefined
  for (const line of text.split('\n')) {
    const match = pattern.exec(line)
    if (match !== null) return line.trim()
  }
  return undefined
}
/** Whether a verdict counts as success for its stage. */
export function verdictSucceeded(verdict: string | undefined): boolean {
  if (verdict === undefined) return false
  // Anything explicitly negative fails; everything else that matched succeeded.
  return !/\b(blocked|failed|fail|needs-clarification)\b/i.test(verdict)
}
/** In-memory run table, mirrored to the database. */
const runs = new Map<string, RunState>()
/** Read the current run for a feature. */
export function getRun(featureId: string): RunState | undefined {
  return runs.get(featureId)
}
/** Every run, newest first. */
export function listRuns(): RunState[] {
  return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt)
}
/**
 * Execute one feature's workflow.
 *
 * Runs detached: the caller gets the initial state immediately and polls
 * {@link getRun} for progress.
 * @returns the initial run state, or a refusal when it cannot start.
 */
export function startRun(options: StartRunOptions): { started: boolean; reason?: string; state?: RunState } {
  const { db, featureId, workflowId, provider, parent, subagents, signal } = options

  if (parent === undefined || parent === null) {
    return {
      started: false,
      reason:
        'A pipeline run needs a parent agent to delegate from. Start the run from a session rather than a browser click.',
    }
  }

  const existing = runs.get(featureId)
  if (existing !== undefined && existing.status === 'running') {
    return { started: false, reason: 'this feature already has a running pipeline' }
  }

  const stages = db.listWorkflowStages(workflowId)
  if (stages.length === 0) {
    return { started: false, reason: 'the workflow has no stages' }
  }

  const feature = db.listFeatures().find((candidate) => candidate.id === featureId)
  if (feature === undefined) return { started: false, reason: `no feature ${featureId}` }
  const spec = db.getFeatureSpec(featureId)
  const team = db.teamForFeature(featureId)

  const state: RunState = {
    featureId,
    workflowId,
    status: 'running',
    message: `starting ${stages.length} stages`,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  }
  runs.set(featureId, state)

  // Detached: the caller polls. Errors are recorded on the run, not thrown at a
  // request that has already returned.
  void (async () => {
    let qaFailures = 0
    try {
      for (const stage of stages) {
        if (signal.aborted) {
          state.status = 'paused'
          state.message = 'cancelled'
          state.updatedAt = Date.now()
          return
        }

        state.currentStageId = stage.id
        state.message = `running ${stage.name || stage.kind}`
        state.updatedAt = Date.now()

        const instruction = stageInstruction(stage.kind, {
          featureTitle: feature.title,
          requirement: spec.requirements,
          acceptance: spec.acceptance,
          teamName: team?.name ?? 'unassigned',
          ...(stage.exitCriteria.length > 0 ? { exitCriteria: stage.exitCriteria } : {}),
          ...(stage.prompt.length > 0 ? { promptOverride: stage.prompt } : {}),
          ...(stage.deliverable.length > 0 ? { deliverableOverride: stage.deliverable } : {}),
        })

        let output = ''
        try {
          // A stage may pin its own model: mechanical stages on a cheap route,
          // architecture on a stronger one. An empty column inherits the parent.
          const agentOptions: {
            provider?: string
            model?: string
            reasoningEffort?: string
          } = {}
          if (stage.provider.trim().length > 0) agentOptions.provider = stage.provider.trim()
          if (stage.model.trim().length > 0) agentOptions.model = stage.model.trim()
          if (stage.reasoning.trim().length > 0) agentOptions.reasoningEffort = stage.reasoning.trim()

          const activation = await subagents.startActivation({
            provider,
            label: `${feature.title}/${stage.kind}`,
            prompt: instruction,
            parent,
            signal,
            delivery: 'caller',
            ...(Object.keys(agentOptions).length === 0 ? {} : { agentOptions }),
          })
          state.message = `${stage.kind}: ${activation.name} on ${stage.model || 'parent model'}`
          state.updatedAt = Date.now()
          state.message = `${stage.kind}: ${activation.name} running`
          state.updatedAt = Date.now()

          const settled = (await activation.result) as { result?: { text?: string } } | undefined
          output = settled?.result?.text ?? ''
        } catch (error) {
          output = `stage dispatch failed: ${error instanceof Error ? error.message : String(error)}`
        }

        const verdict = parseVerdict(stage.kind, output)
        const ok = verdictSucceeded(verdict)

        db.recordEvent('feature', featureId, 'stage', undefined, {
          stageId: stage.id,
          kind: stage.kind,
          verdict: verdict ?? null,
          ok,
        })

        if (!ok) {
          if (stage.kind === 'qa') {
            qaFailures += 1
            if (qaFailures < 2) {
              state.message = `QA rejected the delivery (round ${qaFailures}); retrying`
              state.updatedAt = Date.now()
              // Loop back to development once more, then stop.
              continue
            }
          }
          if (BLOCKING.has(stage.kind)) {
            state.status = 'failed'
            state.message = verdict ?? `${stage.kind} produced no verdict`
            state.updatedAt = Date.now()
            return
          }
        }

        state.message = verdict ?? `${stage.kind} finished without a verdict`
        state.updatedAt = Date.now()
      }

      state.status = 'done'
      state.message = 'all stages completed'
      state.currentStageId = undefined
      state.updatedAt = Date.now()
      db.recordEvent('feature', featureId, 'pipeline-done', undefined, {})
    } catch (error) {
      state.status = 'failed'
      state.message = error instanceof Error ? error.message : String(error)
      state.updatedAt = Date.now()
    }
  })()

  return { started: true, state }
}