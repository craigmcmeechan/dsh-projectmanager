/**
 * machine — module.
 * Split out of machine.ts by the module-structure refactor.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MachineSettings, MachineSettingsView, RemoteHost, RemoteHostView, ImportedActor, ParsedImport } from './machine.interface.ts'

/**
 * Mask a secret for display.
 *
 * Keeps a short prefix and suffix so a user can tell *which* token is stored
 * without being able to reuse it from a screenshot.
 */
function mask(secret: string): string {
  if (secret.length === 0) return ''
  if (secret.length <= 12) return '••••'
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`
}
/** Path of the machine settings file. */
function settingsPath(home: string): string {
  return join(home, 'projects', 'machine.json')
}
/** Read settings, tolerating absence or corruption. */
export function readMachineSettings(home: string): MachineSettings {
  const path = settingsPath(home)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as MachineSettings
  } catch {
    // A corrupt file must not take the panel down; writing new values over it
    // is the recovery path.
    return {}
  }
}
/** Write settings atomically with owner-only permissions. */
function writeMachineSettings(home: string, settings: MachineSettings): void {
  const path = settingsPath(home)
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(settings, undefined, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
}
/** Project the settings for the browser, masking every secret. */
export function settingsView(settings: MachineSettings): MachineSettingsView {
  const view: MachineSettingsView = {}
  if (settings.cloudflare !== undefined) {
    view.cloudflare = {
      accountId: settings.cloudflare.accountId,
      zone: settings.cloudflare.zone,
      tokenSet: settings.cloudflare.token.length > 0,
      tokenHint: mask(settings.cloudflare.token),
    }
  }
  if (settings.github !== undefined) {
    view.github = {
      owner: settings.github.owner,
      tokenSet: settings.github.token.length > 0,
      tokenHint: mask(settings.github.token),
    }
  }
  return view
}
/**
 * Merge a patch into settings.
 *
 * A secret field that is absent or empty **keeps** the stored value: the UI only
 * shows a mask, so re-saving the form must not erase the credential that mask
 * represents.
 * @param home - the Harness home.
 * @param patch - fields to change; empty secrets are ignored.
 * @returns the settings after the merge.
 */
export function updateMachineSettings(
  home: string,
  patch: {
    cloudflare?: { accountId?: string; zone?: string; token?: string }
    github?: { owner?: string; token?: string }
  },
): MachineSettings {
  const current = readMachineSettings(home)
  if (patch.cloudflare !== undefined) {
    const previous = current.cloudflare
    current.cloudflare = {
      accountId: patch.cloudflare.accountId ?? previous?.accountId ?? '',
      zone: patch.cloudflare.zone ?? previous?.zone ?? '',
      token:
        patch.cloudflare.token !== undefined && patch.cloudflare.token.trim().length > 0
          ? patch.cloudflare.token.trim()
          : (previous?.token ?? ''),
    }
  }
  if (patch.github !== undefined) {
    const previous = current.github
    current.github = {
      owner: patch.github.owner ?? previous?.owner ?? '',
      token:
        patch.github.token !== undefined && patch.github.token.trim().length > 0
          ? patch.github.token.trim()
          : (previous?.token ?? ''),
    }
  }
  writeMachineSettings(home, current)
  return current
}
/** Read registered remote hosts. */
export function readRemoteHosts(home: string): RemoteHost[] {
  const path = join(home, 'projects', 'hosts.json')
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { hosts?: RemoteHost[] }
    return Array.isArray(parsed.hosts) ? parsed.hosts : []
  } catch {
    return []
  }
}
/** Write remote hosts atomically. */
function writeRemoteHosts(home: string, hosts: RemoteHost[]): void {
  const path = join(home, 'projects', 'hosts.json')
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify({ hosts }, undefined, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
}
/** Project hosts for the browser, hiding the key path behind a flag. */
export function remoteHostsView(home: string): RemoteHostView[] {
  return readRemoteHosts(home).map(({ keyPath, ...rest }) => ({
    ...rest,
    keySet: keyPath !== undefined && keyPath.length > 0,
  }))
}
/**
 * Add or replace a remote host.
 *
 * Validates the parts that would otherwise fail later as an opaque SSH error: a
 * blank host, an out-of-range port, or a key path that does not exist.
 * @returns the host as stored, or a validation error.
 */
export function upsertRemoteHost(
  home: string,
  input: { id?: string; label?: string; host?: string; user?: string; port?: number; keyPath?: string },
): { host?: RemoteHost; error?: string } {
  const host = (input.host ?? '').trim()
  if (host.length === 0) return { error: 'a host or IP address is required' }
  const user = (input.user ?? '').trim()
  if (user.length === 0) return { error: 'an SSH user is required' }
  const port = input.port ?? 22
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'port must be 1–65535' }
  const keyPath = input.keyPath?.trim()
  if (keyPath !== undefined && keyPath.length > 0 && !existsSync(keyPath)) {
    return { error: `no key file at ${keyPath}` }
  }

  const hosts = readRemoteHosts(home)
  const existing = input.id === undefined ? undefined : hosts.find((entry) => entry.id === input.id)
  const record: RemoteHost = {
    id: existing?.id ?? `host_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    label: (input.label ?? '').trim() || `${user}@${host}`,
    host,
    user,
    port,
    ...(keyPath === undefined || keyPath.length === 0 ? {} : { keyPath }),
    createdAt: existing?.createdAt ?? Date.now(),
  }
  const next = existing === undefined ? [...hosts, record] : hosts.map((entry) => (entry.id === record.id ? record : entry))
  writeRemoteHosts(home, next)
  return { host: record }
}
/** Remove a remote host by id. */
export function removeRemoteHost(home: string, id: string): boolean {
  const hosts = readRemoteHosts(home)
  const next = hosts.filter((entry) => entry.id !== id)
  if (next.length === hosts.length) return false
  writeRemoteHosts(home, next)
  return true
}
/**
 * Validate an uploaded teams/agents document.
 *
 * Accepts either a single array or an object with `teams` and/or `agents` keys,
 * because a hand-written file is more likely to be one of those shapes than the
 * exact one this plugin would write.
 * @param text - the raw file contents.
 */
export function parseImport(text: string): ParsedImport {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { teams: [], agents: [], error: `not valid JSON: ${(error as Error).message}` }
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { teams: [], agents: [], error: 'expected a JSON object or array' }
  }

  const record = parsed as Record<string, unknown>
  const teams = Array.isArray(record.teams)
    ? (record.teams as Array<Record<string, unknown>>)
        .filter((entry) => typeof entry.name === 'string' && String(entry.name).trim().length > 0)
        .map((entry) => ({
          name: String(entry.name).trim(),
          ...(entry.purpose === undefined ? {} : { purpose: String(entry.purpose) }),
          ...(Array.isArray(entry.members) ? { members: entry.members as ImportedActor[] } : {}),
        }))
    : []

  const agents = Array.isArray(record.agents)
    ? (record.agents as ImportedActor[])
    : Array.isArray(parsed)
      ? (parsed as ImportedActor[])
      : []

  if (teams.length === 0 && agents.length === 0) {
    return { teams: [], agents: [], error: 'no teams or agents found in the document' }
  }
  return { teams, agents }
}