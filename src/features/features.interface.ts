/**
 * features — interface.
 * Split out of features.ts by the module-structure refactor.
 */
/** Where a feature's worktree and database live. */
export interface FeatureWorkspace {
  /** Worktree checkout path. */
  path: string
  /** Branch checked out there. */
  branch: string
  /** The feature's own database file. */
  dbPath: string
}
/** Counts reported by a merge. */
export interface MergeReport {
  featureId: string
  itemsAdded: number
  eventsAdded: number
  /** Columns the merged items landed in, for the UI to summarise. */
  byColumn: Record<string, number>
}