/**
 * Interfaces for the store manager.
 */
import type { DirectoryPickerApi } from '../DirectoryPicker/index.ts'

/** Props for the store manager screen. */
export interface StoreManagerProps {
  /** Return to the panel. */
  onBack: () => void
  /**
   * Directory picker, when the composition has one.
   *
   * Used by the Settings tab to choose the template folder; the field falls
   * back to a typed path when absent.
   */
  picker?: DirectoryPickerApi | undefined
}
