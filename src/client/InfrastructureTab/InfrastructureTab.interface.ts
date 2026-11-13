/**
 * InfrastructureTab — interface.
 * Split out of client/InfrastructureTab.tsx by the module-structure refactor.
 */
/** Props for {@link InfrastructureTab}. */
export interface InfrastructureTabProps {
  projectId: string
  /** Notify the parent so the documentation view refreshes. */
  onChanged: () => void
}