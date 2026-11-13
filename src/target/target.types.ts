/**
 * target — types.
 * Split out of target.ts by the module-structure refactor.
 */
/** Where a project's infrastructure runs. */
export type Target =
  | { kind: 'local' }
  | { kind: 'remote'; host: string; user: string; port: number }