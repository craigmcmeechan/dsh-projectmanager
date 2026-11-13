/**
 * The plugin-wide store manager.
 *
 * A single screen with a section per store, reached from the right panel's
 * top-right menu. Kept as one component with tabs rather than three panels so
 * the operator can move between a catalogue entry and the server that pulls it
 * without losing their place.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  StoreError,
  addImage,
  createFunction,
  discoverImages,
  dockerStatus,
  importImages,
  listFunctions,
  listImages,
  listServers,
  listSettings,
  listTemplates,
  putSetting,
  removeFunction,
  removeImage,
  createTemplate,
  inspectTemplate,
  listCloudflareZones,
  listCredentials,
  removeServer,
  removeTemplate,
  resolveImages,
  saveCredential,
  testCloudflareToken,
  seedImages,
  setImageFunction,
  updateFunction,
} from '../store-api/index.ts'
import type {
  DnsZone,
  ProjectTemplate,
  DockerImage,
  DockerMachineStatus,
  MachineCredential,
  ImageFunction,
  RemoteServer,
  StoreSetting,
} from '../store-api/index.ts'
import { AddServerWizard } from '../AddServerWizard/index.ts'
import { FunctionEditor } from '../FunctionEditor/index.ts'
import { DirectoryPickerField } from '../DirectoryPicker/index.ts'
import { cell, headCell, panelStyle, sectionStyle, tabStyle } from './StoreManager.styles.ts'
import type { StoreTab } from './StoreManager.types.ts'
import type { StoreManagerProps } from './StoreManager.interface.ts'

/**
 * Render the store manager.
 * @param props - back callback.
 */
