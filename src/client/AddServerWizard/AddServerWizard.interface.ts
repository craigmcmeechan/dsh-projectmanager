/**
 * Interfaces for the Add Remote Server wizard.
 */
import type { DockerImage } from '../store-api/index.ts'

/** Props for the wizard. */
export interface AddServerWizardProps {
  /** Catalogue images to offer for pulling. */
  images: DockerImage[]
  /** Called when the wizard finishes, so the parent can refresh. */
  onDone: () => void
  /** Called when the operator cancels. */
  onCancel: () => void
}
