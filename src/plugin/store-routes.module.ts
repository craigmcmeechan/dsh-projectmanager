/**
 * HTTP surface for the plugin-wide stores and server provisioning.
 *
 * Mounted on the same prefix as the project routes and dispatched by the first
 * segment, so the store lives at `/api/projects/store/...` rather than claiming
 * a second prefix.
 *
 * Every write validates on the host: the client is not trusted to have checked
 * a name for uniqueness, and a reference it invented must not reach `docker`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PluginStore, TEMPLATE_HOME_KEY } from '../store/store.module.ts'
import { resolveRegistryTags, seedCatalogue, discoverLocalImages } from '../store/registry.module.ts'
import { parseImageImport } from '../store/image-import.module.ts'
import { createTemplateWorkspace, inspectTemplate } from '../store/template.module.ts'
import {
  checkUpdates,
  applyUpdates,
  disablePasswordLogin,
  ensureWorkdir,
  generateKey,
  installKey,
  installTool,
  probeServer,
  pullRemoteImage,
  setHostname,
} from '../store/provision.module.ts'
import { createRecord, deleteRecord, listZones, testToken } from '../store/dns.module.ts'
import type { RemoteServerView, ServerFacts } from '../store/store.interface.ts'

/**
 * Build a function input from a request body.
 *
 * `exactOptionalPropertyTypes` rejects an explicitly-`undefined` optional
 * property, and the body's fields are all optional, so absent keys are omitted
 * rather than passed as undefined.
 * @param body - the parsed request body.
 * @param id - the existing function id, when updating.
 */
function functionInput(
  body: Record<string, unknown>,
  id?: string,
): { id?: string; name: string; description: string; dnsTemplate?: string | null; port?: number | null } {
  const input: { id?: string; name: string; description: string; dnsTemplate?: string | null; port?: number | null } = {
    name: String(body.name ?? ''),
    description: String(body.description ?? ''),
  }
  if (id !== undefined) input.id = id
  if (body.dnsTemplate !== undefined) input.dnsTemplate = String(body.dnsTemplate)
  if (body.port !== undefined && body.port !== null) input.port = Number(body.port)
  return input
}

/**
 * Fields that are secrets, per provider.
 *
 * Listed explicitly rather than inferred from a name containing "token": an
 * account id or a zone name is not a secret, and guessing wrong either leaks a
 * credential or hides a value the operator needs to see.
 */
const SECRET_FIELDS: Record<string, string[]> = {
  cloudflare: ['token'],
  github: ['token'],
}

/**
 * The stored Cloudflare credential block.
 *
 * Read from the store, not from the old machine.json: two parallel credential
 * stores meant the DNS screen and the Credentials screen could disagree about
 * which token was in force.
 */
function cloudflareConfig(home: string): Record<string, string> {
  const store = openStore(home)
  try {
    return store.listCredentials().find((entry) => entry.provider === 'cloudflare')?.config ?? {}
  } finally {
    store.close()
  }
}

