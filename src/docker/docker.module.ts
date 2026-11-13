/**
 * docker — module.
 * Split out of docker.ts by the module-structure refactor.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DockerStatus, ImageStatus, PullResult, InfraOption } from './docker.interface.ts'

const run = promisify(execFile)
/**
 * Check whether the Docker daemon is reachable.
 *
 * This runs `docker version`, not `docker --version`: the latter answers from the
 * client binary and succeeds even when the daemon is down, which would misreport
 * availability.
 * @returns the probe result.
 */
export async function dockerStatus(): Promise<DockerStatus> {
  try {
    const { stdout } = await run('docker', ['version', '--format', '{{.Server.Version}}'], {
      timeout: 8000,
    })
    const version = stdout.trim()
    return version.length > 0 ? { available: true, version } : { available: false, reason: 'no server version reported' }
  } catch (error) {
    const detail = error as { stderr?: string; message?: string; code?: string }
    // ENOENT means the client is not installed; anything else is a daemon issue.
    const reason =
      detail.code === 'ENOENT'
        ? 'the docker command is not installed'
        : (detail.stderr ?? detail.message ?? 'docker did not respond').trim().split('\n')[0]
    return { available: false, reason }
  }
}
/**
 * Check whether one image is present locally.
 * @param image - image reference, e.g. `quay.io/keycloak/keycloak:26.4`.
 * @returns presence and size when known.
 */
export async function imageStatus(image: string): Promise<ImageStatus> {
  if (image.trim().length === 0) return { image, present: false }
  try {
    const { stdout } = await run(
      'docker',
      ['image', 'inspect', image, '--format', '{{.Size}}'],
      { timeout: 8000 },
    )
    const size = Number(stdout.trim())
    return { image, present: true, ...(Number.isFinite(size) ? { sizeBytes: size } : {}) }
  } catch {
    return { image, present: false }
  }
}
/**
 * Pull an image.
 *
 * Deliberately a separate call from the probe: a pull is the only operation here
 * that talks to a registry and writes to the host, so it must be explicit.
 * @param image - image reference to pull.
 * @param signal - caller cancellation; aborts the pull.
 * @returns whether it succeeded and a short detail line.
 */
export async function pullImage(image: string, signal?: AbortSignal): Promise<PullResult> {
  if (image.trim().length === 0) return { image, ok: false, detail: 'no image reference given' }
  try {
    const { stdout, stderr } = await run('docker', ['pull', image], {
      timeout: 15 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
      ...(signal === undefined ? {} : { signal }),
    })
    const lines = `${stdout}\n${stderr}`.trim().split('\n').filter((line) => line.trim().length > 0)
    return { image, ok: true, detail: lines.at(-1) ?? 'pulled' }
  } catch (error) {
    const detail = error as { stderr?: string; message?: string }
    const text = (detail.stderr ?? detail.message ?? 'pull failed').trim().split('\n').filter(Boolean)
    return { image, ok: false, detail: text.at(-1) ?? 'pull failed' }
  }
}
/**
 * The options the UI presents.
 *
 * Kept here rather than in the client so the host can validate a selection and
 * the client cannot invent an image reference.
 */
export const INFRA_OPTIONS: InfraOption[] = [
  {
    kind: 'database',
    provider: 'sqlite-local',
    label: 'SQLite (file)',
    description: 'Zero-ops, single file beside the project. Right for one user and one machine.',
    containerised: false,
  },
  {
    kind: 'database',
    provider: 'postgres-docker',
    label: 'PostgreSQL (Docker)',
    description: 'A real database in a container. Right when several services share it.',
    containerised: true,
    image: 'postgres:17-alpine',
    port: 5432,
  },
  {
    kind: 'identity',
    provider: 'oauth-external',
    label: 'External OAuth2 (passport.js)',
    description: 'The app integrates a provider itself, e.g. GitHub or Google. No local service.',
    containerised: false,
  },
  {
    kind: 'identity',
    provider: 'keycloak-docker',
    label: 'Keycloak (Docker)',
    description: 'A full identity provider you own: realms, users, OIDC clients.',
    containerised: true,
    image: 'quay.io/keycloak/keycloak:26.4',
    port: 8080,
  },
  {
    kind: 'identity',
    provider: 'keycloak-existing',
    label: 'Keycloak (already running)',
    description: 'Point at an existing Keycloak, e.g. the one on this host.',
    containerised: false,
    port: 8080,
  },
  {
    kind: 'cache',
    provider: 'redis-docker',
    label: 'Redis (Docker)',
    description: 'In-memory cache and queues.',
    containerised: true,
    image: 'redis:7-alpine',
    port: 6379,
  },
]
/** Look up one option by its provider value. */
export function findOption(provider: string): InfraOption | undefined {
  return INFRA_OPTIONS.find((option) => option.provider === provider)
}