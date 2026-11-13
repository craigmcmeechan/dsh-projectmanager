/**
 * api — interface.
 * Split out of client/api.ts by the module-structure refactor.
 */
import type { Column } from './api.types.ts'

/**
 * Client access to the Projects API.
 *
 * The only place the browser talks to the host half. Requests use the page's own
 * fetch so the Harness session cookie and browser-trust fence apply normally.
 */

/** Where a project lives. */
export interface ProjectConfig {
  version: 1
  name: string
  description: string
  mode: 'local' | 'remote'
  root: string
  createdAt: number
  remote?: { host: string; user: string; port: number; path: string }
}
/** A registered project. */
export interface ProjectEntry {
  id: string
  name: string
  root: string
  createdAt: number
  /** Epoch ms of the last time the project snapshot was read. */
  lastAccessedAt?: number
  config?: ProjectConfig
}
/** A document header. */
export interface DocumentHeader {
  id: string
  kind: string
  slug: string
  title: string
  featureId: string | null
  revision: number
  updatedAt: number
}
/** A feature. */
export interface Feature {
  id: string
  slug: string
  title: string
  status: string
  branch: string | null
  worktreePath: string | null
  mergedAt: number | null
}
/** A kanban card. */
export interface WorkItem {
  id: string
  featureId: string | null
  title: string
  body: string
  status: Column
  position: number
}
/** Derived progress. */
export interface Progress {
  total: number
  byColumn: Record<Column, number>
  ratio: number
}