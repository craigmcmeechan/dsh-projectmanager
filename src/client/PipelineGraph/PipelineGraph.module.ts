/**
 * PipelineGraph — module.
 * Split out of client/PipelineGraph.tsx by the module-structure refactor.
 */
import type { NodeState } from './PipelineGraph.types.ts'

export const STATE_COLORS: Record<NodeState, { fill: string; stroke: string; text: string }> = {
  pending: { fill: 'var(--dsw-alias-bg-layer-3, #fff)', stroke: 'var(--dsw-alias-border-l4, #d0d5dd)', text: 'inherit' },
  active: { fill: '#eff6ff', stroke: '#2563eb', text: '#1d4ed8' },
  done: { fill: '#f0fdf4', stroke: '#16a34a', text: '#15803d' },
  failed: { fill: '#fef2f2', stroke: '#dc2626', text: '#b42318' },
  skipped: { fill: '#f8fafc', stroke: '#cbd5e1', text: '#64748b' },
}
/** Geometry for one node. */
export const NODE_W = 132
export const NODE_H = 52
export const GAP_X = 44
export const MARGIN = 12