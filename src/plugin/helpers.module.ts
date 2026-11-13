/**
 * Shared request, registry, and settings helpers.
 *
 * Extracted from the plugin entry so the entry wiring and the route dispatch
 * can both use them without importing each other.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { ProjectDatabase } from '../db/index.ts'
import { readConfig } from '../scaffold/index.ts'
import { type Target } from '../target/index.ts'
import type { Registry, PluginSettings } from './index.interface.ts'

/** JSON response writer. */
export function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text)),
    'cache-control': 'no-store',
  })
  res.end(text)
}
/** Success envelope. */
export function ok(res: ServerResponse, body: Record<string, unknown> = {}, status = 200): void {
  send(res, status, { ok: true, ...body })
}
/** Failure envelope, mapping known error codes to statuses. */
export function fail(res: ServerResponse, error: unknown): void {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'internal'
  const message = error instanceof Error ? error.message : String(error)
  const status =
    code === 'not-found'
      ? 404
      : code === 'duplicate-name' || code === 'branch-exists'
        ? 409
        : code === 'invalid-name' || code === 'invalid-description' || code === 'invalid-body'
          ? 400
          : code === 'git-failed' || code === 'not-a-repository'
            ? 422
            : 500
  send(res, status, { ok: false, error: { code, message } })
}
/** Read and parse a JSON object body. */
export async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim().length === 0) return {}
  const parsed: unknown = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error('body must be a JSON object'), { code: 'invalid-body' })
  }
  return parsed as Record<string, unknown>
}
/** Registry file under the Harness home. */
export function registryFile(): string {
  return join(resolveDshHome(), 'projects', 'registry.json')
}
/** Read the registry, tolerating absence. */
export function readRegistry(): Registry {
  const path = registryFile()
  if (!existsSync(path)) return { version: 1, projects: [] }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Registry
    return Array.isArray(parsed.projects) ? parsed : { version: 1, projects: [] }
  } catch {
    return { version: 1, projects: [] }
  }
}
/** Write the registry atomically. */
export function writeRegistry(registry: Registry): void {
  const path = registryFile()
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(registry, undefined, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
}
/** Settings file under the Harness home. */
export function settingsFile(): string {
  return join(resolveDshHome(), 'projects', 'settings.json')
}
/** Read settings, defaulting to a first-class sidebar button. */
export function readSettings(): PluginSettings {
  const path = settingsFile()
  if (!existsSync(path)) return { displayMode: 'button' }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<PluginSettings>
    return { displayMode: parsed.displayMode === 'menu' ? 'menu' : 'button' }
  } catch {
    return { displayMode: 'button' }
  }
}
/** Write settings atomically. */
export function writeSettings(settings: PluginSettings): void {
  const path = settingsFile()
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(settings, undefined, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
}
/**
 * Resolve where a project's infrastructure runs.
 *
 * A remote project is probed over SSH; a local one in this process. This is the
 * difference between "what can this project use" and "what can the Harness host
 * use", and conflating them gives a confidently wrong answer.
 * @param root - the project directory.
 */
export function targetFor(root: string): Target {
  const config = readConfig(root)
  if (config?.mode === 'remote' && config.remote !== undefined) {
    return {
      kind: 'remote',
      host: config.remote.host,
      user: config.remote.user,
      port: config.remote.port,
    }
  }
  return { kind: 'local' }
}
/** Resolve a project root from the registry by id, refusing unknown ids. */
export function projectRootFor(id: string): string {
  const entry = readRegistry().projects.find((candidate) => candidate.id === id)
  if (entry === undefined) {
    throw Object.assign(new Error(`no project ${id}`), { code: 'not-found' })
  }
  return entry.root
}
/** Open one project's database for the duration of a call. */
export function withProject<T>(root: string, fn: (db: ProjectDatabase) => T): T {
  const db = ProjectDatabase.forProject(root)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}
