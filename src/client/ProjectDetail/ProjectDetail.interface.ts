/**
 * ProjectDetail — interface.
 * Split out of client/ProjectDetail.tsx by the module-structure refactor.
 */
import type { Tab } from './ProjectDetail.types.ts'

/** Props for {@link ProjectDetail}. */
export interface ProjectDetailProps {
  projectId: string
  /** Return to the project list. */
  onBack: () => void
  /** Open on a specific tab, so the panel's rail can address one directly. */
  initialTab?: Tab
  /** Notify the parent that the project changed, so it can refresh its lists. */
  onChanged?: () => void
}