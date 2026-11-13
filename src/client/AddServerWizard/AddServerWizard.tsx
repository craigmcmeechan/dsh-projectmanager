/**
 * The Add Remote Server wizard.
 *
 * Five screens, matching the order the operator reasons in:
 *
 *   1. **Identity and credentials** — name (must be distinct), address, and how
 *      to authenticate. A password is used once and immediately replaced by a
 *      generated key, with password login disabled; the operator is told this
 *      before anything is changed on their server.
 *   2. **Probe** — OS, RAM, and whether node/nvm/git/docker are present, plus
 *      pending OS updates.
 *   3. **DNS** — pick a Cloudflare zone, create the record, set the hostname.
 *   4. **Docker and images** — install Docker if absent, then pull a selection
 *      from the catalogue.
 *   5. **Workspace folder** — the default directory new workspaces start in.
 *
 * Every step is skippable. A half-finished server is a valid state: the store
 * records what was done, and the remaining steps can be re-entered later, which
 * matters because DNS and Docker installs can fail for reasons outside the
 * operator's control.
 */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  StoreError,
  createDns,
  createServer,
  installOnServer,
  listZones,
  probeServer,
  pullImages,
  secureServer,
  serverUpdates,
  setWorkdir,
} from '../store-api/index.ts'
import type { DnsZone, RemoteServer, ServerFacts } from '../store-api/index.ts'
import { inputStyle, labelStyle } from '../styles/index.ts'
import { factRow, screenStyle, stepBadge } from './AddServerWizard.styles.ts'
import type { AuthChoice, WizardStep } from './AddServerWizard.types.ts'
import type { AddServerWizardProps } from './AddServerWizard.interface.ts'

/**
 * Render the wizard.
 * @param props - catalogue and completion callbacks.
 */
