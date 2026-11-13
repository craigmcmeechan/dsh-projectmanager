/**
 * machine — interface.
 * Split out of machine.ts by the module-structure refactor.
 */
/** Credentials and preferences held for this machine. */
export interface MachineSettings {
  cloudflare?: {
    /** Account id, shown in the UI. */
    accountId: string
    /** Zone this plugin is allowed to touch. */
    zone: string
    /** API token. Never returned in full. */
    token: string
  }
  github?: {
    /** Owner (user or org) new repositories are created under. */
    owner: string
    /** Token. Never returned in full. */
    token: string
  }
}
/** A settings value as the browser sees it: secrets replaced by a mask. */
export interface MachineSettingsView {
  cloudflare?: { accountId: string; zone: string; tokenSet: boolean; tokenHint: string }
  github?: { owner: string; tokenSet: boolean; tokenHint: string }
}
/** A remote host a project can target. */
export interface RemoteHost {
  /** Stable id, so a project refers to a host rather than to a mutable address. */
  id: string
  /** Display label. */
  label: string
  host: string
  user: string
  port: number
  /**
   * Path to an SSH private key on this host.
   *
   * Passwords are deliberately not stored. An SSH password at rest is a
   * credential leak waiting to happen, and key auth is what the remote flow
   * already sets up. When no key is given, the host's ssh-agent or default key
   * is used.
   */
  keyPath?: string
  createdAt: number
}
/** Remote hosts as the browser sees them. */
export interface RemoteHostView extends Omit<RemoteHost, 'keyPath'> {
  keySet: boolean
}
/** One imported team or agent from a JSON file. */
export interface ImportedActor {
  name?: string
  role?: string
  kind?: string
  capabilities?: string[]
  responsibility?: string
}
/** A parsed import document. */
export interface ParsedImport {
  teams: Array<{ name: string; purpose?: string; members?: ImportedActor[] }>
  agents: ImportedActor[]
  error?: string
}