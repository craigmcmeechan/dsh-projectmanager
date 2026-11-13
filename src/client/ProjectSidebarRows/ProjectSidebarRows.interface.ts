/**
 * Interfaces for the per-project sidebar rows.
 */

/** One desired sidebar row: a project or a template. */
export interface SidebarRow {
  /** Stable panel id, also the `main` key. */
  id: string
  /** Display label shown in the sidebar. */
  label: string
  /** `project` or `template`, for anything that needs to tell them apart. */
  kind: 'project' | 'template'
  /** Absolute root the project or templatate lives at. */
  root: string
}
