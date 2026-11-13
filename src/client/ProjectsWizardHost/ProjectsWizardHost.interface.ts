/**
 * ProjectsWizardHost — interface.
 * Split out of client/ProjectsWizardHost.tsx by the module-structure refactor.
 */
import type { DirectoryPickerApi } from '../DirectoryPicker/index.ts'

/** Props for {@link ProjectsWizardHost}: the picker surface, injected. */
export interface ProjectsWizardHostProps {
  /** Directory-picking API, or undefined when the composition has none. */
  picker?: DirectoryPickerApi | undefined
}