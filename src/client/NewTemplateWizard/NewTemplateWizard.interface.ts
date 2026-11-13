/**
 * Interfaces for the New Template wizard.
 */
export type { TemplateStep } from './NewTemplateWizard.types.ts'

/** Props for the wizard. */
export interface NewTemplateWizardProps {
  /** Whether the dialog is showing. */
  open: boolean
  /** Close without creating anything. */
  onClose: () => void
  /**
   * Create the template workspace and start a session in it.
   *
   * Resolves to the created path so the caller can report it; throws on failure.
   */
  onCreate: (input: {
    name: string
    description: string
    detailsPath: string
  }) => Promise<string>
}
