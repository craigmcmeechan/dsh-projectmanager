/**
 * PipelineGraph — types.
 * Split out of client/PipelineGraph.tsx by the module-structure refactor.
 */
/** Status a stage can show in the graph. */
export type NodeState = 'pending' | 'active' | 'done' | 'failed' | 'skipped'