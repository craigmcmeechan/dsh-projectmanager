/**
 * scaffold — interface.
 * Split out of scaffold.ts by the module-structure refactor.
 */
/** Machine-readable descriptor written at bootstrap. */
export interface ProjectConfig {
  /** Schema version of this descriptor, for future migrations. */
  version: 1
  name: string
  description: string
  /** local | remote — how development happens for this project. */
  mode: 'local' | 'remote'
  /** Absolute path the project was created at. */
  root: string
  /** Remote target when mode is remote. Never contains a password. */
  remote?: {
    host: string
    user: string
    port: number
    /** Path on the remote host that mirrors `root`. */
    path: string
  }
  /**
   * Project-level credential overrides.
   *
   * Absent means "use this machine's credentials". Present means this project's
   * own values win, per provider, so a project can use a different Cloudflare
   * token without disturbing the machine default. Stored in the project's own
   * 0600 config, never merged back into the machine block.
   */
  credentials?: {
    cloudflare?: Record<string, string>
    github?: Record<string, string>
  }
  createdAt: number
}