/**
 * tools — interface.
 * Split out of tools.ts by the module-structure refactor.
 */
import type {} from '@deepseek-ai/dsh-tools'

/** Minimal shape of the subagent service this plugin needs. */
export interface SubagentService {
  startActivation(spec: {
    provider: string
    label: string
    prompt: string
    parent: unknown
    signal: AbortSignal
    delivery: 'parent' | 'caller'
  }): Promise<{ childId: string; name: string; result: Promise<unknown>; dispose(): Promise<void> }>
}