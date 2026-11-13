/**
 * Effective credentials for a project.
 *
 * Two scopes exist:
 *
 *   - **machine** — stored once in the plugin-wide store, shared by every
 *     project. This is the "import as standard" case.
 *   - **project** — stored in the project's own `config.json`, and wins.
 *
 * The rule is per provider, not per field: a project that sets only its
 * Cloudflare token does not inherit the machine's Cloudflare account id, because
 * mixing halves of two credential sets is how you get a token used against the
 * wrong account. A project that sets nothing inherits everything.
 */
import type { ProjectConfig } from '../scaffold/index.ts'
import type { MachineCredentialRecord } from './store.types.ts'

/** Credentials resolved for one project, with their origin. */
export interface EffectiveCredential {
  provider: string
  config: Record<string, string>
  source: 'project' | 'machine'
}

/** The providers this plugin knows how to resolve. */
export const CREDENTIAL_PROVIDERS = ['cloudflare', 'github'] as const

/** One provider name. */
export type CredentialProvider = (typeof CREDENTIAL_PROVIDERS)[number]

/**
 * Resolve the credentials a project should use.
 *
 * @param machine - machine-level credential blocks.
 * @param project - the project's descriptor, which may carry overrides.
 * @returns one entry per provider that has any configuration.
 */
export function effectiveCredentials(
  machine: MachineCredentialRecord[],
  project: ProjectConfig | undefined,
): EffectiveCredential[] {
  const out: EffectiveCredential[] = []
  for (const provider of CREDENTIAL_PROVIDERS) {
    const override = project?.credentials?.[provider]
    // A project override wins only when it carries at least one value; an empty
    // block is treated as "not overridden" rather than "explicitly blank".
    const hasOverride =
      override !== undefined && Object.values(override).some((value) => value.length > 0)
    if (hasOverride) {
      out.push({ provider, config: { ...override }, source: 'project' })
      continue
    }
    const stored = machine.find((entry) => entry.provider === provider)
    if (stored !== undefined && Object.keys(stored.config).length > 0) {
      out.push({ provider, config: { ...stored.config }, source: 'machine' })
    }
  }
  return out
}

/**
 * The value a project should use for one provider field.
 *
 * @param resolved - the resolved credential list.
 * @param provider - provider to read.
 * @param key - field name.
 * @returns the value, or undefined when unset at both scopes.
 */
export function credentialValue(
  resolved: EffectiveCredential[],
  provider: string,
  key: string,
): string | undefined {
  const entry = resolved.find((item) => item.provider === provider)
  const value = entry?.config[key]
  return value === undefined || value.length === 0 ? undefined : value
}
