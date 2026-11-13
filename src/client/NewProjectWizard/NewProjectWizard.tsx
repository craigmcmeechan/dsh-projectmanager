/**
 * NewProjectWizard — component.
 * Split out of client/NewProjectWizard.tsx by the module-structure refactor.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { ApiError, createProject } from '../api/index.ts'
import { inputStyle, labelStyle, errorStyle } from '../styles/index.ts'
import { DirectoryPickerField } from '../DirectoryPicker/index.ts'
import { listCredentials } from '../store-api/index.ts'
import { STEPS } from './NewProjectWizard.module.ts'
import type { NewProjectWizardProps } from './NewProjectWizard.interface.ts'
import type { Mode } from './NewProjectWizard.types.ts'
import { fieldStyle } from './NewProjectWizard.styles.ts'

/**
 * Render the wizard.
 * @param props - dialog state and completion callback.
 */
export function NewProjectWizard({ open, onClose, onCreated, picker }: NewProjectWizardProps) {
  const [step, setStep] = useState(0)
  const [mode, setMode] = useState<Mode>('local')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [directory, setDirectory] = useState('')
  const [host, setHost] = useState('')
  const [user, setUser] = useState('')
  const [port, setPort] = useState('22')
  const [remotePath, setRemotePath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  /** Credentials this machine holds, shown as the inherited default. */
  const [machineCloudflare, setMachineCloudflare] = useState<Record<string, string>>({})
  const [machineGithub, setMachineGithub] = useState<Record<string, string>>({})
  const [machineHasCloudflare, setMachineHasCloudflare] = useState(false)
  const [machineHasGithub, setMachineHasGithub] = useState(false)
  /** Per-project overrides; empty means "inherit". */
  const [cfAccountId, setCfAccountId] = useState('')
  const [cfZone, setCfZone] = useState('')
  const [cfToken, setCfToken] = useState('')
  const [ghOwner, setGhOwner] = useState('')
  const [ghToken, setGhToken] = useState('')
  const [overrideCredentials, setOverrideCredentials] = useState(false)

  const reset = (): void => {
    setStep(0)
    setMode('local')
    setName('')
    setDescription('')
    setDirectory('')
    setHost('')
    setUser('')
    setPort('22')
    setRemotePath('')
    setBusy(false)
    setError(undefined)
    setCfAccountId('')
    setCfZone('')
    setCfToken('')
    setGhOwner('')
    setGhToken('')
    setOverrideCredentials(false)
  }

  const close = (): void => {
    if (busy) return
    reset()
    onClose()
  }

  // Load this machine's credentials once per open so the review step can show
  // what a project would inherit before the operator decides to override.
  useEffect(() => {
    if (!open) return
    let live = true
    void listCredentials()
      .then((body) => {
        if (!live) return
        const cf = body.credentials.find((entry) => entry.provider === 'cloudflare')
        const gh = body.credentials.find((entry) => entry.provider === 'github')
        setMachineCloudflare(cf?.fields ?? {})
        setMachineGithub(gh?.fields ?? {})
        setMachineHasCloudflare(cf !== undefined && (cf.secrets['token']?.set === true || Object.keys(cf.fields).length > 0))
        setMachineHasGithub(gh !== undefined && (gh.secrets['token']?.set === true || Object.keys(gh.fields).length > 0))
      })
      .catch(() => {
        // Credentials are optional; a failure must not block project creation.
      })
    return () => {
      live = false
    }
  }, [open])

  /** Why the current step cannot advance, or undefined when it can. */
  const blocker = useMemo(() => {
    if (step === 1) {
      if (name.trim().length === 0) return 'A project name is required.'
      // Mirrors validateProjectName on the host: spaces are allowed in the
      // display name; the slug derived from it is what must be path-safe.
      if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(name.trim())) {
        return 'Start with a letter or digit; use letters, digits, spaces, dots, hyphens, and underscores.'
      }
    }
    if (step === 2) {
      if (mode === 'local' && directory.trim().length === 0) return 'Choose a parent directory.'
      if (mode === 'remote') {
        if (host.trim().length === 0) return 'A host or IP address is required.'
        if (user.trim().length === 0) return 'An SSH user is required.'
      }
    }
    return undefined
  }, [step, name, mode, directory, host, user])

  const next = (): void => {
    if (blocker !== undefined) {
      setError(blocker)
      return
    }
    setError(undefined)
    setStep((current) => Math.min(current + 1, STEPS.length - 1))
  }

  const back = (): void => {
    setError(undefined)
    setStep((current) => Math.max(current - 1, 0))
  }

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault()
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      // Overrides are sent only when the operator turned them on and supplied a
      // value, so an untouched project keeps inheriting the machine's.
      const overrideCloudflare: Record<string, string> = {}
      const overrideGithub: Record<string, string> = {}
      if (overrideCredentials) {
        if (cfAccountId.trim().length > 0) overrideCloudflare['accountId'] = cfAccountId.trim()
        if (cfZone.trim().length > 0) overrideCloudflare['zone'] = cfZone.trim()
        if (cfToken.trim().length > 0) overrideCloudflare['token'] = cfToken.trim()
        if (ghOwner.trim().length > 0) overrideGithub['owner'] = ghOwner.trim()
        if (ghToken.trim().length > 0) overrideGithub['token'] = ghToken.trim()
      }
      const { project } = await createProject({
        name: name.trim(),
        description: description.trim(),
        mode,
        ...(Object.keys(overrideCloudflare).length === 0 ? {} : { cloudflare: overrideCloudflare }),
        ...(Object.keys(overrideGithub).length === 0 ? {} : { github: overrideGithub }),
        ...(mode === 'local'
          ? { directory: directory.trim() }
          : {
              remote: {
                host: host.trim(),
                user: user.trim(),
                port: Number(port) || 22,
                path: remotePath.trim(),
              },
            }),
      })
      reset()
      onCreated?.(project.id)
      onClose()
    } catch (failure) {
      setBusy(false)
      setError(
        failure instanceof ApiError
          ? failure.code === 'duplicate-name'
            ? `A project named "${name.trim()}" already exists.`
            : failure.message
          : 'Could not create the project.',
      )
    }
  }

  const stepBody = (): React.ReactNode => {
    if (step === 0) {
      return (
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ ...labelStyle, marginBottom: 8 }}>Where will this project live?</legend>
          {(
            [
              ['local', 'Local', 'Develop in a directory on this machine.'],
              ['remote', 'Remote', 'Develop on another machine over SSH.'],
            ] as const
          ).map(([value, title, hint]) => (
            <label
              key={value}
              style={{
                display: 'block',
                padding: '10px 12px',
                marginBottom: 8,
                border: `1px solid ${mode === value ? 'var(--dsw-alias-interactive-bg-active, #2563eb)' : 'var(--dsw-alias-border-l4, #d0d5dd)'}`,
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                style={{ marginRight: 8 }}
              />
              <strong>{title}</strong>
              <div style={{ marginLeft: 24, fontSize: 13, opacity: 0.7 }}>{hint}</div>
            </label>
          ))}
        </fieldset>
      )
    }

    if (step === 1) {
      return (
        <>
          <div style={fieldStyle}>
            <label htmlFor="wizard-name" style={labelStyle}>
              Project name
            </label>
            <input
              id="wizard-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="client-portal"
              style={inputStyle}
              maxLength={80}
              data-modal-autofocus
              disabled={busy}
            />
          </div>
          <div style={fieldStyle}>
            <label htmlFor="wizard-description" style={labelStyle}>
              Description <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span>
            </label>
            <textarea
              id="wizard-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this project covers"
              rows={3}
              style={inputStyle}
              maxLength={2000}
              disabled={busy}
            />
          </div>
        </>
      )
    }

    if (step === 2 && mode === 'local') {
      return (
        <div style={fieldStyle}>
          <DirectoryPickerField
            label="Parent directory"
            value={directory}
            onChange={setDirectory}
            picker={picker}
            placeholder="/home/you/projects"
          />
        </div>
      )
    }

    if (step === 2) {
      return (
        <>
          <div style={fieldStyle}>
            <label htmlFor="wizard-host" style={labelStyle}>
              Host or IP address
            </label>
            <input
              id="wizard-host"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="203.0.113.10"
              style={inputStyle}
              data-modal-autofocus
              disabled={busy}
            />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ ...fieldStyle, flex: 2 }}>
              <label htmlFor="wizard-user" style={labelStyle}>
                SSH user
              </label>
              <input
                id="wizard-user"
                value={user}
                onChange={(event) => setUser(event.target.value)}
                placeholder="deploy"
                style={inputStyle}
                disabled={busy}
              />
            </div>
            <div style={{ ...fieldStyle, flex: 1 }}>
              <label htmlFor="wizard-port" style={labelStyle}>
                Port
              </label>
              <input
                id="wizard-port"
                value={port}
                onChange={(event) => setPort(event.target.value)}
                inputMode="numeric"
                style={inputStyle}
                disabled={busy}
              />
            </div>
          </div>
          <div style={fieldStyle}>
            <label htmlFor="wizard-path" style={labelStyle}>
              Remote directory <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span>
            </label>
            <input
              id="wizard-path"
              value={remotePath}
              onChange={(event) => setRemotePath(event.target.value)}
              placeholder="/srv/projects/client-portal"
              style={inputStyle}
              disabled={busy}
            />
          </div>
        </>
      )
    }

    return (
      <>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', margin: 0, fontSize: 14 }}>
        <dt style={{ opacity: 0.7 }}>Name</dt>
        <dd style={{ margin: 0 }}>{name.trim()}</dd>
        <dt style={{ opacity: 0.7 }}>Description</dt>
        <dd style={{ margin: 0 }}>{description.trim() || '—'}</dd>
        <dt style={{ opacity: 0.7 }}>Mode</dt>
        <dd style={{ margin: 0 }}>{mode === 'local' ? 'Local' : 'Remote'}</dd>
        {mode === 'local' ? (
          <>
            <dt style={{ opacity: 0.7 }}>Parent</dt>
            <dd style={{ margin: 0 }}>{directory.trim()}</dd>
          </>
        ) : (
          <>
            <dt style={{ opacity: 0.7 }}>Host</dt>
            <dd style={{ margin: 0 }}>
              {user.trim()}@{host.trim()}:{port}
            </dd>
            <dt style={{ opacity: 0.7 }}>Directory</dt>
            <dd style={{ margin: 0 }}>{remotePath.trim() || '—'}</dd>
          </>
        )}
      </dl>
      {/* Credentials: what this project inherits, and how to override it. */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 13 }}>Credentials</h3>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={overrideCredentials}
              onChange={(event) => setOverrideCredentials(event.target.checked)}
              disabled={busy}
            />
            Use this project&rsquo;s own
          </label>
        </div>

        {!overrideCredentials ? (
          <p style={{ fontSize: 12, opacity: 0.7, margin: '6px 0 0' }}>
            {machineHasCloudflare || machineHasGithub ? (
              <>
                Inherits this machine&rsquo;s credentials:{' '}
                {machineHasCloudflare
                  ? `Cloudflare${machineCloudflare['zone'] === undefined ? '' : ` (${machineCloudflare['zone']})`}`
                  : 'no Cloudflare set'}
                {', '}
                {machineHasGithub ? `GitHub (${machineGithub['owner'] ?? 'owner unset'})` : 'no Git set'}.
              </>
            ) : (
              <>No machine credentials are stored. Add them in Stores &rarr; Credentials, or set this
                project&rsquo;s own below.</>
            )}
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <div>
              <label style={{ fontSize: 11, opacity: 0.7 }} htmlFor="wizard-cf-account">
                Cloudflare account id
              </label>
              <input
                id="wizard-cf-account"
                value={cfAccountId}
                onChange={(event) => setCfAccountId(event.target.value)}
                placeholder={machineCloudflare['accountId'] ?? 'falls back to the machine value'}
                style={inputStyle}
                disabled={busy}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, opacity: 0.7 }} htmlFor="wizard-cf-zone">
                Cloudflare zone
              </label>
              <input
                id="wizard-cf-zone"
                value={cfZone}
                onChange={(event) => setCfZone(event.target.value)}
                placeholder={machineCloudflare['zone'] ?? 'example.com'}
                style={inputStyle}
                disabled={busy}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, opacity: 0.7 }} htmlFor="wizard-cf-token">
                Cloudflare API token
              </label>
              <input
                id="wizard-cf-token"
                type="password"
                value={cfToken}
                onChange={(event) => setCfToken(event.target.value)}
                placeholder="leave empty to inherit"
                autoComplete="off"
                style={inputStyle}
                disabled={busy}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, opacity: 0.7 }} htmlFor="wizard-gh-owner">
                Git owner
              </label>
              <input
                id="wizard-gh-owner"
                value={ghOwner}
                onChange={(event) => setGhOwner(event.target.value)}
                placeholder={machineGithub['owner'] ?? 'your-org'}
                style={inputStyle}
                disabled={busy}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, opacity: 0.7 }} htmlFor="wizard-gh-token">
                Git personal access token
              </label>
              <input
                id="wizard-gh-token"
                type="password"
                value={ghToken}
                onChange={(event) => setGhToken(event.target.value)}
                placeholder="leave empty to inherit"
                autoComplete="off"
                style={inputStyle}
                disabled={busy}
              />
            </div>
            <p style={{ fontSize: 11, opacity: 0.7, margin: 0 }}>
              A field left empty keeps the machine value.
            </p>
          </div>
        )}
      </div>

      </>
    )
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={`New project — ${STEPS[step]} (${step + 1}/${STEPS.length})`}
      closeLabel="Close"
      footer={
        <>
          <Button variant="outline" onClick={step === 0 ? close : back} disabled={busy}>
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={next} disabled={busy}>
              Next
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void submit()} disabled={busy}>
              {busy ? 'Creating…' : 'Create project'}
            </Button>
          )}
        </>
      }
    >
      <form onSubmit={submit}>
        {stepBody()}
        {error === undefined ? null : (
          <p role="alert" style={{ ...errorStyle, marginTop: 10 }}>
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}