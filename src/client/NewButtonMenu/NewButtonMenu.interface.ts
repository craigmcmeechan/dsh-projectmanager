/**
 * Interfaces for the split New button.
 */

/** One action in the dropdown. */
export interface MenuAction {
  id: string
  label: string
  hint?: string
  run: () => void
}

/** Props for the split button. */
export interface NewButtonMenuProps {
  /** Actions shown when the caret is pressed. */
  actions: MenuAction[]
  /** Whether the primary half is disabled. */
  disabled?: boolean
}
