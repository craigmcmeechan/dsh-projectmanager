/**
 * ManageTeams — interface.
 * Split out of client/ManageTeams.tsx by the module-structure refactor.
 */
/** Props for {@link ManageTeams}. */
export interface ManageTeamsProps {
  projectId: string
  /** Return to the project list. */
  onBack: () => void
}