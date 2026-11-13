/**
 * Interfaces for the function editor.
 */
import type { ImageFunction } from '../store-api/index.ts'

/** Props for the function editor. */
export interface FunctionEditorProps {
  /** The function being edited, or undefined when creating one. */
  existing?: ImageFunction | undefined
  /** Save the function. */
  onSave: (input: { name: string; description: string; dnsTemplate: string; port: string }) => Promise<void>
  /** Abandon editing. */
  onCancel: () => void
  /** Whether a save is in flight. */
  busy: boolean
  /** An error to show, from the parent. */
  error?: string | undefined
}
