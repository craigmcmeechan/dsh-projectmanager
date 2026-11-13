/**
 * ProjectsEntry — interface.
 * Split out of client/ProjectsEntry.tsx by the module-structure refactor.
 */
/** Props the owner passes to every row in this menu. */
export interface ProjectsEntryProps {
  /** Closes the owning menu. */
  onDismiss: () => void
}