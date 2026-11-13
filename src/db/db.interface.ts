/**
 * db — interface.
 * Split out of db.ts by the module-structure refactor.
 */
import type { Column, FeatureStatus } from './db.types.ts'

/** A project-level document with its current revision. */
export interface DocumentRecord {
  id: string
  kind: string
  slug: string
  title: string
  featureId: string | null
  revision: number
  body: string
  updatedAt: number
}
/** One kanban card. */
export interface WorkItem {
  id: string
  featureId: string | null
  title: string
  body: string
  status: Column
  position: number
  parentId: string | null
  createdAt: number
  updatedAt: number
  closedAt: number | null
}
/** One unit of work that gets a worktree. */
export interface Feature {
  id: string
  slug: string
  title: string
  status: FeatureStatus
  branch: string | null
  worktreePath: string | null
  baseCommit: string | null
  dbPath: string | null
  teamId: string | null
  createdAt: number
  updatedAt: number
  mergedAt: number | null
}
/** Derived progress for a project or feature. */
export interface Progress {
  total: number
  byColumn: Record<Column, number>
  /** 0..1, counting only `done` against every non-blocked item. */
  ratio: number
}