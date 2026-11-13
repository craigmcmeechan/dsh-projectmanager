/**
 * The plugin-wide store: one SQLite file for the whole installation.
 *
 * Separate from the per-project database because these records belong to the
 * plugin, not to a project: the image catalogue, the remote servers the plugin
 * can provision, and installation-wide settings such as the default folder.
 *
 * Uses Node's built-in `node:sqlite`, so there is no native dependency.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, sep } from 'node:path'
import type {
  DockerImageRecord,
  ImageFunctionRecord,
  MachineCredentialRecord,
  ProjectTemplateRecord,
  RemoteServerRecord,
  SettingRecord,
} from './store.types.ts'
import type { ServerFacts, SettingValue, StoreWriteResult } from './store.interface.ts'
import { STORE_SCHEMA } from './store.schema.ts'

/** Stable key for the default workspace folder setting. */
/**
 * Setting key for the folder new project templates are created in.
 *
 * Distinct from a remote server's `defaultWorkdir`: that one is a folder on
 * another machine, while this is a local folder for templates. Sharing a key
 * would make saving one silently move the other.
 */
export const TEMPLATE_HOME_KEY = 'templateHome'

/** Create a stable id with a type prefix. */
function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Parse a stored config blob, tolerating corruption. */
function parseConfig(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value
      else if (value !== undefined && value !== null) out[key] = String(value)
    }
    return out
  } catch {
    return {}
  }
}

/** Split `repo:tag` into its parts, defaulting the tag to `latest`. */
export function splitReference(reference: string): { repository: string; tag: string } {
  const trimmed = reference.trim()
  const colon = trimmed.lastIndexOf(':')
  const slash = trimmed.lastIndexOf('/')
  // A colon before the last slash is a registry port, not a tag.
  if (colon <= slash || colon === -1) return { repository: trimmed, tag: 'latest' }
  return { repository: trimmed.slice(0, colon), tag: trimmed.slice(colon + 1) }
}

/**
 * The plugin-wide store.
 *
 * Opening is cheap and idempotent: the schema is applied with `IF NOT EXISTS`,
 * so an older store gains new tables without a migration step.
 */
export class PluginStore {
  readonly file: string
  private readonly db: DatabaseSync

  /** @param file - absolute path to the store database. */
  constructor(file: string) {
    this.file = file
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(file)
    this.db.exec(STORE_SCHEMA)
    this.migrate()
  }