export function StoreManager({ onBack, picker }: StoreManagerProps) {
  const [tab, setTab] = useState<StoreTab>('images')
  const [images, setImages] = useState<DockerImage[] | undefined>(undefined)
  const [servers, setServers] = useState<RemoteServer[] | undefined>(undefined)
  const [settings, setSettings] = useState<StoreSetting[]>([])
  const [templateHome, setTemplateHome] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [newReference, setNewReference] = useState('')
  const [wizardOpen, setWizardOpen] = useState(false)
  const [credentials, setCredentials] = useState<MachineCredential[]>([])
  const [cfAccountId, setCfAccountId] = useState('')
  const [cfZone, setCfZone] = useState('')
  const [cfToken, setCfToken] = useState('')
  const [ghOwner, setGhOwner] = useState('')
  const [ghToken, setGhToken] = useState('')
  const [templates, setTemplates] = useState<ProjectTemplate[]>([])
  const [tplName, setTplName] = useState('')
  const [tplRepo, setTplRepo] = useState('')
  const [tplRef, setTplRef] = useState('')
  const [tplDetails, setTplDetails] = useState('project details')
  const [tplDescription, setTplDescription] = useState('')
  const [inspection, setInspection] = useState<
    { repo: string; found: boolean; files: string[]; setup?: Record<string, unknown>; warnings: string[]; error?: string } | undefined
  >(undefined)
  const [zones, setZones] = useState<DnsZone[] | undefined>(undefined)
  const [selectedZones, setSelectedZones] = useState<string[]>([])
  const [zoneNote, setZoneNote] = useState<string | undefined>(undefined)
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | undefined>(undefined)
  const [functions, setFunctions] = useState<ImageFunction[]>([])
  const [docker, setDocker] = useState<DockerMachineStatus | undefined>(undefined)
  const [importOpen, setImportOpen] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [importPreview, setImportPreview] = useState<
    Awaited<ReturnType<typeof importImages>> | undefined
  >(undefined)
  const [editingFunction, setEditingFunction] = useState<Partial<ImageFunction> | undefined>(undefined)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [imageBody, serverBody, settingBody, functionBody, credentialBody, templateBody] = await Promise.all([
        listImages(),
        listServers(),
        listSettings(),
        listFunctions(),
        listCredentials(),
        listTemplates(),
      ])
      setImages(imageBody.images)
      setServers(serverBody.servers)
      setSettings(settingBody.settings)
      setTemplateHome(settingBody.templateHome ?? '')
      setFunctions(functionBody.functions)
      setCredentials(credentialBody.credentials)
      setTemplates(templateBody.templates)
      // Prefill the non-secret fields so editing shows what is stored; secrets
      // stay blank because the host never sends them back.
      const cf = credentialBody.credentials.find((entry) => entry.provider === 'cloudflare')
      setCfAccountId(cf?.fields['accountId'] ?? '')
      setCfZone(cf?.fields['zone'] ?? '')
      setSelectedZones(
        (cf?.fields['zones'] ?? '')
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      )
      const gh = credentialBody.credentials.find((entry) => entry.provider === 'github')
      setGhOwner(gh?.fields['owner'] ?? '')
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof StoreError ? failure.message : 'could not load the stores')
    }
  }, [])

  /** Probe Docker on this machine, separately from the store contents. */
  const refreshDocker = useCallback(async (): Promise<void> => {
    try {
      setDocker(await dockerStatus())
    } catch {
      // A failed probe is a fact to report, not an error to throw: the screen
      // then says Docker is unavailable and offers the manual paths.
      setDocker({ available: false, imageCount: 0, images: [], reason: 'the probe failed' })
    }
  }, [])

  useEffect(() => {
    void refresh()
    void refreshDocker()
  }, [refresh, refreshDocker])

  /** Run one action with the shared busy/error handling. */
  const act = async (what: () => Promise<string | undefined>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    setNote(undefined)
    try {
      const message = await what()
      if (message !== undefined) setNote(message)
      await refresh()
    } catch (failure) {
      setError(failure instanceof StoreError ? failure.message : 'that did not work')
    } finally {
      setBusy(false)
    }
  }

  const discoverAndSeed = (): Promise<void> =>
    act(async () => {
      const discovered = await discoverImages()
      if (discovered.images.length === 0) {
        const why = discovered.reason ?? 'no images on this machine'
        return `${why}. Add images by hand below, then resolve their tags from Docker Hub.`
      }
      const seeded = await seedImages()
      return `found ${discovered.images.length} local image(s); ${seeded.seeded} added to the catalogue`
    })

  const resolveAll = (): Promise<void> =>
    act(async () => {
      const resolved = await resolveImages()
      const failed = (resolved.results ?? []).filter((entry) => entry.error !== undefined).length
      const total = resolved.results?.length ?? 0
      return failed === 0
        ? `checked ${total} image(s) against Docker Hub`
        : `checked ${total} image(s); ${failed} could not be resolved`
    })

  return (
    <div style={panelStyle}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, opacity: 0.6 }}>Project Manager \ Store manager</div>
          <h2 style={{ margin: 0, fontSize: 16 }}>Plugin-wide stores</h2>
        </div>
        <Button variant="outline" size="sm" onClick={onBack}>
          Back
        </Button>
      </header>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {(
          [
            ['images', `Docker images (${images?.length ?? 0})`],
            ['cloudflare', 'Cloudflare'],
            ['git', 'Git'],
            ['templates', `Templates (${templates.length})`],
            ['servers', `Remote servers (${servers?.length ?? 0})`],
            ['settings', 'Settings'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            style={tabStyle(tab === value)}
          >
            {label}
          </button>
        ))}
      </div>

      {error === undefined ? null : (
        <p role="alert" style={{ color: 'var(--dsw-alias-state-error-primary, #b42318)', fontSize: 13 }}>
          {error}
        </p>
      )}
      {note === undefined ? null : <p style={{ fontSize: 12, opacity: 0.75 }}>{note}</p>}

      {tab === 'images' ? (
        <section style={sectionStyle}>
          {/* Docker status first: it tells the operator what the screen is
              looking at before it shows nothing. */}
          <div
            role="status"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              marginBottom: 10,
              borderRadius: 6,
              fontSize: 12,
              border: '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)',
              background: 'var(--dsw-alias-bg-layer-3, #f8fafc)',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: docker?.available === true
                  ? 'var(--dsw-alias-state-success-primary, #16a34a)'
                  : docker === undefined
                    ? 'var(--dsw-alias-border-l4, #94a3b8)'
                    : 'var(--dsw-alias-state-error-primary, #dc2626)',
              }}
            />
            {docker === undefined ? (
              'Checking Docker on this machine…'
            ) : docker.available ? (
              <span>
                Docker is running on this machine — {docker.imageCount} image
                {docker.imageCount === 1 ? '' : 's'} available.
              </span>
            ) : (
              <span>
                Docker is not available here{docker.reason === undefined ? '' : ` (${docker.reason})`}.
                You can still add images by reference or import a JSON file.
              </span>
            )}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void refreshDocker()}>
                Recheck
              </Button>
            </span>
          </div>

          <p style={{ fontSize: 12, opacity: 0.7, marginTop: 0 }}>
            Images projects may start. The catalogue is seeded from this machine's Docker daemon;
            tags are checked against Docker Hub.
          </p>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void discoverAndSeed()}>
              {busy ? '…' : 'Discover local images'}
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void resolveAll()}>
              Resolve tags from Docker Hub
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen((value) => !value)}>
              {importOpen ? 'Close import' : 'Import JSON'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditingFunction({})}
              disabled={busy}>
              New function
            </Button>
          </div>

          {importOpen ? (
            <div
              style={{
                border: '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)',
                borderRadius: 8,
                padding: 12,
                marginBottom: 12,
              }}
            >
              <h4 style={{ margin: '0 0 6px', fontSize: 13 }}>Import images from JSON</h4>
              <p style={{ fontSize: 11, opacity: 0.7, marginTop: 0 }}>
                Accepts an array of strings, an array of objects with <code>reference</code> and
                optional <code>function</code>, or an object with <code>images</code> and{' '}
                <code>functions</code> keys.
              </p>
              <textarea
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
                rows={6}
                placeholder={'[\n  { "reference": "quay.io/keycloak/keycloak:26.4", "function": "Keycloak" },\n  "postgres:17-alpine"\n]'}
                aria-label="Image import JSON"
                style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || importJson.trim().length === 0}
                  onClick={() =>
                    void act(async () => {
                      const preview = await importImages(importJson, false)
                      setImportPreview(preview)
                      return `${preview.images?.length ?? 0} image(s) and ${preview.functions?.length ?? 0} function(s) understood`
                    })
                  }
                >
                  Preview
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy || importJson.trim().length === 0}
                  onClick={() =>
                    void act(async () => {
                      const committed = await importImages(importJson, true)
                      setImportPreview(undefined)
                      setImportOpen(false)
                      return `imported ${committed.added ?? 0} image(s)${
                        (committed.functions ?? []).length === 0
                          ? ''
                          : `, created ${(committed.functions ?? []).length} function(s)`
                      }`
                    })
                  }
                >
                  Import
                </Button>
              </div>
              {importPreview === undefined ? null : (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  <div>
                    <strong>{importPreview.images?.length ?? 0}</strong> image(s):{' '}
                    {(importPreview.images ?? []).map((entry) => entry.reference).join(', ') || '—'}
                  </div>
                  {(importPreview.functions ?? []).length === 0 ? null : (
                    <div>
                      <strong>{importPreview.functions?.length}</strong> function(s):{' '}
                      {(importPreview.functions ?? []).map((entry) => entry.name).join(', ')}
                    </div>
                  )}
                  {(importPreview.rejected ?? []).length === 0 ? null : (
                    <div style={{ color: 'var(--dsw-alias-state-warning-primary, #b54708)' }}>
                      {(importPreview.rejected ?? []).length} rejected:{' '}
                      {(importPreview.rejected ?? [])
                        .map((entry) => `${entry.entry} (${entry.reason})`)
                        .join('; ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {editingFunction === undefined ? null : (
            <FunctionEditor
              existing={
                editingFunction.id === undefined
                  ? undefined
                  : (editingFunction as ImageFunction)
              }
              busy={busy}
              error={error}
              onCancel={() => setEditingFunction(undefined)}
              onSave={(input) =>
                act(async () => {
                  const port = Number(input.port)
                  const payload = {
                    name: input.name,
                    description: input.description,
                    ...(input.dnsTemplate.trim().length === 0 ? {} : { dnsTemplate: input.dnsTemplate }),
                    ...(Number.isFinite(port) && port > 0 ? { port } : {}),
                  }
                  if (editingFunction.id === undefined) await createFunction(payload)
                  else await updateFunction(editingFunction.id, payload)
                  setEditingFunction(undefined)
                  return `saved function ${input.name}`
                })
              }
            />
          )}

          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input
              value={newReference}
              onChange={(event) => setNewReference(event.target.value)}
              placeholder="postgres:17-alpine"
              aria-label="Image reference"
              style={{ flex: 1 }}
            />
            <Button
              variant="primary"
              size="sm"
              disabled={busy || newReference.trim().length === 0}
              onClick={() =>
                void act(async () => {
                  await addImage(newReference.trim())
                  const reference = newReference.trim()
                  setNewReference('')
                  return `added ${reference}`
                })
              }
            >
              Add
            </Button>
          </div>

          {images === undefined ? (
            <p style={{ fontSize: 13, opacity: 0.7 }}>Loading…</p>
          ) : images.length === 0 ? (
            <p style={{ fontSize: 13, opacity: 0.7 }}>
              No images yet. Discover what this machine has, or add a reference by hand.
            </p>
          ) : (
            <>
              {/* Functions first, so a group is editable even when it is empty. */}
              {(functions.length > 0 || images.length > 0) && (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
                  <thead>
                    <tr>
                      <th style={headCell}>Function</th>
                      <th style={headCell}>Images</th>
                      <th style={headCell}>DNS template</th>
                      <th style={headCell} />
                    </tr>
                  </thead>
                  <tbody>
                    {functions.map((fn) => (
                      <tr key={fn.id}>
                        <td style={cell}>
                          <div style={{ fontWeight: 500 }}>{fn.name}</div>
                          <div style={{ fontSize: 11, opacity: 0.6 }}>{fn.description}</div>
                        </td>
                        <td style={cell}>{fn.imageCount ?? 0}</td>
                        <td style={{ ...cell, fontSize: 12 }}>
                          {fn.dnsTemplate === undefined ? (
                            <span style={{ opacity: 0.5 }}>none</span>
                          ) : (
                            <code>{fn.dnsTemplate}</code>
                          )}
                        </td>
                        <td style={cell}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingFunction(fn)}
                              disabled={busy}
                            >
                              Edit function
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                void act(async () => {
                                  await removeFunction(fn.id)
                                  return `removed function ${fn.name}; its images are ungrouped`
                                })
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={headCell}>Reference</th>
                    <th style={headCell}>Tag</th>
                    <th style={headCell}>Newest</th>
                    <th style={headCell}>Function</th>
                    <th style={headCell}>Source</th>
                    <th style={headCell} />
                  </tr>
                </thead>
                <tbody>
                  {images.map((image) => (
                    <tr key={image.id}>
                      <td style={cell}>
                        <code style={{ fontSize: 12 }}>{image.repository}</code>
                      </td>
                      <td style={cell}>{image.tag}</td>
                      <td style={cell}>
                        {image.latest === undefined ? (
                          <span style={{ opacity: 0.5 }}>not checked</span>
                        ) : image.latest === image.tag ? (
                          <span style={{ color: 'var(--dsw-alias-state-success-primary, #15803d)' }}>current</span>
                        ) : (
                          <span style={{ color: 'var(--dsw-alias-state-warning-primary, #b54708)' }}>{image.latest}</span>
                        )}
                      </td>
                      <td style={cell}>
                        <select
                          value={image.functionId ?? ''}
                          onChange={(event) =>
                            void act(async () => {
                              await setImageFunction(image.id, event.target.value === '' ? null : event.target.value)
                              return undefined
                            })
                          }
                          aria-label={`Function for ${image.reference}`}
                          style={{
                            fontSize: 12,
                            padding: '3px 6px',
                            borderRadius: 4,
                            background: 'var(--dsw-alias-bg-layer-3, #ffffff)',
                            color: 'var(--dsw-alias-label-primary, #1f2329)',
                            border: '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)',
                          }}
                        >
                          <option value="">— none —</option>
                          {functions.map((fn) => (
                            <option key={fn.id} value={fn.id}>
                              {fn.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ ...cell, opacity: 0.7 }}>{image.source}</td>
                      <td style={cell}>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act(async () => {
                          await removeImage(image.id)
                          return undefined
                        })}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      ) : null}


      {tab === 'cloudflare' ? (
        <section style={sectionStyle}>
          <h3 style={{ fontSize: 13, marginTop: 0 }}>Cloudflare</h3>
          <p style={{ fontSize: 12, opacity: 0.7, marginTop: 0 }}>
            The token this machine uses. A new project imports it, and can override it in the wizard.
            Secrets never come back to the browser, so an empty field keeps what is stored.
          </p>

          <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 11, opacity: 0.7 }} htmlFor="cf-account">
                Account id <span style={{ opacity: 0.6 }}>(optional)</span>
              </label>
              <input
                id="cf-account"
                value={cfAccountId}
                onChange={(event) => setCfAccountId(event.target.value)}
                placeholder="optional"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, opacity: 0.7 }} htmlFor="cf-token">
                API token
              </label>
              <input
                id="cf-token"
                type="password"
                value={cfToken}
                onChange={(event) => {
                  setCfToken(event.target.value)
                  // A changed token invalidates the previous test and zone list.
                  setTestResult(undefined)
                  setZones(undefined)
                }}
                placeholder={
                  credentials.find((entry) => entry.provider === 'cloudflare')?.secrets['token']?.hint ??
                  'not set'
                }
                autoComplete="off"
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: 11, opacity: 0.6 }}>
                {credentials.find((entry) => entry.provider === 'cloudflare')?.secrets['token']?.set === true
                  ? 'a token is stored — leave empty to keep it'
                  : 'no token stored'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const tested = await testCloudflareToken(cfToken.trim())
                  setTestResult({ ok: tested.ok, detail: tested.detail })
                  return undefined
                })
              }
            >
              Test credentials
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const listed = await listCloudflareZones(cfToken.trim())
                  setZones(listed.zones)
                  setSelectedZones(listed.selected)
                  setZoneNote(listed.error)
                  return `${listed.zones.length} zone(s) visible`
                })
              }
            >
              Get zones
            </Button>
          </div>

          {testResult === undefined ? null : (
            <p
              style={{
                fontSize: 12,
                margin: '0 0 10px',
                color: testResult.ok
                  ? 'var(--dsw-alias-state-success-primary, #15803d)'
                  : 'var(--dsw-alias-state-error-primary, #b42318)',
              }}
            >
              {testResult.ok ? '✓ ' : '✕ '}
              {testResult.detail}
            </p>
          )}

          {zones === undefined ? null : (
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h4 style={{ margin: '0 0 4px', fontSize: 12 }}>Zones this plugin may use</h4>
                <span style={{ fontSize: 11, opacity: 0.6 }}>
                  {selectedZones.length === 0
                    ? 'none selected — all visible zones allowed'
                    : `${selectedZones.length} selected`}
                </span>
              </div>
              <p style={{ fontSize: 11, opacity: 0.7, margin: '0 0 6px' }}>
                Selecting zones restricts this plugin to them. Leaving all unchecked permits every
                zone the token can see.
              </p>
              <div
                style={{
                  maxHeight: 200,
                  overflowY: 'auto',
                  border: '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)',
                  borderRadius: 6,
                }}
              >
                {zones.length === 0 ? (
                  <p style={{ fontSize: 12, padding: 10, margin: 0, opacity: 0.7 }}>
                    {zoneNote ?? 'No zones returned for this token.'}
                  </p>
                ) : (
                  zones.map((zone) => (
                    <label
                      key={zone.id}
                      style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 10px', fontSize: 12 }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedZones.includes(zone.name)}
                        onChange={(event) =>
                          setSelectedZones((current) =>
                            event.target.checked
                              ? [...current, zone.name]
                              : current.filter((entry) => entry !== zone.name),
                          )
                        }
                      />
                      <code>{zone.name}</code>
                      {zone.status === undefined ? null : (
                        <span style={{ opacity: 0.55 }}>{zone.status}</span>
                      )}
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await saveCredential('cloudflare', {
                  accountId: cfAccountId,
                  zone: selectedZones[0] ?? cfZone,
                  zones: selectedZones.join(','),
                  ...(cfToken.trim().length === 0 ? {} : { token: cfToken.trim() }),
                })
                setCfToken('')
                return 'Cloudflare credentials saved for this machine'
              })
            }
          >
            Save Cloudflare
          </Button>
        </section>
      ) : null}

      {tab === 'git' ? (
        <section style={sectionStyle}>
          <h3 style={{ fontSize: 13, marginTop: 0 }}>Git (GitHub)</h3>
          <p style={{ fontSize: 12, opacity: 0.7, marginTop: 0 }}>
            The owner and token this machine uses for repositories. A new project imports them and
            can override them in the wizard.
          </p>

          <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 11, opacity: 0.7 }} htmlFor="gh-owner">
                Owner (user or org)
              </label>
              <input
                id="gh-owner"
                value={ghOwner}
                onChange={(event) => setGhOwner(event.target.value)}
                placeholder="your-org"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, opacity: 0.7 }} htmlFor="gh-token">
                Personal access token
              </label>
              <input
                id="gh-token"
                type="password"
                value={ghToken}
                onChange={(event) => setGhToken(event.target.value)}
                placeholder={
                  credentials.find((entry) => entry.provider === 'github')?.secrets['token']?.hint ??
                  'not set'
                }
                autoComplete="off"
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: 11, opacity: 0.6 }}>
                {credentials.find((entry) => entry.provider === 'github')?.secrets['token']?.set === true
                  ? 'a token is stored — leave empty to keep it'
                  : 'no token stored'}
              </span>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await saveCredential('github', {
                  owner: ghOwner,
                  ...(ghToken.trim().length === 0 ? {} : { token: ghToken.trim() }),
                })
                setGhToken('')
                return 'Git credentials saved for this machine'
              })
            }
          >
            Save Git
          </Button>
        </section>
      ) : null}

      {tab === 'templates' ? (
        <section style={sectionStyle}>
          <h3 style={{ fontSize: 13, marginTop: 0 }}>Project templates</h3>
          <p style={{ fontSize: 12, opacity: 0.7, marginTop: 0 }}>
            A template is a git repository used as the starting point for a project. The plugin
            looks inside it for a <code>project details</code> folder describing how a project of
            that shape is set up.
          </p>

          <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 11, opacity: 0.7 }} htmlFor="tpl-name">
                Template name
              </label>
              <input
                id="tpl-name"
                value={tplName}
                onChange={(event) => setTplName(event.target.value)}
                placeholder="turbo-pnpm-monorepo"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, opacity: 0.7 }} htmlFor="tpl-repo">
                Git repository (URL or local path)
              </label>
              <input
                id="tpl-repo"
                value={tplRepo}
                onChange={(event) => {
                  setTplRepo(event.target.value)
                  setInspection(undefined)
                }}
                placeholder="https://github.com/your-org/turbo-starter.git"
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, opacity: 0.7 }} htmlFor="tpl-ref">
                  Branch / tag
                </label>
                <input
                  id="tpl-ref"
                  value={tplRef}
                  onChange={(event) => setTplRef(event.target.value)}
                  placeholder="default branch"
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, opacity: 0.7 }} htmlFor="tpl-details">
                  Details folder
                </label>
                <input
                  id="tpl-details"
                  value={tplDetails}
                  onChange={(event) => setTplDetails(event.target.value)}
                  placeholder="project details"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, opacity: 0.7 }} htmlFor="tpl-desc">
                Description
              </label>
              <input
                id="tpl-desc"
                value={tplDescription}
                onChange={(event) => setTplDescription(event.target.value)}
                placeholder="Turbo + pnpm monorepo with a standard layout"
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || tplRepo.trim().length === 0}
              onClick={() =>
                void act(async () => {
                  const checked = await inspectTemplate(
                    tplRepo.trim(),
                    tplDetails.trim(),
                    tplRef.trim().length === 0 ? undefined : tplRef.trim(),
                  )
                  setInspection({ repo: tplRepo.trim(), ...checked.inspection })
                  return checked.inspection.found
                    ? `found "${tplDetails}" with ${checked.inspection.files.length} file(s)`
                    : (checked.inspection.error ?? 'details folder not found')
                })
              }
            >
              Check repository
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || tplName.trim().length === 0 || tplRepo.trim().length === 0}
              onClick={() =>
                void act(async () => {
                  await createTemplate({
                    name: tplName.trim(),
                    description: tplDescription,
                    repo: tplRepo.trim(),
                    detailsPath: tplDetails.trim(),
                    ...(tplRef.trim().length === 0 ? {} : { ref: tplRef.trim() }),
                  })
                  setTplName('')
                  setTplRepo('')
                  setTplRef('')
                  setTplDescription('')
                  setInspection(undefined)
                  return 'template saved'
                })
              }
            >
              Save template
            </Button>
          </div>

          {inspection === undefined ? null : (
            <div
              style={{
                border: '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)',
                borderRadius: 6,
                padding: 10,
                marginBottom: 12,
                fontSize: 12,
              }}
            >
              <strong>
                {inspection.found ? 'Details folder found' : 'No details folder'}
                {inspection.error === undefined ? '' : ` — ${inspection.error}`}
              </strong>
              {inspection.files.length === 0 ? null : (
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {inspection.files.slice(0, 20).map((file) => (
                    <li key={file}>
                      <code>{file}</code>
                    </li>
                  ))}
                </ul>
              )}
              {inspection.setup === undefined ? null : (
                <div style={{ marginTop: 6 }}>
                  <div style={{ opacity: 0.7 }}>Setup descriptor:</div>
                  <pre style={{ margin: '4px 0 0', fontSize: 11, overflowX: 'auto' }}>
                    {JSON.stringify(inspection.setup, undefined, 2)}
                  </pre>
                </div>
              )}
              {inspection.warnings.length === 0 ? null : (
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, opacity: 0.75 }}>
                  {inspection.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {templates.length === 0 ? (
            <p style={{ fontSize: 13, opacity: 0.7 }}>No templates yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={headCell}>Template</th>
                  <th style={headCell}>Repository</th>
                  <th style={headCell}>Details</th>
                  <th style={headCell} />
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id}>
                    <td style={cell}>
                      <div style={{ fontWeight: 500 }}>{template.name}</div>
                      <div style={{ fontSize: 11, opacity: 0.6 }}>{template.description}</div>
                    </td>
                    <td style={{ ...cell, fontSize: 12 }}>
                      <code>{template.repo}</code>
                      {template.ref === undefined ? null : (
                        <div style={{ opacity: 0.6 }}>{template.ref}</div>
                      )}
                    </td>
                    <td style={{ ...cell, fontSize: 12 }}>
                      {template.detailsFound ? (
                        <span style={{ color: 'var(--dsw-alias-state-success-primary, #15803d)' }}>
                          found
                        </span>
                      ) : (
                        <span style={{ color: 'var(--dsw-alias-state-warning-primary, #b54708)' }}>
                          missing
                        </span>
                      )}
                      <div style={{ opacity: 0.6 }}>
                        <code>{template.detailsPath}</code>
                      </div>
                      {template.detailsNote === undefined ? null : (
                        <div style={{ opacity: 0.6 }}>{template.detailsNote}</div>
                      )}
                    </td>
                    <td style={cell}>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await removeTemplate(template.id)
                            return `removed ${template.name}`
                          })
                        }
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {tab === 'servers' ? (
        <section style={sectionStyle}>
          {wizardOpen ? (
            <AddServerWizard
              images={images ?? []}
              onDone={() => {
                setWizardOpen(false)
                void refresh()
              }}
              onCancel={() => setWizardOpen(false)}
            />
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <Button variant="primary" size="sm" onClick={() => setWizardOpen(true)}>
                  Add remote server
                </Button>
              </div>
              {servers === undefined ? (
                <p style={{ fontSize: 13, opacity: 0.7 }}>Loading…</p>
              ) : servers.length === 0 ? (
                <p style={{ fontSize: 13, opacity: 0.7 }}>
                  No servers yet. Add one to provision it: key auth, updates, DNS, Docker, and a
                  workspace folder.
                </p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={headCell}>Name</th>
                      <th style={headCell}>Address</th>
                      <th style={headCell}>Hostname</th>
                      <th style={headCell}>Secured</th>
                      <th style={headCell} />
                    </tr>
                  </thead>
                  <tbody>
                    {servers.map((server) => (
                      <tr key={server.id}>
                        <td style={cell}>{server.name}</td>
                        <td style={{ ...cell, fontSize: 12 }}>
                          {server.user}@{server.host}:{server.port}
                        </td>
                        <td style={{ ...cell, fontSize: 12 }}>{server.hostname ?? '—'}</td>
                        <td style={cell}>
                          {server.passwordDisabled === true ? (
                            <span style={{ color: 'var(--dsw-alias-state-success-primary, #15803d)' }}>key only</span>
                          ) : server.keySet ? (
                            <span style={{ color: 'var(--dsw-alias-state-warning-primary, #b54708)' }}>key, password on</span>
                          ) : (
                            <span style={{ opacity: 0.6 }}>not set up</span>
                          )}
                        </td>
                        <td style={cell}>
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act(async () => {
                            await removeServer(server.id)
                            return `removed ${server.name}`
                          })}>
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </section>
      ) : null}

      {tab === 'settings' ? (
        <section style={sectionStyle}>
          <h3 style={{ fontSize: 13, marginTop: 0 }}>Default workspace folder</h3>
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            Where new project templates are created. Each template becomes a folder here, named from
            its title. A project template cannot be created until this is set.
          </p>
          <div style={{ marginBottom: 10 }}>
            <DirectoryPickerField
              label="Template folder"
              value={templateHome}
              onChange={setTemplateHome}
              picker={picker}
              placeholder="/home/you/templates"
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await putSetting('templateHome', templateHome)
                return 'default workspace folder saved'
              })
            }
          >
            Save
          </Button>
          <p style={{ fontSize: 11, opacity: 0.6, marginBottom: 14 }}>
            A remote server&rsquo;s own workspace folder is set per server in the wizard.
          </p>

          <h3 style={{ fontSize: 13 }}>All stored keys</h3>
          {settings.length === 0 ? (
            <p style={{ fontSize: 13, opacity: 0.7 }}>Nothing stored yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={headCell}>Key</th>
                  <th style={headCell}>Value</th>
                </tr>
              </thead>
              <tbody>
                {settings.map((setting) => (
                  <tr key={setting.key}>
                    <td style={cell}>
                      <code style={{ fontSize: 12 }}>{setting.key}</code>
                    </td>
                    <td style={{ ...cell, fontSize: 12 }}>{setting.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
    </div>
  )
}
