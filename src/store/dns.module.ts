/**
 * Cloudflare DNS for server provisioning.
 *
 * Two jobs, both scoped tightly on purpose:
 *
 *   - **List** the zones the configured token can see, so the operator picks
 *     one rather than typing a name that may not exist.
 *   - **Create** one `A` record inside the chosen zone, pointing at the
 *     server's IP.
 *
 * ## Zone safety
 *
 * The plugin already holds a `zone` in its machine settings, meaning "the zone
 * this plugin is allowed to touch". Every write here is checked against it, so
 * a token with wider access cannot be used to point a record at a zone the
 * operator did not nominate. Records that already exist are treated as a
 * conflict rather than overwritten: another team's DNS is not ours to change.
 */


/** One DNS zone the token can see. */
export interface DnsZone {
  id: string
  name: string
  status?: string
}

/** The result of creating a record. */
export interface DnsWriteResult {
  ok: boolean
  detail: string
  /** The record's fully-qualified name, when it was created. */
  fqdn?: string
}

const API = 'https://api.cloudflare.com/client/v4'

/** Cloudflare's envelope, only the parts we read. */
interface CloudflareEnvelope<T> {
  success: boolean
  errors?: Array<{ code?: number; message?: string }>
  result?: T
  result_info?: { total_count?: number }
}

/**
 * Call the Cloudflare API with the stored token.
 * @param token - API token.
 * @param path - path below `/client/v4`.
 * @param init - extra request options.
 */
async function call<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<{ data?: T; error?: string }> {
  try {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    const payload = (await response.json()) as CloudflareEnvelope<T>
    if (!payload.success) {
      const first = payload.errors?.[0]
      return { error: first?.message ?? `Cloudflare returned ${response.status}` }
    }
    return { data: payload.result as T }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Cloudflare request failed' }
  }
}

/**
 * Resolve the credentials, or explain what is missing.
 *
 * @param settings - the plugin's machine settings.
 */