/** Mask a secret for display, keeping enough to identify it. */
function maskSecret(secret: string): string {
  if (secret.length === 0) return ''
  if (secret.length <= 12) return '••••'
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`
}

/** Project a credential for the browser with every secret masked. */
function credentialView(record: { provider: string; config: Record<string, string>; updatedAt: number }): {
  provider: string
  fields: Record<string, string>
  secrets: Record<string, { set: boolean; hint: string }>
  updatedAt: number
} {
  const secretNames = SECRET_FIELDS[record.provider] ?? []
  const fields: Record<string, string> = {}
  const secrets: Record<string, { set: boolean; hint: string }> = {}
  for (const [key, value] of Object.entries(record.config)) {
    if (secretNames.includes(key)) {
      secrets[key] = { set: value.length > 0, hint: maskSecret(value) }
    } else {
      fields[key] = value
    }
  }
  // A secret that was never stored still reports `set: false`, so the UI can
  // show a placeholder row rather than omitting the field.
  for (const name of secretNames) {
    if (secrets[name] === undefined) secrets[name] = { set: false, hint: '' }
  }
  return { provider: record.provider, fields, secrets, updatedAt: record.updatedAt }
}

/**
 * Folder name for a template title.
 *
 * Lowercases, collapses every run of punctuation or whitespace to a single
 * dash, trims dashes from the ends, and bounds the length. This is the same
 * rule `createTemplateWorkspace` applies, duplicated here only so the route can
 * report which folder it checked.
 * @param title - the operator's template name.
 */
function slugifyTemplateName(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/** Image sub-resource names that are not ids, so they are not delete targets. */
const IMAGE_SUBRESOURCES = new Set(['discover', 'seed', 'resolve', 'import'])

/** Template sub-resource names that are not ids, so they are not delete targets. */
const TEMPLATE_SUBRESOURCES = new Set(['inspect', 'new', 'check'])

/** Where the plugin-wide database lives. */
export function storePath(home: string): string {
  return join(home, 'project-manager', 'store.db')
}

/** Open the plugin-wide store, creating its directory. */
export function openStore(home: string): PluginStore {
  mkdirSync(join(home, 'project-manager'), { recursive: true, mode: 0o700 })
  return new PluginStore(storePath(home))
}

/** Parse a stored facts blob defensively. */
function factsOf(raw: string | undefined): ServerFacts {
  if (raw === undefined) return {}
  try {
    return JSON.parse(raw) as ServerFacts
  } catch {
    return {}
  }
}

/** Project a stored server for the browser. */
function serverView(record: ReturnType<PluginStore['listServers']>[number]): RemoteServerView {
  const { keyPath, ...rest } = record
  return {
    ...rest,
    facts: factsOf(record.facts),
    keySet: keyPath !== undefined && keyPath.length > 0,
  }
}

/** Small JSON helpers, matching the project routes' response shape. */
function ok(res: ServerResponse, body: Record<string, unknown>, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: true, ...body }))
}

function fail(res: ServerResponse, status: number, code: string, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: { code, message } }))
}

/** Read and parse a JSON body, tolerating an empty one. */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text.length === 0) return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * Handle one `/api/projects/store/...` request.
 * @param req - incoming request.
 * @param res - response writer.
 * @param home - Harness home.
 * @param segments - path segments after `store`.
 * @param method - HTTP method.
 * @returns whether this handler owned the route.
 */
export async function handleStoreRequest(
  req: IncomingMessage,
  res: ServerResponse,
  home: string,
  segments: string[],
  method: string,
  changes?: import('./changes.module.ts').ChangeFeed,
): Promise<boolean> {
  const [collection, id, verb] = segments
  const store = openStore(home)
  try {
    // ------------------------------------------------------------- images
    if (collection === 'images' && id === undefined) {
      if (method === 'GET') {
        ok(res, { images: store.listImages() })
        return true
      }
      if (method === 'POST') {
        const input = await readBody(req)
        const written = store.upsertImage({
          reference: String(input.reference ?? ''),
          description: String(input.description ?? ''),
          source: 'manual',
        })
        if (written.error !== undefined) {
          fail(res, 400, 'invalid-image', written.error)
          return true
        }
        ok(res, { image: written.value }, 201)
        return true
      }
      fail(res, 405, 'method', 'use GET or POST')
      return true
    }

    // Reserved image sub-resources. Listed here, before the by-id branch, because
    // `/images/import` is also `verb === undefined` and that branch would answer
    // 405 for it — the same route-shadowing bug the project routes hit twice.
    if (collection === 'images' && id !== undefined && verb === undefined
      && !IMAGE_SUBRESOURCES.has(id)) {
      if (method === 'DELETE') {
        ok(res, { removed: store.removeImage(id) })
        return true
      }
      fail(res, 405, 'method', 'use DELETE')
      return true
    }

    // Discover what is on this machine and seed the catalogue from it.
    if (collection === 'images' && id === 'discover' && method === 'POST') {
      const discovered = await discoverLocalImages()
      ok(res, discovered)
      return true
    }

    if (collection === 'images' && id === 'seed' && method === 'POST') {
      const result = await seedCatalogue(store)
      ok(res, result)
      return true
    }

    // Resolve one reference (or every entry) against Docker Hub.
    if (collection === 'images' && id === 'resolve' && method === 'POST') {
      const input = await readBody(req)
      const reference = String(input.reference ?? '')
      if (reference.length > 0) {
        const check = await resolveRegistryTags(reference)
        if (check.error === undefined && check.latest !== undefined) {
          store.upsertImage({ reference, latest: check.latest, source: 'registry' })
        }
        ok(res, { check })
        return true
      }
      // No reference: refresh every entry, reporting per-entry failures rather
      // than failing the batch on the first rate limit.
      const results = []
      for (const image of store.listImages()) {
        const check = await resolveRegistryTags(image.reference)
        if (check.error === undefined && check.latest !== undefined) {
          store.upsertImage({ reference: image.reference, latest: check.latest, source: image.source })
        }
        results.push({ reference: image.reference, latest: check.latest, error: check.error })
      }
      ok(res, { results })
      return true
    }

    // ------------------------------------------------------------ servers
    if (collection === 'servers' && id === undefined) {
      if (method === 'GET') {
        ok(res, { servers: store.listServers().map(serverView) })
        return true
      }
      if (method === 'POST') {
        const input = await readBody(req)
        const written = store.upsertServer({
          name: String(input.name ?? ''),
          host: String(input.host ?? ''),
          user: String(input.user ?? ''),
          port: Number(input.port ?? 22),
        })
        if (written.error !== undefined) {
          fail(res, 400, 'invalid-server', written.error)
          return true
        }
        ok(res, { server: serverView(written.value!) }, 201)
        return true
      }
      fail(res, 405, 'method', 'use GET or POST')
      return true
    }

    if (collection === 'servers' && id !== undefined && verb === undefined) {
      if (method === 'DELETE') {
        ok(res, { removed: store.removeServer(id) })
        return true
      }
      fail(res, 405, 'method', 'use DELETE')
      return true
    }

    // Step 1: generate a key, install it, verify it, then disable password auth.
    if (collection === 'servers' && id !== undefined && verb === 'secure' && method === 'POST') {
      const input = await readBody(req)
      const server = store.listServers().find((entry) => entry.id === id)
      if (server === undefined) {
        fail(res, 404, 'not-found', 'no such server')
        return true
      }
      const key = await generateKey(home, server.name)
      if ('error' in key) {
        fail(res, 400, 'keygen', key.error)
        return true
      }
      const credentials = {
        host: server.host,
        user: server.user,
        port: server.port,
        ...(typeof input.password === 'string' ? { password: input.password } : {}),
        ...(typeof input.keyPath === 'string' ? { keyPath: input.keyPath } : {}),
      }
      const installed = await installKey(credentials, key.publicKey)
      if (!installed.ok) {
        fail(res, 400, 'key-install', installed.detail)
        return true
      }
      // Verify key auth before turning the password off: disabling first would
      // lock the operator out if the key were not actually accepted.
      const verified = await probeServer(credentials, key.privateKeyPath)
      if (verified.facts === undefined) {
        fail(res, 400, 'key-verify', verified.error ?? 'the key was installed but not accepted')
        return true
      }
      const disabled = await disablePasswordLogin(credentials, key.privateKeyPath)
      const written = store.upsertServer({
        id: server.id,
        name: server.name,
        host: server.host,
        user: server.user,
        port: server.port,
        keyPath: key.privateKeyPath,
        passwordDisabled: disabled.ok,
        facts: verified.facts,
      })
      ok(res, {
        server: written.value === undefined ? undefined : serverView(written.value),
        facts: verified.facts,
        passwordDisabled: disabled.ok,
        detail: disabled.detail,
      })
      return true
    }

    // Step 2: re-probe a secured server.
    if (collection === 'servers' && id !== undefined && verb === 'probe' && method === 'POST') {
      const server = store.listServers().find((entry) => entry.id === id)
      if (server === undefined) {
        fail(res, 404, 'not-found', 'no such server')
        return true
      }
      const credentials = { host: server.host, user: server.user, port: server.port }
      const probed = await probeServer(credentials, server.keyPath)
      if (probed.facts === undefined) {
        fail(res, 400, 'probe', probed.error ?? 'could not probe the server')
        return true
      }
      const written = store.upsertServer({
        id: server.id,
        name: server.name,
        host: server.host,
        user: server.user,
        port: server.port,
        ...(server.keyPath === undefined ? {} : { keyPath: server.keyPath }),
        passwordDisabled: server.passwordDisabled ?? false,
        facts: probed.facts,
      })
      ok(res, { facts: probed.facts, server: written.value === undefined ? undefined : serverView(written.value) })
      return true
    }

    if (collection === 'servers' && id !== undefined && verb === 'updates' && method === 'POST') {
      const server = store.listServers().find((entry) => entry.id === id)
      if (server === undefined || server.keyPath === undefined) {
        fail(res, 404, 'not-found', 'no secured server with that id')
        return true
      }
      const credentials = { host: server.host, user: server.user, port: server.port }
      const input = await readBody(req)
      if (input.apply === true) {
        const applied = await applyUpdates(credentials, server.keyPath)
        ok(res, applied)
        return true
      }
      const checked = await checkUpdates(credentials, server.keyPath)
      ok(res, checked)
      return true
    }

    if (collection === 'servers' && id !== undefined && verb === 'install' && method === 'POST') {
      const server = store.listServers().find((entry) => entry.id === id)
      if (server === undefined || server.keyPath === undefined) {
        fail(res, 404, 'not-found', 'no secured server with that id')
        return true
      }
      const input = await readBody(req)
      const what = String(input.what ?? '')
      if (what !== 'node' && what !== 'nvm' && what !== 'git' && what !== 'docker') {
        fail(res, 400, 'invalid-tool', 'what must be one of node, nvm, git, docker')
        return true
      }
      const credentials = { host: server.host, user: server.user, port: server.port }
      const installed = await installTool(credentials, server.keyPath, what)
      ok(res, installed)
      return true
    }

    // Step 3: list zones, create the record, then set the hostname.
    if (collection === 'servers' && id !== undefined && verb === 'zones' && method === 'GET') {
      const zones = await listZones(cloudflareConfig(home))
      ok(res, { zones: zones.zones, error: zones.error })
      return true
    }

    if (collection === 'servers' && id !== undefined && verb === 'dns' && method === 'POST') {
      const server = store.listServers().find((entry) => entry.id === id)
      if (server === undefined) {
        fail(res, 404, 'not-found', 'no such server')
        return true
      }
      const input = await readBody(req)
      const zone = String(input.zone ?? '')
      const created = await createRecord(cloudflareConfig(home), zone, server.name, server.host, input.proxied === true)
      if (!created.ok) {
        fail(res, 400, 'dns', created.detail)
        return true
      }
      let hostnameDetail = 'hostname not changed: the server is not secured yet'
      let hostnameOk = false
      if (server.keyPath !== undefined) {
        const renamed = await setHostname(
          { host: server.host, user: server.user, port: server.port },
          server.keyPath,
          created.fqdn ?? server.name,
        )
        hostnameOk = renamed.ok
        hostnameDetail = renamed.detail
      }
      const written = store.upsertServer({
        id: server.id,
        name: server.name,
        host: server.host,
        user: server.user,
        port: server.port,
        ...(server.keyPath === undefined ? {} : { keyPath: server.keyPath }),
        passwordDisabled: server.passwordDisabled ?? false,
        zone,
        hostname: created.fqdn ?? server.name,
        ...(server.defaultWorkdir === undefined ? {} : { defaultWorkdir: server.defaultWorkdir }),
      })
      ok(res, {
        fqdn: created.fqdn,
        hostnameOk,
        hostnameDetail,
        server: written.value === undefined ? undefined : serverView(written.value),
      })
      return true
    }

    if (collection === 'servers' && id !== undefined && verb === 'dns' && method === 'DELETE') {
      const server = store.listServers().find((entry) => entry.id === id)
      if (server === undefined || server.hostname === undefined) {
        fail(res, 404, 'not-found', 'no DNS record recorded for that server')
        return true
      }
      const removed = await deleteRecord(cloudflareConfig(home), server.hostname)
      ok(res, removed)
      return true
    }

    // Step 4: pull the chosen images onto the server.
    if (collection === 'servers' && id !== undefined && verb === 'images' && method === 'POST') {
      const server = store.listServers().find((entry) => entry.id === id)
      if (server === undefined || server.keyPath === undefined) {
        fail(res, 404, 'not-found', 'no secured server with that id')
        return true
      }
      const input = await readBody(req)
      const references = Array.isArray(input.references)
        ? input.references.filter((entry): entry is string => typeof entry === 'string')
        : []
      const credentials = { host: server.host, user: server.user, port: server.port }
      const results = []
      for (const reference of references) {
        results.push({ reference, ...(await pullRemoteImage(credentials, server.keyPath, reference)) })
      }
      ok(res, { results })
      return true
    }

    // Step 5: the default workspace folder.
    if (collection === 'servers' && id !== undefined && verb === 'workdir' && method === 'POST') {
      const server = store.listServers().find((entry) => entry.id === id)
      if (server === undefined) {
        fail(res, 404, 'not-found', 'no such server')
        return true
      }
      const input = await readBody(req)
      const directory = String(input.directory ?? '').trim()
      if (directory.length === 0) {
        fail(res, 400, 'invalid-workdir', 'a folder path is required')
        return true
      }
      let detail = 'folder saved'
      let ok2 = true
      if (server.keyPath !== undefined) {
        const ensured = await ensureWorkdir(
          { host: server.host, user: server.user, port: server.port },
          server.keyPath,
          directory,
        )
        ok2 = ensured.ok
        detail = ensured.detail
      }
      if (!ok2) {
        fail(res, 400, 'workdir', detail)
        return true
      }
      store.upsertServer({
        id: server.id,
        name: server.name,
        host: server.host,
        user: server.user,
        port: server.port,
        ...(server.keyPath === undefined ? {} : { keyPath: server.keyPath }),
        passwordDisabled: server.passwordDisabled ?? false,
        ...(server.zone === undefined ? {} : { zone: server.zone }),
        ...(server.hostname === undefined ? {} : { hostname: server.hostname }),
        defaultWorkdir: directory,
      })
      // Server-scoped: this is a folder on the remote machine, not this one.
      store.setSetting(`serverWorkdir:${server.id}`, directory)
      ok(res, { detail, directory })
      return true
    }

    // ------------------------------------------------------------ functions
    if (collection === 'functions' && id === undefined) {
      if (method === 'GET') {
        ok(res, { functions: store.listFunctions() })
        return true
      }
      if (method === 'POST') {
        const input = await readBody(req)
        const written = store.upsertFunction(functionInput(input))
        if (written.error !== undefined) {
          fail(res, 400, 'invalid-function', written.error)
          return true
        }
        ok(res, { function: written.value }, 201)
        return true
      }
      fail(res, 405, 'method', 'use GET or POST')
      return true
    }

    if (collection === 'functions' && id !== undefined && verb === undefined) {
      if (method === 'PUT' || method === 'PATCH') {
        const input = await readBody(req)
        const written = store.upsertFunction(functionInput(input, id))
        if (written.error !== undefined) {
          fail(res, 400, 'invalid-function', written.error)
          return true
        }
        ok(res, { function: written.value })
        return true
      }
      if (method === 'DELETE') {
        ok(res, { removed: store.removeFunction(id) })
        return true
      }
      fail(res, 405, 'method', 'use PUT or DELETE')
      return true
    }

    // Assign (or clear) an image's function.
    if (collection === 'images' && id !== undefined && verb === 'function' && method === 'PUT') {
      const input = await readBody(req)
      const image = store.listImages().find((entry) => entry.id === id)
      if (image === undefined) {
        fail(res, 404, 'not-found', 'no such image')
        return true
      }
      const functionId = input.functionId === undefined || input.functionId === null
        ? null
        : String(input.functionId)
      if (functionId !== null && !store.listFunctions().some((fn) => fn.id === functionId)) {
        fail(res, 400, 'invalid-function', 'no such function')
        return true
      }
      const written = store.upsertImage({
        reference: image.reference,
        description: image.description,
        source: image.source,
        ...(image.latest === undefined ? {} : { latest: image.latest }),
        functionId,
      })
      ok(res, { image: written.value })
      return true
    }

    // Import a JSON document of images (and optionally functions).
    if (collection === 'images' && id === 'import' && method === 'POST') {
      const input = await readBody(req)
      const text = typeof input.json === 'string'
        ? input.json
        : JSON.stringify(input.document ?? {})
      const parsed = parseImageImport(text)
      if (parsed.error !== undefined) {
        fail(res, 400, 'invalid-import', parsed.error)
        return true
      }
      // Preview mode: report what would happen without writing.
      if (input.commit !== true) {
        ok(res, {
          preview: true,
          images: parsed.images,
          functions: parsed.functions,
          rejected: parsed.rejected,
        })
        return true
      }
      // Declared functions first, so images can reference them by name.
      const createdFunctions: string[] = []
      const byName = new Map(store.listFunctions().map((fn) => [fn.name.toLowerCase(), fn.id]))
      for (const fn of parsed.functions) {
        const written = store.upsertFunction(fn)
        if (written.error === undefined && written.value !== undefined) {
          byName.set(fn.name.toLowerCase(), written.value.id)
          createdFunctions.push(fn.name)
        }
      }
      let added = 0
      const failed: Array<{ reference: string; reason: string }> = []
      for (const image of parsed.images) {
        // An inline function name also creates the function, so one file can
        // carry everything without a second top-level declaration.
        if (image.functionName !== undefined && image.functionName.length > 0) {
          const key = image.functionName.toLowerCase()
          if (!byName.has(key)) {
            const written = store.upsertFunction({
              name: image.functionName,
              ...(image.dnsTemplate === undefined ? {} : { dnsTemplate: image.dnsTemplate }),
              ...(image.port === undefined ? {} : { port: image.port }),
            })
            if (written.value !== undefined) {
              byName.set(key, written.value.id)
              createdFunctions.push(image.functionName)
            }
          } else if (image.dnsTemplate !== undefined) {
            // An existing function gains the template the file carries.
            const existingId = byName.get(key)
            const existing = store.listFunctions().find((fn) => fn.id === existingId)
            if (existing !== undefined) {
              store.upsertFunction({
                id: existing.id,
                name: existing.name,
                description: existing.description,
                dnsTemplate: image.dnsTemplate,
                ...(image.port === undefined ? {} : { port: image.port }),
              })
            }
          }
        }
        const written = store.upsertImage({
          reference: image.reference,
          description: image.description ?? '',
          source: 'manual',
          ...(image.functionName === undefined
            ? {}
            : { functionId: byName.get(image.functionName.toLowerCase()) ?? null }),
        })
        if (written.error === undefined) added += 1
        else failed.push({ reference: image.reference, reason: written.error })
      }
      ok(res, {
        added,
        failed,
        functions: createdFunctions,
        rejected: parsed.rejected,
      })
      return true
    }

    // Docker availability on THIS machine, so the screen can say what it sees.
    if (collection === 'docker' && method === 'GET') {
      const discovered = await discoverLocalImages()
      ok(res, {
        available: discovered.reason === undefined,
        reason: discovered.reason,
        imageCount: discovered.images.length,
        images: discovered.images.map((entry) => entry.reference),
      })
      return true
    }

    // --------------------------------------------------- project templates
    // Reserved sub-resources, listed before the by-id branch so they are not
    // read as template ids (the shadowing bug this file has hit before).
    if (collection === 'templates' && id === 'inspect' && method === 'POST') {
      const input = await readBody(req)
      const repo = String(input.repo ?? '')
      const detailsPath = String(input.detailsPath ?? 'project-details')
      const ref = input.ref === undefined ? undefined : String(input.ref)
      const inspection = await inspectTemplate(repo, detailsPath, ref)
      ok(res, { inspection })
      return true
    }

    // Create a NEW template authored locally: a workspace on disk, registered
    // as a template. Distinct from POST /templates, which records a template
    // that already exists in a repository.
    // Is this template's folder free? Checked as a separate call so the wizard
    // can report availability BEFORE the operator commits to creating anything.
    if (collection === 'templates' && id === 'check' && method === 'POST') {
      const input = await readBody(req)
      const name = String(input.name ?? '').trim()
      const slug = slugifyTemplateName(name)
      if (slug.length === 0) {
        ok(res, {
          slug,
          path: '',
          available: false,
          reason: 'that name produces an empty folder name',
        })
        return true
      }
      const configured = store.getSetting(TEMPLATE_HOME_KEY)
      const parent = String(
        input.parent ?? (typeof configured === 'string' ? configured : ''),
      ).trim()
      if (parent.length === 0) {
        ok(res, {
          slug,
          path: '',
          available: false,
          reason: 'set a default workspace folder in Settings first',
        })
        return true
      }
      const target = join(parent, slug)
      let exists = false
      try {
        exists = existsSync(target)
      } catch {
        exists = false
      }
      // A path that cannot be written is unavailable even when nothing is there,
      // so the wizard does not promise a folder the host will then refuse.
      let writable = true
      try {
        accessSync(parent, constants.W_OK)
      } catch {
        writable = false
      }
      ok(res, {
        slug,
        path: target,
        available: !exists && writable,
        reason: exists
          ? 'that folder already exists'
          : writable
            ? undefined
            : `the template folder is not writable: ${parent}`,
      })
      return true
    }

    if (collection === 'templates' && id === 'new' && method === 'POST') {
      const input = await readBody(req)
      const name = String(input.name ?? '').trim()
      if (name.length === 0) {
        fail(res, 400, 'invalid-template', 'a template name is required')
        return true
      }
      // The details folder is fixed by the template's shape and is not a choice
      // here: it is always `project-details`.
      const detailsPath = 'project-details'
      // The destination comes from the plugin setting, chosen in the Settings
      // tab. A per-call override is still accepted so a caller that already
      // knows where it wants the template can say so.
      const configured = store.getSetting(TEMPLATE_HOME_KEY)
      const requested = String(
        input.parent ?? (typeof configured === 'string' ? configured : ''),
      ).trim()
      if (requested.length === 0) {
        fail(
          res,
          400,
          'no-template-home',
          'set a default workspace folder in Settings before creating a template',
        )
        return true
      }
      // Absolute only: a relative path would resolve against the plugin's own
      // working directory, which is not the folder the operator picked.
      if (!requested.startsWith('/')) {
        fail(res, 400, 'invalid-parent', 'the template folder must be an absolute path')
        return true
      }
      const parent = requested
      try {
        mkdirSync(parent, { recursive: true, mode: 0o755 })
      } catch (error) {
        fail(res, 400, 'invalid-parent', `cannot use ${parent}: ${(error as Error).message}`)
        return true
      }

      // Check the slug before creating anything. `createTemplateWorkspace` also
      // refuses a collision, but doing it here lets the UI name the folder it
      // would have used, which is the actually useful message.
      const slug = slugifyTemplateName(name)
      if (slug.length === 0) {
        fail(res, 400, 'invalid-template', 'that name produces an empty folder name')
        return true
      }
      if (existsSync(join(parent, slug))) {
        fail(res, 409, 'folder-in-use', `${join(parent, slug)} is already in use; choose another name`)
        return true
      }
      const created = await createTemplateWorkspace(parent, name, String(input.repo ?? ''))
      if (created.path === undefined) {
        fail(res, 400, 'template-workspace', created.error ?? 'could not create the template')
        return true
      }
      // A git failure keeps the files and reports why, so the template is usable
      // and the operator can finish the commit by hand.
      const warning = created.error
      const written = store.upsertTemplate({
        name,
        description: String(input.description ?? ''),
        repo: created.path,
        detailsPath,
        inspection: { found: true },
      })
      if (written.error !== undefined) {
        fail(res, 400, 'invalid-template', written.error)
        return true
      }
      changes?.publish({ kind: 'templates' })
      ok(
        res,
        { template: written.value, path: created.path, ...(warning === undefined ? {} : { warning }) },
        201,
      )
      return true
    }

    if (collection === 'templates' && id === undefined) {
      if (method === 'GET') {
        ok(res, { templates: store.listTemplates() })
        return true
      }
      if (method === 'POST') {
        const input = await readBody(req)
        // Inspect on save so a template's badge reflects reality rather than an
        // optimistic guess. A failure is recorded, not fatal: a repository that
        // is temporarily unreachable must not block saving the template.
        const repo = String(input.repo ?? '')
        const detailsPath = String(input.detailsPath ?? 'project-details')
        const ref = input.ref === undefined ? undefined : String(input.ref)
        let inspection: { found: boolean; note?: string } | undefined
        if (repo.trim().length > 0 && input.skipInspect !== true) {
          const checked = await inspectTemplate(repo, detailsPath, ref)
          inspection = {
            found: checked.found,
            ...(checked.error === undefined
              ? checked.warnings.length === 0
                ? {}
                : { note: checked.warnings.join('; ') }
              : { note: checked.error }),
          }
        }
        const written = store.upsertTemplate({
          name: String(input.name ?? ''),
          description: String(input.description ?? ''),
          repo,
          detailsPath,
          ...(ref === undefined || ref.trim().length === 0 ? {} : { ref }),
          ...(inspection === undefined ? {} : { inspection }),
        })
        if (written.error !== undefined) {
          fail(res, 400, 'invalid-template', written.error)
          return true
        }
        ok(res, { template: written.value }, 201)
        return true
      }
      fail(res, 405, 'method', 'use GET or POST')
      return true
    }

    if (collection === 'templates' && id !== undefined && verb === undefined
      && !TEMPLATE_SUBRESOURCES.has(id)) {
      if (method === 'PUT' || method === 'PATCH') {
        const input = await readBody(req)
        const existing = store.listTemplates().find((entry) => entry.id === id)
        if (existing === undefined) {
          fail(res, 404, 'not-found', 'no such template')
          return true
        }
        const repo = String(input.repo ?? existing.repo)
        const detailsPath = String(input.detailsPath ?? existing.detailsPath)
        const ref = input.ref === undefined ? existing.ref : String(input.ref)
        let inspection: { found: boolean; note?: string } | undefined
        // Re-inspect when the repository or folder changed, since the previous
        // result no longer describes the template.
        if (input.skipInspect !== true && (repo !== existing.repo || detailsPath !== existing.detailsPath || ref !== existing.ref)) {
          const checked = await inspectTemplate(repo, detailsPath, ref)
          inspection = {
            found: checked.found,
            ...(checked.error === undefined
              ? checked.warnings.length === 0
                ? {}
                : { note: checked.warnings.join('; ') }
              : { note: checked.error }),
          }
        }
        const written = store.upsertTemplate({
          id,
          name: String(input.name ?? existing.name),
          description: String(input.description ?? existing.description),
          repo,
          detailsPath,
          ...(ref === undefined || ref.trim().length === 0 ? {} : { ref }),
          enabled: input.enabled === undefined ? existing.enabled : input.enabled === true,
          ...(inspection === undefined ? {} : { inspection }),
        })
        if (written.error !== undefined) {
          fail(res, 400, 'invalid-template', written.error)
          return true
        }
        ok(res, { template: written.value })
        return true
      }
      if (method === 'DELETE') {
        const removed = store.removeTemplate(id)
        if (removed) changes?.publish({ kind: 'templates' })
        ok(res, { removed })
        return true
      }
      fail(res, 405, 'method', 'use PUT or DELETE')
      return true
    }

    // --------------------------------------------------------- credentials
    // Test a token without saving it, so the operator can validate before the
    // value becomes the stored one.
    if (collection === 'credentials' && id === 'test' && method === 'POST') {
      const input = await readBody(req)
      const token = String(input.token ?? '')
      // An empty token tests the stored one, which is the common case: the
      // browser never receives the secret back, so it cannot resend it.
      const effective = token.trim().length > 0 ? token : (cloudflareConfig(home)['token'] ?? '')
      const tested = await testToken(effective)
      ok(res, tested)
      return true
    }

    // List zones a token can see, for the zone picker.
    if (collection === 'credentials' && id === 'zones' && method === 'POST') {
      const input = await readBody(req)
      const token = String(input.token ?? '')
      const stored = cloudflareConfig(home)
      const effective = token.trim().length > 0 ? token : (stored['token'] ?? '')
      if (effective.trim().length === 0) {
        fail(res, 400, 'no-token', 'store a Cloudflare API token first')
        return true
      }
      // List every visible zone regardless of the saved allowlist, so the UI can
      // show what is available to select, not only what is already selected.
      const listed = await listZones({ token: effective })
      const selected = (stored['zones'] ?? '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0)
      ok(res, { zones: listed.zones, selected, error: listed.error })
      return true
    }

    if (collection === 'credentials' && id === undefined) {
      if (method === 'GET') {
        ok(res, { credentials: store.listCredentials().map(credentialView) })
        return true
      }
      fail(res, 405, 'method', 'use GET')
      return true
    }

    if (collection === 'credentials' && id !== undefined && verb === undefined) {
      if (method === 'PUT' || method === 'POST') {
        const input = await readBody(req)
        const patch: Record<string, string> = {}
        for (const [key, value] of Object.entries(input)) {
          if (typeof value === 'string') patch[key] = value
        }
        const written = store.upsertCredential(id, patch)
        ok(res, { credential: credentialView(written) })
        return true
      }
      if (method === 'DELETE') {
        ok(res, { removed: store.removeCredential(id) })
        return true
      }
      fail(res, 405, 'method', 'use PUT or DELETE')
      return true
    }

    // ----------------------------------------------------------- settings
    if (collection === 'settings' && id === undefined) {
      if (method === 'GET') {
        ok(res, {
          settings: store.listSettings(),
          // The folder new project templates are created in.
          templateHome: store.getSetting(TEMPLATE_HOME_KEY),
        })
        return true
      }
      if (method === 'PUT') {
        const input = await readBody(req)
        const key = String(input.key ?? '')
        if (key.length === 0) {
          fail(res, 400, 'invalid-setting', 'a key is required')
          return true
        }
        const value = input.value
        store.setSetting(key, value === undefined ? null : (value as string | number | boolean | null))
        ok(res, { settings: store.listSettings() })
        return true
      }
      fail(res, 405, 'method', 'use GET or PUT')
      return true
    }

    return false
  } finally {
    store.close()
  }
}
