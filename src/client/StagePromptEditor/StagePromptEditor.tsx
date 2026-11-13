/**
 * StagePromptEditor — component.
 * Split out of client/StagePromptEditor.tsx by the module-structure refactor.
 */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { listStageDefinitions, type StageDefinition } from '../profile-api/index.ts'
import { inputStyle as input, labelStyle as label, hintStyle as hint } from '../styles/index.ts'
import type { StagePromptEditorProps } from './StagePromptEditor.interface.ts'

/**
 * Render the editor for one stage.
 * @param props - the stage being edited and the save callback.
 */
export function StagePromptEditor({ projectId, stage, onSave }: StagePromptEditorProps) {
  const [definitions, setDefinitions] = useState<StageDefinition[]>([])
  const [prompt, setPrompt] = useState(stage.prompt)
  const [deliverable, setDeliverable] = useState(stage.deliverable)
  const [notes, setNotes] = useState(stage.notes)
  const [name, setName] = useState(stage.name)
  const [provider, setProvider] = useState(stage.provider)
  const [model, setModel] = useState(stage.model)
  const [reasoning, setReasoning] = useState(stage.reasoning)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const payload = await listStageDefinitions(projectId)
        setDefinitions(payload.stages)
      } catch {
        setDefinitions([])
      }
    })()
  }, [projectId])

  // Re-seed when a different stage is selected.
  useEffect(() => {
    setPrompt(stage.prompt)
    setDeliverable(stage.deliverable)
    setNotes(stage.notes)
    setName(stage.name)
    setProvider(stage.provider)
    setModel(stage.model)
    setReasoning(stage.reasoning)
  }, [stage.id, stage.prompt, stage.deliverable, stage.notes, stage.name, stage.provider, stage.model, stage.reasoning])

  const builtin = definitions.find((entry) => entry.kind === stage.kind)
  const overridden = prompt.trim().length > 0

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await onSave({ prompt, deliverable, notes, name, provider, model, reasoning })
    } finally {
      setBusy(false)
    }
  }

  const resetToDefault = async (): Promise<void> => {
    setPrompt('')
    setDeliverable('')
    setBusy(true)
    try {
      await onSave({ prompt: '', deliverable: '', notes, name, provider: '', model: '', reasoning: '' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--dsw-alias-border-l4, #e5e7eb)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>
          {stage.name || stage.kind} — instruction
        </strong>
        <span style={hint}>
          {overridden ? 'customised' : 'using built-in'}
          {builtin === undefined ? '' : ` · default role: ${builtin.role}`}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <label htmlFor={`stage-name-${stage.id}`} style={label}>Display name</label>
          <input
            id={`stage-name-${stage.id}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={stage.kind}
            style={{ ...input, fontFamily: 'inherit' }}
          />
        </div>
        <div style={{ flex: 2 }}>
          <label htmlFor={`stage-deliverable-${stage.id}`} style={label}>Deliverable</label>
          <input
            id={`stage-deliverable-${stage.id}`}
            value={deliverable}
            onChange={(event) => setDeliverable(event.target.value)}
            placeholder={builtin?.deliverable ?? 'What this stage produces'}
            style={{ ...input, fontFamily: 'inherit' }}
          />
        </div>
      </div>

      <label htmlFor={`stage-prompt-${stage.id}`} style={label}>
        Instruction
      </label>
      <textarea
        id={`stage-prompt-${stage.id}`}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={builtin?.prompt ?? 'Leave empty to use the built-in instruction for this stage kind.'}
        rows={12}
        style={input}
      />
      <div style={hint}>
        Empty uses the built-in instruction. The shared rules (report a verdict, do not claim
        unverified completion) are appended automatically either way.
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <div style={{ flex: 1 }}>
          <label htmlFor={`stage-provider-${stage.id}`} style={label}>Provider</label>
          <input
            id={`stage-provider-${stage.id}`}
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            placeholder="inherit"
            style={{ ...input, fontFamily: 'inherit' }}
          />
        </div>
        <div style={{ flex: 2 }}>
          <label htmlFor={`stage-model-${stage.id}`} style={label}>Model</label>
          <input
            id={`stage-model-${stage.id}`}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="inherit"
            style={{ ...input, fontFamily: 'inherit' }}
          />
        </div>
        <div style={{ width: 120 }}>
          <label htmlFor={`stage-reasoning-${stage.id}`} style={label}>Reasoning</label>
          <select
            id={`stage-reasoning-${stage.id}`}
            value={reasoning}
            onChange={(event) => setReasoning(event.target.value)}
            style={{ ...input, fontFamily: 'inherit' }}
          >
            <option value="">inherit</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </div>
      </div>
      <div style={hint}>
        The subagent running this stage uses this route. Empty inherits the parent — cheaper
        models for mechanical stages, stronger ones where the reasoning matters.
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save stage'}
        </Button>
        {overridden ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void resetToDefault()}>
            Revert to built-in
          </Button>
        ) : null}
        {builtin === undefined ? null : (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setPrompt(builtin.prompt)
              setDeliverable(builtin.deliverable)
            }}
            title="Copy the built-in text into the editor so you can amend it"
          >
            Start from built-in
          </Button>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        <label htmlFor={`stage-notes-${stage.id}`} style={label}>Notes for this team</label>
        <input
          id={`stage-notes-${stage.id}`}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Shown on the node in the graph"
          style={{ ...input, fontFamily: 'inherit' }}
        />
      </div>
    </div>
  )
}