function credentials(
  config: Record<string, string>,
): { token: string; allowedZones: string[] } | { error: string } {
  const token = config['token']
  if (token === undefined || token.trim().length === 0) {
    return { error: 'add a Cloudflare API token in Stores, then test it' }
  }
  // `zones` is a comma-separated allowlist chosen in the UI. An empty list means
  // every zone the token can see is permitted.
  const zones = (config['zones'] ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
  return { token, allowedZones: zones }
}

/**
 * Verify a Cloudflare token by asking for the token's own identity.
 *
 * Uses `/user/tokens/verify`, which answers for the token itself rather than for
 * any particular zone: a token with no zone permission still verifies, and the
 * zone list then comes back empty, which is a different and more useful answer
 * than a generic failure.
 * @param token - the API token to test.
 * @returns whether it is active, and a short detail line.
 */
export async function testToken(token: string): Promise<{ ok: boolean; detail: string; zones: number }> {
  if (token.trim().length === 0) return { ok: false, detail: 'no token supplied', zones: 0 }
  const verified = await call<{ status?: string }>(token.trim(), '/user/tokens/verify')
  if (verified.error !== undefined) return { ok: false, detail: verified.error, zones: 0 }
  if (verified.data?.status !== 'active') {
    return { ok: false, detail: `token is ${verified.data?.status ?? 'not active'}`, zones: 0 }
  }
  // A token that verifies may still see no zones; report both facts so the UI
  // can distinguish "bad token" from "wrong permissions".
  const listed = await listZones({ token: token.trim() })
  if (listed.error !== undefined) return { ok: true, detail: listed.error, zones: 0 }
  return {
    ok: true,
    detail: `token is active and can see ${listed.zones.length} zone(s)`,
    zones: listed.zones.length,
  }
}

/**
 * List the zones the token can see.
 *
 * @param settings - the plugin's machine settings.
 */
export async function listZones(
  config: Record<string, string>,
): Promise<{ zones: DnsZone[]; error?: string }> {
  const auth = credentials(config)
  if ('error' in auth) return { zones: [], error: auth.error }

  const { data, error } = await call<Array<{ id: string; name: string; status?: string }>>(
    auth.token,
    '/zones?per_page=50',
  )
  if (error !== undefined) return { zones: [], error }
  let zones = (data ?? []).map((zone) => ({
    id: zone.id,
    name: zone.name,
    ...(zone.status === undefined ? {} : { status: zone.status }),
  }))
  // Selected zones form a permission boundary, not a default: a token with
  // wider access must not be usable to point a record somewhere the operator
  // did not pick. An empty allowlist means every visible zone is permitted.
  if (auth.allowedZones.length > 0) {
    zones = zones.filter((zone) => auth.allowedZones.includes(zone.name.toLowerCase()))
  }
  return { zones }
}

/**
 * Create an `A` record for the server inside the chosen zone.
 *
 * @param settings - the plugin's machine settings.
 * @param zoneName - the zone to write into.
 * @param label - the hostname label, e.g. `build-01`.
 * @param ip - the server's IPv4 address.
 * @param proxied - whether Cloudflare should proxy the record.
 */
export async function createRecord(
  config: Record<string, string>,
  zoneName: string,
  label: string,
  ip: string,
  proxied = false,
): Promise<DnsWriteResult> {
  const auth = credentials(config)
  if ('error' in auth) return { ok: false, detail: auth.error }

  // Enforce the permission boundary before any network call.
  if (auth.allowedZones.length > 0 && !auth.allowedZones.includes(zoneName.toLowerCase())) {
    return {
      ok: false,
      detail: `this plugin is limited to ${auth.allowedZones.join(', ')}; ${zoneName} was not selected`,
    }
  }
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) {
    return { ok: false, detail: 'that name is not a valid DNS label' }
  }
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return { ok: false, detail: 'that address is not an IPv4 address, so an A record cannot point at it' }
  }

  const zones = await listZones(config)
  if (zones.error !== undefined) return { ok: false, detail: zones.error }
  const zone = zones.zones.find((entry) => entry.name.toLowerCase() === zoneName.toLowerCase())
  if (zone === undefined) {
    return { ok: false, detail: `the token cannot see a zone named ${zoneName}` }
  }

  const fqdn = `${label}.${zone.name}`

  // Refuse to overwrite: an existing name belongs to something already.
  const existing = await call<Array<{ id: string; name: string; content: string }>>(
    auth.token,
    `/zones/${zone.id}/dns_records?type=A&name=${encodeURIComponent(fqdn)}`,
  )
  if (existing.error !== undefined) return { ok: false, detail: existing.error }
  if ((existing.data ?? []).length > 0) {
    const current = existing.data?.[0]
    return {
      ok: false,
      detail: `${fqdn} already exists (points at ${current?.content ?? 'another address'}); pick a different name`,
    }
  }

  const created = await call<{ name: string }>(auth.token, `/zones/${zone.id}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({ type: 'A', name: fqdn, content: ip, ttl: 300, proxied }),
  })
  if (created.error !== undefined) return { ok: false, detail: created.error }
  return { ok: true, detail: `created ${fqdn} → ${ip}`, fqdn }
}

/**
 * Delete a record this plugin created, identified by its fully-qualified name.
 *
 * Used when the operator abandons a wizard run after DNS was already written, so
 * a half-finished server does not leave a name pointing nowhere.
 * @param settings - the plugin's machine settings.
 * @param fqdn - the record to remove.
 */
export async function deleteRecord(
  config: Record<string, string>,
  fqdn: string,
): Promise<{ ok: boolean; detail: string }> {
  const auth = credentials(config)
  if ('error' in auth) return { ok: false, detail: auth.error }

  const zones = await listZones(config)
  if (zones.error !== undefined) return { ok: false, detail: zones.error }
  const zone = zones.zones.find((entry) => fqdn === entry.name || fqdn.endsWith(`.${entry.name}`))
  if (zone === undefined) return { ok: false, detail: `no visible zone contains ${fqdn}` }

  const found = await call<Array<{ id: string }>>(
    auth.token,
    `/zones/${zone.id}/dns_records?name=${encodeURIComponent(fqdn)}`,
  )
  if (found.error !== undefined) return { ok: false, detail: found.error }
  const record = found.data?.[0]
  if (record === undefined) return { ok: false, detail: `${fqdn} does not exist` }

  const removed = await call<{ id: string }>(auth.token, `/zones/${zone.id}/dns_records/${record.id}`, {
    method: 'DELETE',
  })
  if (removed.error !== undefined) return { ok: false, detail: removed.error }
  return { ok: true, detail: `removed ${fqdn}` }
}
