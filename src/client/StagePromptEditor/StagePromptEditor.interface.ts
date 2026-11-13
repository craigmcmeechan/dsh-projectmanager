/**
 * StagePromptEditor — interface.
 * Split out of client/StagePromptEditor.tsx by the module-structure refactor.
 */
import { type WorkflowStage } from '../profile-api/index.ts'

/** Props for {@link StagePromptEditor}. */
export interface StagePromptEditorProps {
  projectId: string
  stage: WorkflowStage
  /** Save the edited fields back to the workflow. */
  onSave: (patch: {
    prompt: string
    deliverable: string
    notes: string
    name: string
    provider: string
    model: string
    reasoning: string
  }) => Promise<void>
}