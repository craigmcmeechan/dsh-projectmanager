/**
 * db — types.
 * Split out of db.ts by the module-structure refactor.
 */
import { COLUMNS, FEATURE_STATUS } from './db.module.ts'

/** One kanban column. */
export type Column = (typeof COLUMNS)[number]
/** One feature state. */
export type FeatureStatus = (typeof FEATURE_STATUS)[number]