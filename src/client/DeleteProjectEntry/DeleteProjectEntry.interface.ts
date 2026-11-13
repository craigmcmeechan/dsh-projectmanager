/**
 * Interfaces for the delete-project menu row.
 */

/** One panel the row can act on. */
export interface PanelChoice {
  id: string
  label: string
  active?: boolean
}

/**
 * Props the More menu supplies to every row it renders.
 *
 * `entries` is the panel list and `onDismiss` closes the menu; both come from
 * the slot owner, not from this registration's inject factory.
 */
export interface DeleteProjectOwnerProps {
  /** Panels currently listed in the menu. */
  entries: readonly PanelChoice[]
  /** Close the menu. */
  onDismiss: () => void
}

/** Props this registration injects on top of the owner share. */
export interface DeleteProjectInjected {
  /** Delete the project behind a panel id. */
  onDelete: (panelId: string, label: string) => void
}

/** The component's full props. */
export type DeleteProjectEntryProps = DeleteProjectOwnerProps & DeleteProjectInjected
