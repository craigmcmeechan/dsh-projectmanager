/**
 * NewProjectWizard — interface.
 * Split out of client/NewProjectWizard.tsx by the module-structure refactor.
 */
import { type DirectoryPickerApi } from '../DirectoryPicker/index.ts'

/** Props for {@link NewProjectWizard}. */
export interface NewProjectWizardProps {
  open: boolean
  onClose: () => void
  onCreated?: (projectId: string) => void
  /** Directory-picking surface, supplied by the wizard host. */
  picker?: DirectoryPickerApi | undefined
}