  /**
   * Bring an older store up to the current shape.
   *
   * `CREATE TABLE IF NOT EXISTS` adds new tables but never new columns, so a
   * store created before `function_id` existed would fail every image query with
   * "no such column". Checked with `PRAGMA table_info` and added once.
   */
  private migrate(): void {
    const columns = this.db.prepare('PRAGMA table_info(docker_image)').all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'function_id')) {
      this.db.exec('ALTER TABLE docker_image ADD COLUMN function_id TEXT')
    }
  }

  /** Close the database. */
  close(): void {
    this.db.close()
  }

  // ------------------------------------------------------------- settings

  /** Read one setting. */
  getSetting(key: string): SettingValue {
    const row = this.db.prepare('SELECT value FROM plugin_setting WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    if (row === undefined) return null
    try {
      return JSON.parse(row.value) as SettingValue
    } catch {
      // A non-JSON value is stored by hand; return it as text rather than throw.
      return row.value
    }
  }

  /** Write one setting. */
  setSetting(key: string, value: SettingValue): void {
    this.db
      .prepare(
        `INSERT INTO plugin_setting (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), Date.now())
  }

  /** Every setting, for the management screen. */
  listSettings(): SettingRecord[] {
    const rows = this.db
      .prepare('SELECT key, value, updated_at FROM plugin_setting ORDER BY key')
      .all() as Array<{ key: string; value: string; updated_at: number }>
    return rows.map((row) => ({ key: row.key, value: row.value, updatedAt: row.updated_at }))
  }

  // ---------------------------------------------------------- docker images

  /** Every catalogue entry. */
  listImages(): DockerImageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, reference, repository, tag, description, source, latest, checked_at,
                function_id, created_at
         FROM docker_image ORDER BY repository, tag`,
      )
      .all() as Array<{
        id: string
        reference: string
        repository: string
        tag: string
        description: string
        source: string
        latest: string | null
        checked_at: number | null
        function_id: string | null
        created_at: number
      }>
    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      repository: row.repository,
      tag: row.tag,
      description: row.description,
      source: row.source as DockerImageRecord['source'],
      ...(row.latest === null ? {} : { latest: row.latest }),
      ...(row.checked_at === null ? {} : { checkedAt: row.checked_at }),
      ...(row.function_id === null ? {} : { functionId: row.function_id }),
      createdAt: row.created_at,
    }))
  }

  /**
   * Add or update one image by reference.
   *
   * Upsert rather than plain insert: seeding from the local Docker daemon and
   * re-seeding after a pull must not fail on rows that already exist.
   * @param input - the reference and its optional metadata.
   * @returns the stored record, or a validation error.
   */
  upsertImage(input: {
    reference: string
    description?: string
    source?: DockerImageRecord['source']
    latest?: string
    /**
     * The function to group this image under.
     *
     * `null` clears the grouping; omitting it leaves the stored value alone, so
     * a registry refresh does not silently ungroup an image.
     */
    functionId?: string | null
  }): StoreWriteResult<DockerImageRecord> {
    const reference = input.reference.trim()
    if (reference.length === 0) return { error: 'an image reference is required' }
    if (/\s/.test(reference)) return { error: 'an image reference cannot contain spaces' }
    const { repository, tag } = splitReference(reference)
    if (repository.length === 0) return { error: 'an image reference needs a repository' }

    const existing = this.db
      .prepare('SELECT id, created_at, function_id FROM docker_image WHERE reference = ?')
      .get(reference) as { id: string; created_at: number; function_id: string | null } | undefined

    // `functionId` has three meanings: a string sets, null clears, undefined
    // leaves the stored value alone (a registry refresh must not ungroup).
    const resolvedFunctionId = input.functionId === undefined
      ? (existing?.function_id ?? null)
      : input.functionId

    const record: DockerImageRecord = {
      id: existing?.id ?? id('img'),
      reference,
      repository,
      tag,
      description: input.description?.trim() ?? '',
      source: input.source ?? 'manual',
      ...(input.latest === undefined ? {} : { latest: input.latest }),
      ...(resolvedFunctionId === null ? {} : { functionId: resolvedFunctionId }),
      checkedAt: Date.now(),
      createdAt: existing?.created_at ?? Date.now(),
    }

    this.db
      .prepare(
        `INSERT INTO docker_image
           (id, reference, repository, tag, description, source, latest, checked_at,
            function_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(reference) DO UPDATE SET
           description = excluded.description,
           latest      = excluded.latest,
           checked_at  = excluded.checked_at,
           -- A supplied id sets the grouping; an explicit NULL clears it; an
           -- omitted field (undefined) must leave it alone. COALESCE cannot
           -- express the third case, so the caller passes the current value
           -- through when it means "unchanged" (see upsertImage).
           function_id = excluded.function_id`,
      )
      .run(
        record.id,
        record.reference,
        record.repository,
        record.tag,
        record.description,
        record.source,
        record.latest ?? null,
        record.checkedAt ?? null,
        resolvedFunctionId,
        record.createdAt,
      )
    return { value: record }
  }

  /** Remove one image by id. */
  removeImage(imageId: string): boolean {
    const result = this.db.prepare('DELETE FROM docker_image WHERE id = ?').run(imageId)
    return Number(result.changes) > 0
  }

  // --------------------------------------------------------- remote servers

  /** Every server, newest first. */
  listServers(): RemoteServerRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, host, user, port, key_path, password_disabled, zone, hostname,
                default_workdir, facts, created_at, updated_at
         FROM remote_server ORDER BY created_at DESC`,
      )
      .all() as Array<{
        id: string
        name: string
        host: string
        user: string
        port: number
        key_path: string | null
        password_disabled: number
        zone: string | null
        hostname: string | null
        default_workdir: string | null
        facts: string | null
        created_at: number
        updated_at: number
      }>
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      host: row.host,
      user: row.user,
      port: row.port,
      ...(row.key_path === null ? {} : { keyPath: row.key_path }),
      passwordDisabled: row.password_disabled === 1,
      ...(row.zone === null ? {} : { zone: row.zone }),
      ...(row.hostname === null ? {} : { hostname: row.hostname }),
      ...(row.default_workdir === null ? {} : { defaultWorkdir: row.default_workdir }),
      ...(row.facts === null ? {} : { facts: row.facts }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  /**
   * Add or update a remote server.
   *
   * The name must be distinct because it is the DNS hostname label: two servers
   * sharing a name could not both be addressed, and the second would silently
   * overwrite the first's DNS record.
   * @param input - the server's identity and options.
   * @returns the stored record, or a validation error.
   */
  upsertServer(input: {
    id?: string
    name: string
    host: string
    user: string
    port?: number
    keyPath?: string
    passwordDisabled?: boolean
    zone?: string
    hostname?: string
    defaultWorkdir?: string
    facts?: ServerFacts
  }): StoreWriteResult<RemoteServerRecord> {
    const name = input.name.trim()
    const host = input.host.trim()
    const user = input.user.trim()

    if (name.length === 0) return { error: 'a server name is required' }
    // The name becomes a DNS label, so it must already be a valid one.
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(name)) {
      return { error: 'use letters, digits, and hyphens; the name becomes a DNS hostname label' }
    }
    if (host.length === 0) return { error: 'an IP address or hostname is required' }
    if (user.length === 0) return { error: 'an SSH user is required' }
    const port = input.port ?? 22
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'port must be 1–65535' }

    const clash = this.db
      .prepare('SELECT id FROM remote_server WHERE name = ? COLLATE NOCASE')
      .get(name) as { id: string } | undefined
    if (clash !== undefined && clash.id !== input.id) {
      return { error: `a server named "${name}" already exists` }
    }

    const existing =
      input.id === undefined
        ? undefined
        : (this.db
            .prepare('SELECT * FROM remote_server WHERE id = ?')
            .get(input.id) as Record<string, unknown> | undefined)

    const record: RemoteServerRecord = {
      id: input.id ?? id('srv'),
      name,
      host,
      user,
      port,
      ...(input.keyPath === undefined ? {} : { keyPath: input.keyPath }),
      passwordDisabled: input.passwordDisabled ?? false,
      ...(input.zone === undefined ? {} : { zone: input.zone }),
      ...(input.hostname === undefined ? {} : { hostname: input.hostname }),
      ...(input.defaultWorkdir === undefined ? {} : { defaultWorkdir: input.defaultWorkdir }),
      ...(input.facts === undefined ? {} : { facts: JSON.stringify(input.facts) }),
      createdAt: (existing?.['created_at'] as number | undefined) ?? Date.now(),
      updatedAt: Date.now(),
    }

    this.db
      .prepare(
        `INSERT INTO remote_server
           (id, name, host, user, port, key_path, password_disabled, zone, hostname,
            default_workdir, facts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name              = excluded.name,
           host              = excluded.host,
           user              = excluded.user,
           port              = excluded.port,
           key_path          = excluded.key_path,
           password_disabled = excluded.password_disabled,
           zone              = excluded.zone,
           hostname          = excluded.hostname,
           default_workdir   = excluded.default_workdir,
           facts             = excluded.facts,
           updated_at        = excluded.updated_at`,
      )
      .run(
        record.id,
        record.name,
        record.host,
        record.user,
        record.port,
        record.keyPath ?? null,
        record.passwordDisabled === true ? 1 : 0,
        record.zone ?? null,
        record.hostname ?? null,
        record.defaultWorkdir ?? null,
        record.facts ?? null,
        record.createdAt,
        record.updatedAt,
      )
    return { value: record }
  }

  /** Remove one server by id. */
  removeServer(serverId: string): boolean {
    const result = this.db.prepare('DELETE FROM remote_server WHERE id = ?').run(serverId)
    return Number(result.changes) > 0
  }

  // -------------------------------------------------------- image functions

  /** Every function, with how many images it groups. */
  listFunctions(): Array<ImageFunctionRecord & { imageCount: number }> {
    const rows = this.db
      .prepare(
        `SELECT f.id, f.name, f.description, f.dns_template, f.port, f.created_at, f.updated_at,
                (SELECT COUNT(*) FROM docker_image i WHERE i.function_id = f.id) AS image_count
         FROM image_function f ORDER BY f.name COLLATE NOCASE`,
      )
      .all() as Array<{
        id: string
        name: string
        description: string
        dns_template: string | null
        port: number | null
        created_at: number
        updated_at: number
        image_count: number
      }>
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      ...(row.dns_template === null ? {} : { dnsTemplate: row.dns_template }),
      ...(row.port === null ? {} : { port: row.port }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      imageCount: row.image_count,
    }))
  }

  /**
   * Add or rename a function.
   *
   * The name must be distinct because the DNS template is addressed by it: two
   * functions called "Keycloak" would make the template ambiguous.
   * @param input - the function's identity and template.
   * @returns the stored record, or a validation error.
   */
  upsertFunction(input: {
    id?: string
    name: string
    description?: string
    dnsTemplate?: string | null
    port?: number | null
  }): StoreWriteResult<ImageFunctionRecord> {
    const name = input.name.trim()
    if (name.length === 0) return { error: 'a function name is required' }
    if (name.length > 60) return { error: 'a function name must be 60 characters or fewer' }

    const template = input.dnsTemplate?.trim()
    if (template !== undefined && template.length > 0) {
      // The template is interpolated into a DNS name, so it may only contain
      // characters a hostname may contain plus the two placeholders.
      const stripped = template.replaceAll('{name}', 'x').replaceAll('{zone}', 'y')
      if (!/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i.test(stripped)) {
        return {
          error: 'the template may use letters, digits, dots, dashes, and the {name} / {zone} placeholders',
        }
      }
    }
    if (input.port !== undefined && input.port !== null) {
      if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
        return { error: 'port must be 1–65535' }
      }
    }

    const clash = this.db
      .prepare('SELECT id FROM image_function WHERE name = ? COLLATE NOCASE')
      .get(name) as { id: string } | undefined
    if (clash !== undefined && clash.id !== input.id) {
      return { error: `a function named "${name}" already exists` }
    }

    const existing =
      input.id === undefined
        ? undefined
        : (this.db.prepare('SELECT * FROM image_function WHERE id = ?').get(input.id) as
            | { created_at: number }
            | undefined)

    const record: ImageFunctionRecord = {
      id: input.id ?? id('fn'),
      name,
      description: input.description?.trim() ?? '',
      ...(template === undefined || template.length === 0 ? {} : { dnsTemplate: template }),
      ...(input.port === undefined || input.port === null ? {} : { port: input.port }),
      createdAt: existing?.created_at ?? Date.now(),
      updatedAt: Date.now(),
    }

    this.db
      .prepare(
        `INSERT INTO image_function
           (id, name, description, dns_template, port, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name         = excluded.name,
           description  = excluded.description,
           dns_template = excluded.dns_template,
           port         = excluded.port,
           updated_at   = excluded.updated_at`,
      )
      .run(
        record.id,
        record.name,
        record.description,
        record.dnsTemplate ?? null,
        record.port ?? null,
        record.createdAt,
        record.updatedAt,
      )
    return { value: record }
  }

  /**
   * Remove a function.
   *
   * Images are ungrouped rather than deleted: the catalogue is the operator's
   * list, and removing a label must not silently discard entries.
   * @returns whether a row was removed.
   */
  removeFunction(functionId: string): boolean {
    this.db.prepare('UPDATE docker_image SET function_id = NULL WHERE function_id = ?').run(functionId)
    const result = this.db.prepare('DELETE FROM image_function WHERE id = ?').run(functionId)
    return Number(result.changes) > 0
  }

  // ------------------------------------------------------- machine credentials

  /**
   * Every credential block for this machine.
   *
   * Returned raw (secrets included) because the caller is the host; the route
   * masks them before they reach a browser via {@link credentialView}.
   */
  listCredentials(): MachineCredentialRecord[] {
    const rows = this.db
      .prepare('SELECT provider, config, updated_at FROM machine_credential ORDER BY provider')
      .all() as Array<{ provider: string; config: string; updated_at: number }>
    return rows.map((row) => ({
      provider: row.provider,
      config: parseConfig(row.config),
      updatedAt: row.updated_at,
    }))
  }

  /**
   * Write one provider's credentials.
   *
   * Merges into the existing block rather than replacing it, so saving only the
   * Cloudflare token does not erase the account id. A key passed as an empty
   * string is treated as "clear it"; a key omitted keeps its stored value.
   * @param provider - provider key.
   * @param patch - fields to set.
   */
  upsertCredential(provider: string, patch: Record<string, string>): MachineCredentialRecord {
    const existing = this.db
      .prepare('SELECT config FROM machine_credential WHERE provider = ?')
      .get(provider) as { config: string } | undefined
    const merged: Record<string, string> = { ...parseConfig(existing?.config ?? '{}') }
    for (const [key, value] of Object.entries(patch)) {
      if (value.length === 0) delete merged[key]
      else merged[key] = value
    }
    this.db
      .prepare(
        `INSERT INTO machine_credential (provider, config, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`,
      )
      .run(provider, JSON.stringify(merged), Date.now())
    return { provider, config: merged, updatedAt: Date.now() }
  }

  /** Remove one provider's credentials entirely. */
  removeCredential(provider: string): boolean {
    const result = this.db.prepare('DELETE FROM machine_credential WHERE provider = ?').run(provider)
    return Number(result.changes) > 0
  }

  // ------------------------------------------------------- project templates

  /** Every template, newest first. */
  listTemplates(): ProjectTemplateRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, description, repo, ref, details_path, details_found, details_note,
                inspected_at, enabled, created_at, updated_at
         FROM project_template ORDER BY name COLLATE NOCASE`,
      )
      .all() as Array<{
        id: string
        name: string
        description: string
        repo: string
        ref: string | null
        details_path: string
        details_found: number
        details_note: string | null
        inspected_at: number | null
        enabled: number
        created_at: number
        updated_at: number
      }>
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      repo: row.repo,
      ...(row.ref === null ? {} : { ref: row.ref }),
      detailsPath: row.details_path,
      detailsFound: row.details_found === 1,
      ...(row.details_note === null ? {} : { detailsNote: row.details_note }),
      ...(row.inspected_at === null ? {} : { inspectedAt: row.inspected_at }),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  /**
   * Add or update a project template.
   *
   * The name must be distinct: it is how a template is chosen when creating a
   * project, so two called the same would be ambiguous.
   * @param input - the template's identity and repository.
   * @returns the stored record, or a validation error.
   */
  upsertTemplate(input: {
    id?: string
    name: string
    description?: string
    repo: string
    ref?: string | null
    detailsPath?: string
    enabled?: boolean
    inspection?: { found: boolean; note?: string }
  }): StoreWriteResult<ProjectTemplateRecord> {
    const name = input.name.trim()
    const repo = input.repo.trim()
    if (name.length === 0) return { error: 'a template name is required' }
    if (repo.length === 0) return { error: 'a repository path or URL is required' }
    if (/\s/.test(repo) && !repo.includes('/') && !repo.includes(sep)) {
      return { error: 'a repository path cannot contain spaces' }
    }

    const detailsPath = (input.detailsPath ?? 'project details').trim() || 'project details'
    // The folder is read inside a clone, so it must stay relative to the root.
    if (detailsPath.startsWith('/') || detailsPath.split('/').includes('..')) {
      return { error: 'the details folder must be a path inside the repository' }
    }

    const clash = this.db
      .prepare('SELECT id FROM project_template WHERE name = ? COLLATE NOCASE')
      .get(name) as { id: string } | undefined
    if (clash !== undefined && clash.id !== input.id) {
      return { error: `a template named "${name}" already exists` }
    }

    const existing =
      input.id === undefined
        ? undefined
        : (this.db.prepare('SELECT * FROM project_template WHERE id = ?').get(input.id) as
            | Record<string, unknown>
            | undefined)

    const record: ProjectTemplateRecord = {
      id: input.id ?? id('tpl'),
      name,
      description: input.description?.trim() ?? '',
      repo,
      ...(input.ref === undefined || input.ref === null || input.ref.trim().length === 0
        ? {}
        : { ref: input.ref.trim() }),
      detailsPath,
      detailsFound: input.inspection?.found ?? false,
      ...(input.inspection?.note === undefined ? {} : { detailsNote: input.inspection.note }),
      ...(input.inspection === undefined ? {} : { inspectedAt: Date.now() }),
      enabled: input.enabled ?? true,
      createdAt: (existing?.['created_at'] as number | undefined) ?? Date.now(),
      updatedAt: Date.now(),
    }

    this.db
      .prepare(
        `INSERT INTO project_template
           (id, name, description, repo, ref, details_path, details_found, details_note,
            inspected_at, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name          = excluded.name,
           description   = excluded.description,
           repo          = excluded.repo,
           ref           = excluded.ref,
           details_path  = excluded.details_path,
           details_found = excluded.details_found,
           details_note  = excluded.details_note,
           inspected_at  = excluded.inspected_at,
           enabled       = excluded.enabled,
           updated_at    = excluded.updated_at`,
      )
      .run(
        record.id,
        record.name,
        record.description,
        record.repo,
        record.ref ?? null,
        record.detailsPath,
        record.detailsFound ? 1 : 0,
        record.detailsNote ?? null,
        record.inspectedAt ?? null,
        record.enabled ? 1 : 0,
        record.createdAt,
        record.updatedAt,
      )
    return { value: record }
  }

  /** Remove a template by id. */
  removeTemplate(templateId: string): boolean {
    const result = this.db.prepare('DELETE FROM project_template WHERE id = ?').run(templateId)
    return Number(result.changes) > 0
  }

  /**
   * Render a function's DNS template for a deployment.
   * @param template - the stored template.
   * @param deployment - the deployment name to substitute.
   * @param zone - the zone to substitute.
   * @returns the rendered hostname.
   */
  renderDnsTemplate(template: string, deployment: string, zone: string): string {
    return template.replaceAll('{name}', deployment).replaceAll('{zone}', zone)
  }
}
