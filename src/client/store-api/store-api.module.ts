/**
 * Client calls for the plugin-wide stores and server provisioning.
 *
 * Every call goes through `/api/projects/store/...` and surfaces the host's
 * machine-readable error code, so a screen can distinguish "the name is taken"
 * from "the server refused the key" rather than showing one opaque message.
 */
import type {
  DnsZone,
  DockerImage,
  MachineCredential,
  DockerMachineStatus,
  ImageFunction,
  LocalImage,
  ProjectTemplate,
  RemoteServer,
  TemplateInspection,
  ServerFacts,
  StoreSetting,
} from './store-api.interface.ts'

/** Error carrying the host's code. */
export class StoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'StoreError'
  }
}

const BASE = '/api/projects/store'

/** One request, with the shared error decoding. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  })
  const text = await response.text()
  let payload: { ok?: boolean; error?: { code?: string; message?: string } } & T
  try {
    payload = (text.length > 0 ? JSON.parse(text) : {}) as typeof payload
  } catch {
    throw new StoreError('bad-response', `unreadable response (${response.status})`)
  }
  if (!response.ok || payload.ok === false) {
    throw new StoreError(
      payload.error?.code ?? `http-${response.status}`,
      payload.error?.message ?? response.statusText,
    )
  }
  return payload
}

// ---------------------------------------------------------------- images

/** Every catalogue image. */
export function listImages(): Promise<{ images: DockerImage[] }> {
  return call('/images')
}

/** Add one image by reference. */
export function addImage(reference: string, description = ''): Promise<{ image: DockerImage }> {
  return call('/images', { method: 'POST', body: JSON.stringify({ reference, description }) })
}

