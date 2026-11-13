/**
 * Docker discovery and registry resolution for the image catalogue.
 *
 * Two independent jobs:
 *
 *   - **Discover** what images exist on *this* machine, so a fresh install can
 *     seed its catalogue from what the operator already uses.
 *   - **Resolve** a reference against Docker Hub, so the catalogue can show a
 *     real tag and notice when the pinned tag has been superseded.
 *
 * Both are best-effort by design: a machine with no Docker still gets a usable
 * catalogue, and an unreachable registry leaves the pinned tag in place rather
 * than failing the screen.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { RegistryCheck } from './store.interface.ts'
import type { PluginStore } from './store.module.ts'

const run = promisify(execFile)

/** One image found on the local Docker daemon. */
export interface LocalImage {
  reference: string
  repository: string
  tag: string
}

/**
 * List image references on the local Docker daemon.
 *
 * Reports an empty list rather than throwing when Docker is absent or the
 * daemon is down: the caller's next step (ask the operator what they want) is
 * the same either way.
 * @returns the references, and why the list is empty when it is.
 */
export async function discoverLocalImages(): Promise<{ images: LocalImage[]; reason?: string }> {
  try {
    const { stdout } = await run(
      'docker',
      ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'],
      { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
    )
    const images: LocalImage[] = []
    const seen = new Set<string>()
    for (const line of stdout.split('\n')) {
      const reference = line.trim()
      // `<none>:<none>` is a dangling intermediate layer, not a usable image.
      if (reference.length === 0 || reference.startsWith('<none>')) continue
      if (seen.has(reference)) continue
      seen.add(reference)
      const colon = reference.lastIndexOf(':')
      images.push({
        reference,
        repository: colon === -1 ? reference : reference.slice(0, colon),
        tag: colon === -1 ? 'latest' : reference.slice(colon + 1),
      })
    }
    return { images: images.sort((a, b) => a.reference.localeCompare(b.reference)) }
  } catch (error) {
    const detail = error as { code?: string; stderr?: string; message?: string }
    return {
      images: [],
      reason:
        detail.code === 'ENOENT'
          ? 'the docker command is not installed on this machine'
          : (detail.stderr ?? detail.message ?? 'docker did not respond').trim().split('\n')[0] ??
            'docker did not respond',
    }
  }
}

/** Docker Hub's registry host, as it appears in a fully-qualified reference. */
const HUB_HOST = 'docker.io'

/**
 * Split a reference into its Docker Hub repository path.
 *
 * Only Docker Hub is queried: a private registry needs credentials this plugin
 * does not hold, and guessing that a third-party registry speaks Hub's API
 * would produce confusing failures rather than an honest "not checked".
 * @param reference - image reference.
 * @returns the Hub repository path, or null when the image is not on Docker Hub.
 */
export function hubRepository(reference: string): string | null {
  const trimmed = reference.trim()
  if (trimmed.length === 0) return null
  const withoutTag = trimmed.replace(/:[^/:]+$/, '')
  const parts = withoutTag.split('/')
  const first = parts[0] ?? ''
  // A first segment containing a dot or a colon is a registry host.
  if (parts.length > 1 && (first.includes('.') || first.includes(':') || first === 'localhost')) {
    const host = first === 'registry-1.docker.io' ? HUB_HOST : first
    if (host !== HUB_HOST) return null
    return parts.slice(1).join('/')
  }
  // An unqualified single name is a Hub *official* image.
  if (parts.length === 1) return `library/${first}`
  return withoutTag
}

/**
 * Resolve one reference's tags from Docker Hub.
 *
 * Uses the public tags endpoint, which needs no credentials for public images.
 * An unauthenticated caller is rate-limited by Docker Hub; a 429 is reported as
 * a normal error on this entry rather than thrown, so one rate-limited image
 * does not blank the whole catalogue.
 * @param reference - image reference to look up.
 * @param signal - caller cancellation.
 * @returns the tags the registry reports, newest first.
 */
export async function resolveRegistryTags(
  reference: string,
  signal?: AbortSignal,
): Promise<RegistryCheck> {
  const { repository, tag } = splitReferenceLocal(reference)
  const hub = hubRepository(reference)
  if (hub === null) {
    return {
      reference,
      repository,
      tag,
      tags: [],
      error: 'not a Docker Hub image; tags are not checked for private registries',
    }
  }
  try {
    const response = await fetch(
      `https://hub.docker.com/v2/repositories/${hub}/tags?page_size=25&ordering=last_updated`,
      { ...(signal === undefined ? {} : { signal }), headers: { accept: 'application/json' } },
    )
    if (response.status === 429) {
      return { reference, repository, tag, tags: [], error: 'Docker Hub rate limit reached; try again later' }
    }
    if (!response.ok) {
      return { reference, repository, tag, tags: [], error: `registry returned ${response.status}` }
    }
    const payload = (await response.json()) as { results?: Array<{ name?: string }> }
    const tags = (payload.results ?? [])
      .map((entry) => entry.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
    // `latest` must be the newest STABLE tag, not the most recently pushed one:
    // ordering by last_updated put `19rc2-trixie` first, and offering a release
    // candidate as "the version you should pin" is actively misleading.
    const stable = tags.filter((name) => !/(alpha|beta|rc|snapshot|dev|nightly|preview)/i.test(name))
    const newest = newestVersion(stable) ?? stable[0]
    return { reference, repository, tag, tags, ...(newest === undefined ? {} : { latest: newest }) }
  } catch (error) {
    if (signal?.aborted === true) return { reference, repository, tag, tags: [], error: 'cancelled' }
    return {
      reference,
      repository,
      tag,
      tags: [],
      error: error instanceof Error ? error.message : 'registry lookup failed',
    }
  }
}

/**
 * Pick the newest version-like tag from a list.
 *
 * Compares the leading numeric components, so `17.2` beats `17` and `17.10`
 * beats `17.9` — a plain string sort gets the second one wrong. A tag with no
 * leading number (e.g. `alpine`, `bookworm`) is never chosen over one that has
 * a number, because the numbered tags are the release line.
 * @param tags - candidate tags, already filtered for stability.
 * @returns the newest tag, or undefined when none is version-like.
 */
export function newestVersion(tags: string[]): string | undefined {
  let best: { tag: string; parts: number[] } | undefined
  for (const tag of tags) {
    const match = /^(\d+(?:\.\d+)*)/.exec(tag)
    const head = match?.[1]
    if (head === undefined) continue
    const parts = head.split('.').map(Number)
    if (best === undefined || compareParts(parts, best.parts) > 0) best = { tag, parts }
  }
  return best?.tag
}

/** Compare two numeric component lists, treating a missing part as zero. */
function compareParts(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left - right
  }
  return 0
}

/** Local copy of the reference splitter, to keep this module dependency-free. */
function splitReferenceLocal(reference: string): { repository: string; tag: string } {
  const trimmed = reference.trim()
  const colon = trimmed.lastIndexOf(':')
  const slash = trimmed.lastIndexOf('/')
  if (colon <= slash || colon === -1) return { repository: trimmed, tag: 'latest' }
  return { repository: trimmed.slice(0, colon), tag: trimmed.slice(colon + 1) }
}

/**
 * Seed the catalogue from local images, then resolve each against the registry.
 *
 * Order matters: the local list is the operator's real usage, so it becomes the
 * catalogue; registry resolution only *annotates* those entries. When a machine
 * has no images the caller prompts for them instead, which is why an empty list
 * is a normal return rather than an error.
 * @param signal - caller cancellation.
 * @returns what was discovered and how many entries were written.
 */
export async function seedCatalogue(
  store: PluginStore,
  signal?: AbortSignal,
): Promise<{ seeded: number; discovered: number; reason?: string }> {
  const { images, reason } = await discoverLocalImages()
  let seeded = 0
  for (const image of images) {
    if (signal?.aborted === true) break
    const written = store.upsertImage({
      reference: image.reference,
      source: 'local',
      description: '',
    })
    if (written.error === undefined) seeded += 1
  }
  return { seeded, discovered: images.length, ...(reason === undefined ? {} : { reason }) }
}
