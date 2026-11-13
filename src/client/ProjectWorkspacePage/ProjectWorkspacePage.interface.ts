/**
 * Interfaces for a project's main panel.
 */
import type { SidebarRow } from '../ProjectSidebarRows/index.ts'

/** Props for the panel. */
export interface ProjectWorkspacePageProps {
  /** The project or template this panel belongs to. */
  row: SidebarRow
}