/** Remove one image. */
export function removeImage(id: string): Promise<{ removed: boolean }> {
  return call(`/images/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Ask what the local Docker daemon has, without writing anything. */
export function discoverImages(): Promise<{ images: LocalImage[]; reason?: string }> {
  return call('/images/discover', { method: 'POST' })
}

/** Seed the catalogue from the local Docker daemon. */
export function seedImages(): Promise<{ seeded: number; discovered: number; reason?: string }> {
  return call('/images/seed', { method: 'POST' })
}

/** Resolve one reference, or every entry when none is given, against Docker Hub. */
export function resolveImages(reference?: string): Promise<{
  check?: { reference: string; tags: string[]; latest?: string; error?: string }
  results?: Array<{ reference: string; latest?: string; error?: string }>
}> {
  return call('/images/resolve', {
    method: 'POST',
    body: JSON.stringify(reference === undefined ? {} : { reference }),
  })
}

/** Docker availability on this machine. */
export function dockerStatus(): Promise<DockerMachineStatus> {
  return call('/docker')
}

/**
 * Preview or commit a JSON import of images.
 *
 * `commit: false` returns what the document contained without writing, so the
 * operator can see what would happen before it does.
 */
export function importImages(
  json: string,
  commit: boolean,
): Promise<{
  preview?: boolean
  images?: Array<{ reference: string; description?: string; functionName?: string }>
  functions?: Array<{ name: string; dnsTemplate?: string }>
  rejected?: Array<{ entry: string; reason: string }>
  added?: number
  failed?: Array<{ reference: string; reason: string }>
}> {
  return call('/images/import', { method: 'POST', body: JSON.stringify({ json, commit }) })
}

// ------------------------------------------------------------- functions

/** Every image function. */
export function listFunctions(): Promise<{ functions: ImageFunction[] }> {
  return call('/functions')
}

/** Create a function. */
export function createFunction(input: {
  name: string
  description?: string
  dnsTemplate?: string
  port?: number
}): Promise<{ function: ImageFunction }> {
  return call('/functions', { method: 'POST', body: JSON.stringify(input) })
}

/** Update a function. */
export function updateFunction(
  id: string,
  input: { name: string; description?: string; dnsTemplate?: string; port?: number },
): Promise<{ function: ImageFunction }> {
  return call(`/functions/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

/** Remove a function; its images are ungrouped, not deleted. */
export function removeFunction(id: string): Promise<{ removed: boolean }> {
  return call(`/functions/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Put an image in a function, or clear its grouping with null. */
export function setImageFunction(
  imageId: string,
  functionId: string | null,
): Promise<{ image: DockerImage }> {
  return call(`/images/${encodeURIComponent(imageId)}/function`, {
    method: 'PUT',
    body: JSON.stringify({ functionId }),
  })
}

// --------------------------------------------------------------- servers

/** Every remote server. */
export function listServers(): Promise<{ servers: RemoteServer[] }> {
  return call('/servers')
}

/** Create a server identity, before any connection is attempted. */
export function createServer(input: {
  name: string
  host: string
  user: string
  port?: number
}): Promise<{ server: RemoteServer }> {
  return call('/servers', { method: 'POST', body: JSON.stringify(input) })
}

/** Remove a server. */
export function removeServer(id: string): Promise<{ removed: boolean }> {
  return call(`/servers/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * Generate and install a key, verify it, then disable password login.
 *
 * The password is passed once, for the install only. It is never stored.
 */
export function secureServer(
  id: string,
  credentials: { password?: string; keyPath?: string },
): Promise<{
  server?: RemoteServer
  facts: ServerFacts
  passwordDisabled: boolean
  detail: string
}> {
  return call(`/servers/${encodeURIComponent(id)}/secure`, {
    method: 'POST',
    body: JSON.stringify(credentials),
  })
}

/** Re-probe a secured server. */
export function probeServer(id: string): Promise<{ facts: ServerFacts; server?: RemoteServer }> {
  return call(`/servers/${encodeURIComponent(id)}/probe`, { method: 'POST' })
}

/** Check for pending OS updates, or apply them. */
export function serverUpdates(
  id: string,
  apply = false,
): Promise<{ count?: number; sample?: string[]; manager?: string; ok?: boolean; detail?: string; error?: string }> {
  return call(`/servers/${encodeURIComponent(id)}/updates`, {
    method: 'POST',
    body: JSON.stringify({ apply }),
  })
}

/** Install one missing toolchain component. */
export function installOnServer(
  id: string,
  what: 'node' | 'nvm' | 'git' | 'docker',
): Promise<{ ok: boolean; detail: string }> {
  return call(`/servers/${encodeURIComponent(id)}/install`, {
    method: 'POST',
    body: JSON.stringify({ what }),
  })
}

/** List the DNS zones the configured Cloudflare token can see. */
export function listZones(id: string): Promise<{ zones: DnsZone[]; error?: string }> {
  return call(`/servers/${encodeURIComponent(id)}/zones`)
}

/** Create the DNS record and set the server's hostname. */
export function createDns(
  id: string,
  zone: string,
  proxied = false,
): Promise<{ fqdn?: string; hostnameOk: boolean; hostnameDetail: string; server?: RemoteServer }> {
  return call(`/servers/${encodeURIComponent(id)}/dns`, {
    method: 'POST',
    body: JSON.stringify({ zone, proxied }),
  })
}

/** Remove the DNS record this plugin created for a server. */
export function deleteDns(id: string): Promise<{ ok: boolean; detail: string }> {
  return call(`/servers/${encodeURIComponent(id)}/dns`, { method: 'DELETE' })
}

/** Pull the chosen images onto the server. */
export function pullImages(
  id: string,
  references: string[],
): Promise<{ results: Array<{ reference: string; ok: boolean; detail: string }> }> {
  return call(`/servers/${encodeURIComponent(id)}/images`, {
    method: 'POST',
    body: JSON.stringify({ references }),
  })
}

/** Save (and create) the default workspace folder. */
export function setWorkdir(id: string, directory: string): Promise<{ detail: string; directory: string }> {
  return call(`/servers/${encodeURIComponent(id)}/workdir`, {
    method: 'POST',
    body: JSON.stringify({ directory }),
  })
}

// ------------------------------------------------------- project templates

/** Every project template. */
export function listTemplates(): Promise<{ templates: ProjectTemplate[] }> {
  return call('/templates')
}

/** Inspect a repository for its details folder, without saving anything. */
export function inspectTemplate(
  repo: string,
  detailsPath = 'project details',
  ref?: string,
): Promise<{ inspection: TemplateInspection }> {
  return call('/templates/inspect', {
    method: 'POST',
    body: JSON.stringify({ repo, detailsPath, ...(ref === undefined ? {} : { ref }) }),
  })
}

/** Create a template. The host inspects it on save unless `skipInspect`. */
export function createTemplate(input: {
  name: string
  description?: string
  repo: string
  ref?: string
  detailsPath?: string
  skipInspect?: boolean
}): Promise<{ template: ProjectTemplate }> {
  return call('/templates', { method: 'POST', body: JSON.stringify(input) })
}

/** Whether a template's folder name is free, before anything is created. */
export function checkTemplateFolder(name: string): Promise<{
  slug: string
  path: string
  available: boolean
  reason?: string
}> {
  return call('/templates/check', { method: 'POST', body: JSON.stringify({ name }) })
}

/**
 * Create a NEW template authored locally.
 *
 * Distinct from {@link createTemplate}: that records a repository that already
 * exists, while this makes a directory for a template being written now.
 */
export function createTemplateWorkspace(input: {
  name: string
  description?: string
  detailsPath?: string
  repo?: string
  /** Absolute folder the template workspace is created inside. */
  parent?: string
}): Promise<{ template: ProjectTemplate; path: string; warning?: string }> {
  return call('/templates/new', { method: 'POST', body: JSON.stringify(input) })
}

/** Update a template. */
export function updateTemplate(
  id: string,
  input: {
    name?: string
    description?: string
    repo?: string
    ref?: string
    detailsPath?: string
    enabled?: boolean
    skipInspect?: boolean
  },
): Promise<{ template: ProjectTemplate }> {
  return call(`/templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

/** Remove a template. */
export function removeTemplate(id: string): Promise<{ removed: boolean }> {
  return call(`/templates/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ----------------------------------------------------------- credentials

/** Every machine credential block, secrets masked. */
export function listCredentials(): Promise<{ credentials: MachineCredential[] }> {
  return call('/credentials')
}

/**
 * Save one provider's machine credentials.
 *
 * An empty string clears that field; omitting it keeps the stored value. The
 * host merges, so saving only a token does not erase an account id.
 */
export function saveCredential(
  provider: string,
  patch: Record<string, string>,
): Promise<{ credential: MachineCredential }> {
  return call(`/credentials/${encodeURIComponent(provider)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

/**
 * Test a Cloudflare token.
 *
 * An empty token tests the stored one: the browser never receives the secret
 * back, so it cannot resend a value it does not have.
 */
export function testCloudflareToken(token: string): Promise<{ ok: boolean; detail: string; zones: number }> {
  return call('/credentials/test', { method: 'POST', body: JSON.stringify({ token }) })
}

/** List the zones a token can see, plus those already selected. */
export function listCloudflareZones(token: string): Promise<{
  zones: DnsZone[]
  selected: string[]
  error?: string
}> {
  return call('/credentials/zones', { method: 'POST', body: JSON.stringify({ token }) })
}

/** Remove a provider's machine credentials. */
export function removeCredential(provider: string): Promise<{ removed: boolean }> {
  return call(`/credentials/${encodeURIComponent(provider)}`, { method: 'DELETE' })
}

// -------------------------------------------------------------- settings

/** Every plugin-wide setting. */
export function listSettings(): Promise<{ settings: StoreSetting[]; templateHome: string | null }> {
  return call('/settings')
}

/** Write one setting. */
export function putSetting(key: string, value: string | number | boolean | null): Promise<{ settings: StoreSetting[] }> {
  return call('/settings', { method: 'PUT', body: JSON.stringify({ key, value }) })
}
