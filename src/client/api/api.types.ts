/**
 * api — types.
 * Split out of client/api.ts by the module-structure refactor.
 */
/** One kanban column value. */
export type Column = 'backlog' | 'ready' | 'doing' | 'review' | 'done' | 'blocked'