/**
 * The New Project Template wizard.
 *
 * Two steps, because the second depends on the first:
 *
 *   1. **Name and description** — free text, nothing checked yet.
 *   2. **Folder** — the name slugified into a folder name, whether that folder
 *      is free, and the create action.
 *
 * Splitting it this way means the operator sees the folder the wizard actually
 * intends to create, and gets availability checked *before* committing, rather
 * than after a failed create.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { inputStyle, labelStyle, errorStyle } from '../styles/index.ts'
import { checkTemplateFolder } from '../store-api/index.ts'
import { fieldBlock, folderPreviewStyle } from './NewTemplateWizard.styles.ts'
import type { NewTemplateWizardProps, TemplateStep } from './NewTemplateWizard.interface.ts'

/** Slugify a template title exactly as the host does. */
export function slugifyTemplateName(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/**
 * Render the wizard.
 * @param props - open state and the create handler.
 */
export function NewTemplateWizard({ open, onClose, onCreate }: NewTemplateWizardProps) {
  const [step, setStep] = useState<TemplateStep>(1)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  /** Result of the availability check for the current slug. */
  const [check, setCheck] = useState<
    { slug: string; path: string; available: boolean; reason?: string } | undefined
  >(undefined)
  const [checking, setChecking] = useState(false)

  const slug = slugifyTemplateName(name)

  // Reset whenever it opens, so a cancelled run leaves no half-filled form.
  useEffect(() => {
    if (!open) return
    setStep(1)
    setName('')
    setDescription('')
    setBusy(false)
    setError(undefined)
    setCheck(undefined)
  }, [open])

  /** Ask the host whether this slug is free; used on entering step 2. */
  const runCheck = useCallback(async (): Promise<void> => {
    setChecking(true)
    setError(undefined)
    try {
      setCheck(await checkTemplateFolder(name))
    } catch (failure) {
      setCheck(undefined)
      setError(failure instanceof Error ? failure.message : 'could not check that folder')
    } finally {
      setChecking(false)
    }
  }, [name])

  // Check automatically once the folder step is showing, so the operator does
  // not have to press a button to learn the answer.
  useEffect(() => {
    if (open && step === 2) void runCheck()
  }, [open, step, runCheck])

  const step1Blocker = name.trim().length === 0 ? 'A template name is required.' : undefined
  const step2Blocker =
    check === undefined
      ? 'Checking the folder…'
      : check.available
        ? undefined
        : (check.reason ?? 'that folder is not available')

  const submit = async (): Promise<void> => {
    if (step2Blocker !== undefined || busy) return
    setBusy(true)
    setError(undefined)
    try {
      await onCreate({
        name: name.trim(),
        description: description.trim(),
        detailsPath: 'project-details',
      })
      onClose()
    } catch (failure) {
      setBusy(false)
      setError(failure instanceof Error ? failure.message : 'could not create the template')
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose()
      }}
      title={`New project template — ${step === 1 ? 'Details' : 'Folder'} (${step}/2)`}
      closeLabel="Close"
      footer={
        <>
          <Button
            variant="outline"
            onClick={step === 1 ? onClose : () => setStep(1)}
            disabled={busy}
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>
          {step === 1 ? (
            <Button
              variant="primary"
              onClick={() => setStep(2)}
              disabled={step1Blocker !== undefined}
            >
              Next
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void submit()}
              disabled={busy || step2Blocker !== undefined}
            >
              {busy ? 'Creating…' : 'Create template'}
            </Button>
          )}
        </>
      }
    >
      {step === 1 ? (
        <>
          <div style={fieldBlock}>
            <label htmlFor="tpl-wizard-name" style={labelStyle}>
              Template name
            </label>
            <input
              id="tpl-wizard-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Turbo + pnpm Monorepo"
              style={inputStyle}
              maxLength={80}
              data-modal-autofocus
              disabled={busy}
            />
          </div>

          <div style={fieldBlock}>
            <label htmlFor="tpl-wizard-desc" style={labelStyle}>
              Description <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span>
            </label>
            <textarea
              id="tpl-wizard-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Turbo + pnpm monorepo with a standard layout"
              rows={3}
              style={inputStyle}
              maxLength={2000}
              disabled={busy}
            />
          </div>

          {slug.length === 0 ? null : (
            <p style={{ fontSize: 11, opacity: 0.6, marginTop: 0 }}>
              Will be created as <code>{slug}</code>.
            </p>
          )}
        </>
      ) : (
        <>
          <div style={fieldBlock}>
            <label style={labelStyle}>Folder</label>
            <div style={folderPreviewStyle}>
              {checking
                ? 'Checking…'
                : check === undefined
                  ? '—'
                  : `${check.path === '' ? slug : check.path}`}
            </div>
            {slug !== name.trim().toLowerCase() && slug.length > 0 ? (
              <p style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
                Slugified from <strong>{name.trim()}</strong> — punctuation and spaces become
                single dashes.
              </p>
            ) : null}

            {check === undefined || checking ? null : check.available ? (
              <p style={{ fontSize: 12, marginTop: 6, color: 'var(--dsw-alias-state-success-primary, #15803d)' }}>
                ✓ This folder is free and will be created.
              </p>
            ) : (
              <p style={{ fontSize: 12, marginTop: 6, color: 'var(--dsw-alias-state-error-primary, #b42318)' }}>
                ✕ {check.reason}
              </p>
            )}
          </div>

          <p style={{ fontSize: 11, opacity: 0.7, margin: '0 0 10px' }}>
            The template is created as a git repository with an initial commit, containing{' '}
            <code>project-details/project.setup.json</code>, an <code>AGENTS.md</code>, and a README.
            The <code>project-details</code> folder name is fixed.
          </p>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" size="sm" onClick={() => void runCheck()} disabled={busy || checking}>
              Check again
            </Button>
          </div>
        </>
      )}

      {error === undefined ? null : (
        <p role="alert" style={{ ...errorStyle, marginTop: 6 }}>
          {error}
        </p>
      )}
    </Modal>
  )
}
