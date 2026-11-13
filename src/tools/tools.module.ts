/**
 * tools — module.
 * Split out of tools.ts by the module-structure refactor.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { ProjectDatabase } from '../db/index.ts'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getRun, listRuns, startRun } from '../runner/index.ts'
import type { SubagentService } from './tools.interface.ts'

/** Resolve a project root from the registry. */
function projectRootFor(registryHome: string, projectId: string): string | undefined {
  // The registry lives in the host half; this tool reads the same file so both
  // halves agree on which projects exist.
  const path = join(registryHome, 'projects', 'registry.json')
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      projects?: Array<{ id: string; root: string }>
    }
    return parsed.projects?.find((entry) => entry.id === projectId)?.root
  } catch {
    return undefined
  }
}
/**
 * Register the pipeline tools.
 * @param ctx - host context.
 * @param home - the Harness home, for locating the project registry.
 */
export function registerTools(ctx: Context, home: string): void {
  ctx.tools.register(
    defineTool({
      name: 'project_run',
      description:
        'Start a project feature through its team workflow. Each stage runs as a subagent and its verdict decides whether the pipeline advances. Use project_status to watch progress.',
      parameters: {
        projectId: { type: 'string', required: true, description: 'Project id from the Project Manager panel.' },
        featureId: { type: 'string', required: true, description: 'Feature id to execute.' },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            started: { type: 'boolean' },
            reason: { type: 'string' },
            message: { type: 'string' },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [
          { type: 'text', text: value.started ? `Pipeline started: ${value.message ?? ''}` : `Not started: ${value.reason ?? 'unknown reason'}` },
        ],
      },
      async execute(args, exec) {
        const root = projectRootFor(home, args.projectId)
        if (root === undefined) {
          return { started: false, reason: `no project ${args.projectId} in the registry` }
        }
        const subagents = ctx.get('subagents') as SubagentService | undefined
        if (subagents === undefined) {
          return { started: false, reason: 'the subagent service is not loaded in this profile' }
        }

        const db = ProjectDatabase.forProject(root)
        try {
          const feature = db.listFeatures().find((candidate) => candidate.id === args.featureId)
          if (feature === undefined) return { started: false, reason: `no feature ${args.featureId}` }

          const team = db.teamForFeature(args.featureId)
          if (team === undefined) {
            return {
              started: false,
              reason: 'this feature has no team, so it has no workflow. Assign a team first.',
            }
          }
          const workflows = db.listWorkflows(team.id)
          const workflow = workflows.find((candidate) => candidate.isDefault) ?? workflows[0]
          if (workflow === undefined) {
            return { started: false, reason: 'the assigned team has no workflow defined' }
          }

          const result = startRun({
            db,
            featureId: args.featureId,
            workflowId: workflow.id,
            provider: 'spawn',
            // The calling agent is the parent: this is why a tool works and a
            // browser click cannot.
            parent: exec.agent,
            subagents,
            signal: exec.signal,
          })
          return {
            started: result.started,
            ...(result.reason === undefined ? {} : { reason: result.reason }),
            ...(result.state === undefined ? {} : { message: result.state.message }),
          }
        } finally {
          db.close()
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'project_status',
      description:
        'Report pipeline progress for a feature: which stage is running, its verdicts, and the subagent sessions involved.',
      parameters: {
        featureId: { type: 'string', description: 'Feature id; omit for every run.' },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            runs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  featureId: { type: 'string' },
                  status: { type: 'string' },
                  currentStage: { type: 'string' },
                  message: { type: 'string' },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              (value.runs ?? []).length === 0
                ? 'No pipeline runs yet.'
                : (value.runs ?? [])
                    .map((run) => `${run.featureId}: ${run.status} — ${run.message}`)
                    .join('\n'),
          },
        ],
      },
      async execute(args) {
        const all = args.featureId === undefined ? listRuns() : [getRun(args.featureId)].filter(
          (run): run is NonNullable<typeof run> => run !== undefined,
        )
        return {
          runs: all.map((run) => ({
            featureId: run.featureId,
            status: run.status,
            currentStage: run.currentStageId ?? '',
            message: run.message,
          })),
        }
      },
    }),
  )
}