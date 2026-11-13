/**
 * PipelineGraph — interface.
 * Split out of client/PipelineGraph.tsx by the module-structure refactor.
 */
import type { WorkflowStage } from '../profile-api/index.ts'
import type { NodeState } from './PipelineGraph.types.ts'

/** Props for {@link PipelineGraph}. */
export interface PipelineGraphProps {
  stages: WorkflowStage[]
  /** Per-stage state, keyed by stage id. Absent means `pending`. */
  states?: Record<string, NodeState>
  /** Called when a node is clicked. */
  onSelect?: (stageId: string) => void
  /** Stage currently selected, highlighted with a ring. */
  selectedId?: string
}