export function AddServerWizard({ images, onDone, onCancel }: AddServerWizardProps) {
  const [step, setStep] = useState<WizardStep>(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [note, setNote] = useState<string | undefined>(undefined)

  // Screen 1.
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [user, setUser] = useState('root')
  const [port, setPort] = useState('22')
  const [auth, setAuth] = useState<AuthChoice>('password')
  const [password, setPassword] = useState('')
  const [server, setServer] = useState<RemoteServer | undefined>(undefined)

  // Screen 2.
  const [facts, setFacts] = useState<ServerFacts | undefined>(undefined)
  const [updateCount, setUpdateCount] = useState<number | undefined>(undefined)

  // Screen 3.
  const [zones, setZones] = useState<DnsZone[] | undefined>(undefined)
  const [zone, setZone] = useState('')
  const [fqdn, setFqdn] = useState<string | undefined>(undefined)

  // Screen 4.
  const [selectedImages, setSelectedImages] = useState<string[]>([])
  const [dockerReady, setDockerReady] = useState(false)

  // Screen 5.
  const [workdir, setWorkdirInput] = useState('/home/workspaces')

  /** Run one step with shared error handling. */
  const run = async (what: () => Promise<string | undefined>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    setNote(undefined)
    try {
      const message = await what()
      if (message !== undefined) setNote(message)
    } catch (failure) {
      setError(failure instanceof StoreError ? failure.message : 'that step failed')
    } finally {
      setBusy(false)
    }
  }

  const createAndSecure = (): Promise<void> =>
    run(async () => {
      const created = await createServer({
        name: name.trim(),
        host: host.trim(),
        user: user.trim(),
        port: Number(port) || 22,
      })
      setServer(created.server)
      const secured = await secureServer(created.server.id, { password })
      setServer(secured.server)
      setFacts(secured.facts)
      // The password is no longer needed; dropping it keeps it out of the
      // component state for the rest of the run.
      setPassword('')
      setStep(2)
      return secured.passwordDisabled
        ? 'key installed and password login disabled'
        : `key installed, but password login is still on: ${secured.detail}`
    })

  const checkUpdates = (): Promise<void> =>
    run(async () => {
      if (server === undefined) return undefined
      const checked = await serverUpdates(server.id)
      setUpdateCount(checked.count ?? 0)
      return `${checked.count ?? 0} update(s) pending${checked.manager === undefined ? '' : ` (${checked.manager})`}`
    })

  const applyUpdates = (): Promise<void> =>
    run(async () => {
      if (server === undefined) return undefined
      const applied = await serverUpdates(server.id, true)
      setUpdateCount(0)
      return applied.detail ?? 'updates applied'
    })

  const install = (what: 'node' | 'nvm' | 'git' | 'docker'): Promise<void> =>
    run(async () => {
      if (server === undefined) return undefined
      const installed = await installOnServer(server.id, what)
      if (what === 'docker' && installed.ok) setDockerReady(true)
      // Re-probe so the screen reflects reality rather than the assumption.
      const probed = await probeServer(server.id)
      setFacts(probed.facts)
      return installed.detail
    })

  const loadZones = (): Promise<void> =>
    run(async () => {
      if (server === undefined) return undefined
      const listed = await listZones(server.id)
      setZones(listed.zones)
      return listed.error ?? `${listed.zones.length} zone(s) available`
    })

  const writeDns = (): Promise<void> =>
    run(async () => {
      if (server === undefined) return undefined
      const created = await createDns(server.id, zone)
      setFqdn(created.fqdn)
      setServer(created.server)
      return created.hostnameOk
        ? `${created.fqdn ?? 'record'} created and hostname set`
        : `${created.fqdn ?? 'record'} created; ${created.hostnameDetail}`
    })

  const pull = (): Promise<void> =>
    run(async () => {
      if (server === undefined) return undefined
      if (selectedImages.length === 0) return 'no images selected'
      const pulled = await pullImages(server.id, selectedImages)
      const failed = pulled.results.filter((entry) => !entry.ok).length
      return failed === 0
        ? `pulled ${pulled.results.length} image(s)`
        : `${pulled.results.length - failed} pulled, ${failed} failed`
    })

  const saveWorkdir = (): Promise<void> =>
    run(async () => {
      if (server === undefined) return undefined
      const saved = await setWorkdir(server.id, workdir.trim())
      return saved.detail
    })

  const dockerMissing = facts?.docker === undefined || facts.docker.present !== true

  return (
    <div style={screenStyle}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, opacity: 0.6 }}>Project Manager \ Store manager \ Add remote server</div>
          <h3 style={{ margin: 0, fontSize: 15 }}>
            <span style={stepBadge}>{step}</span>
            {step === 1
              ? 'Credentials'
              : step === 2
                ? 'Server check'
                : step === 3
                  ? 'DNS and hostname'
                  : step === 4
                    ? 'Docker and images'
                    : 'Workspace folder'}
          </h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </header>

      {error === undefined ? null : (
        <p role="alert" style={{ color: 'var(--dsw-alias-state-error-primary, #b42318)', fontSize: 13 }}>
          {error}
        </p>
      )}
      {note === undefined ? null : <p style={{ fontSize: 12, opacity: 0.75 }}>{note}</p>}

      {/* ------------------------------------------------------- screen 1 */}
      {step === 1 ? (
        <>
          <label style={labelStyle} htmlFor="server-name">
            Server name
          </label>
          <input
            id="server-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="build-01"
            style={inputStyle}
          />
          <p style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
            Must be distinct, and becomes this server's DNS hostname label.
          </p>

          <label style={{ ...labelStyle, marginTop: 10 }} htmlFor="server-host">
            IP address or hostname
          </label>
          <input
            id="server-host"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="203.0.113.10"
            style={inputStyle}
          />

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 2 }}>
              <label style={{ ...labelStyle, marginTop: 10 }} htmlFor="server-user">
                SSH user
              </label>
              <input
                id="server-user"
                value={user}
                onChange={(event) => setUser(event.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ ...labelStyle, marginTop: 10 }} htmlFor="server-port">
                Port
              </label>
              <input
                id="server-port"
                value={port}
                onChange={(event) => setPort(event.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          <fieldset style={{ border: 'none', padding: 0, marginTop: 12 }}>
            <legend style={labelStyle}>How are credentials supplied?</legend>
            {(
              [
                ['password', 'Username and password'],
                ['key', 'An SSH key I already have'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
                <input
                  type="radio"
                  name="auth"
                  checked={auth === value}
                  onChange={() => setAuth(value)}
                  style={{ marginRight: 6 }}
                />
                {label}
              </label>
            ))}
          </fieldset>

          {auth === 'password' ? (
            <>
              <label style={{ ...labelStyle, marginTop: 8 }} htmlFor="server-password">
                Password
              </label>
              <input
                id="server-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                style={inputStyle}
                autoComplete="off"
              />
              <div
                role="note"
                style={{
                  marginTop: 10,
                  padding: '8px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  background: 'var(--dsw-alias-bg-layer-3, #fffaeb)',
                  border: '0.5px solid var(--dsw-alias-border-l4, #fec84b)',
                }}
              >
                <strong>This changes your server.</strong> For security, the plugin will install its
                own SSH key and then disable password login. Your password is used once and is never
                stored.
              </div>
            </>
          ) : (
            <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
              The plugin will use your existing SSH agent or default key. No password change is made.
            </p>
          )}

          <div style={{ marginTop: 14 }}>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || name.trim().length === 0 || host.trim().length === 0}
              onClick={() => void createAndSecure()}
            >
              {busy ? 'Connecting…' : 'Connect and secure'}
            </Button>
          </div>
        </>
      ) : null}

      {/* ------------------------------------------------------- screen 2 */}
      {step === 2 ? (
        <>
          {facts === undefined ? (
            <p style={{ fontSize: 13, opacity: 0.7 }}>No probe result.</p>
          ) : (
            <dl style={{ margin: 0, fontSize: 13 }}>
              <div style={factRow}>
                <dt>OS</dt>
                <dd>{facts.os ?? 'unknown'}</dd>
              </div>
              <div style={factRow}>
                <dt>Kernel / arch</dt>
                <dd>
                  {facts.kernel ?? '—'} / {facts.arch ?? '—'}
                </dd>
              </div>
              <div style={factRow}>
                <dt>RAM / CPU</dt>
                <dd>
                  {facts.ramMb === undefined ? '—' : `${(facts.ramMb / 1024).toFixed(1)} GB`} /{' '}
                  {facts.cpu ?? '—'} vCPU
                </dd>
              </div>
              {(
                [
                  ['node', facts.node],
                  ['nvm', facts.nvm],
                  ['git', facts.git],
                  ['docker', facts.docker],
                ] as const
              ).map(([label, value]) => (
                <div key={label} style={factRow}>
                  <dt>{label}</dt>
                  <dd>
                    {value?.present === true ? (
                      <span style={{ color: 'var(--dsw-alias-state-success-primary, #15803d)' }}>
                        {value.version ?? 'present'}
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: 'var(--dsw-alias-state-warning-primary, #b54708)' }}>missing</span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void install(label)}
                        >
                          Install
                        </Button>
                      </span>
                    )}
                  </dd>
                </div>
              ))}
              <div style={factRow}>
                <dt>OS updates</dt>
                <dd>
                  {updateCount === undefined ? (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void checkUpdates()}>
                      Check for updates
                    </Button>
                  ) : updateCount === 0 ? (
                    'up to date'
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {updateCount} pending
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => void applyUpdates()}>
                        Apply updates
                      </Button>
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Button variant="outline" size="sm" onClick={() => setStep(1)} disabled={busy}>
              Back
            </Button>
            <Button variant="primary" size="sm" onClick={() => setStep(3)} disabled={busy}>
              Next
            </Button>
          </div>
        </>
      ) : null}

      {/* ------------------------------------------------------- screen 3 */}
      {step === 3 ? (
        <>
          <p style={{ fontSize: 12, opacity: 0.7, marginTop: 0 }}>
            Pick the Cloudflare zone this server belongs to. The record is created from the server
            name, and the server's hostname is changed to match.
          </p>
          {zones === undefined ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void loadZones()}>
              {busy ? '…' : 'List zones'}
            </Button>
          ) : zones.length === 0 ? (
            <p style={{ fontSize: 13 }}>No zones available. Add a Cloudflare token in Development infrastructure.</p>
          ) : (
            <select
              value={zone}
              onChange={(event) => setZone(event.target.value)}
              style={{ ...inputStyle, color: 'var(--dsw-alias-label-primary, #1f2329)' }}
              aria-label="DNS zone"
            >
              <option value="">Choose a zone…</option>
              {zones.map((entry) => (
                <option key={entry.id} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          )}

          {zone.length > 0 ? (
            <p style={{ fontSize: 12, marginTop: 8 }}>
              Record: <code>{name}.{zone}</code>
            </p>
          ) : null}
          {fqdn === undefined ? null : (
            <p style={{ fontSize: 12, color: 'var(--dsw-alias-state-success-primary, #15803d)' }}>{fqdn} is live</p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <Button variant="outline" size="sm" onClick={() => setStep(2)} disabled={busy}>
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || zone.length === 0}
              onClick={() => void writeDns()}
            >
              {busy ? '…' : 'Create record and set hostname'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setStep(4)} disabled={busy}>
              Skip
            </Button>
          </div>
        </>
      ) : null}

      {/* ------------------------------------------------------- screen 4 */}
      {step === 4 ? (
        <>
          {dockerMissing && !dockerReady ? (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 13, marginTop: 0 }}>Docker is not installed on this server.</p>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void install('docker')}>
                {busy ? '…' : 'Install Docker'}
              </Button>
            </div>
          ) : (
            <p style={{ fontSize: 13, marginTop: 0 }}>Docker is available. Choose images to pull.</p>
          )}

          <div style={{ maxHeight: 220, overflowY: 'auto', border: '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)', borderRadius: 6 }}>
            {images.length === 0 ? (
              <p style={{ fontSize: 13, padding: 10, margin: 0 }}>
                The catalogue is empty. Add images in the Docker images tab first.
              </p>
            ) : (
              images.map((image) => (
                <label
                  key={image.id}
                  style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', fontSize: 13 }}
                >
                  <input
                    type="checkbox"
                    checked={selectedImages.includes(image.reference)}
                    onChange={(event) =>
                      setSelectedImages((current) =>
                        event.target.checked
                          ? [...current, image.reference]
                          : current.filter((entry) => entry !== image.reference),
                      )
                    }
                  />
                  <code style={{ fontSize: 12 }}>{image.reference}</code>
                </label>
              ))
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <Button variant="outline" size="sm" onClick={() => setStep(3)} disabled={busy}>
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || selectedImages.length === 0}
              onClick={() => void pull()}
            >
              {busy ? '…' : `Pull ${selectedImages.length} image(s)`}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setStep(5)} disabled={busy}>
              Skip
            </Button>
          </div>
        </>
      ) : null}

      {/* ------------------------------------------------------- screen 5 */}
      {step === 5 ? (
        <>
          <p style={{ fontSize: 12, opacity: 0.7, marginTop: 0 }}>
            Where new workspaces for this server should start. The folder is created if it does not
            exist.
          </p>
          <label style={labelStyle} htmlFor="server-workdir">
            Default workspace folder
          </label>
          <input
            id="server-workdir"
            value={workdir}
            onChange={(event) => setWorkdirInput(event.target.value)}
            placeholder="/home/workspaces"
            style={inputStyle}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Button variant="outline" size="sm" onClick={() => setStep(4)} disabled={busy}>
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || workdir.trim().length === 0}
              onClick={() =>
                void saveWorkdir().then(() => {
                  onDone()
                })
              }
            >
              {busy ? '…' : 'Finish'}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
