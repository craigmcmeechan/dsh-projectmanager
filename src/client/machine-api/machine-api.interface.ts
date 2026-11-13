/**
 * machine-api — interface.
 * Split out of client/machine-api.ts by the module-structure refactor.
 */
/**
 * Client access to machine settings and development infrastructure.
 */

/** Settings as the browser sees them; secrets are masked. */
export interface MachineSettingsView {
  cloudflare?: { accountId: string; zone: string; tokenSet: boolean; tokenHint: string }
  github?: { owner: string; tokenSet: boolean; tokenHint: string }
}
/** Result of probing one command. */
export interface CommandProbe {
  found: boolean
  path?: string
  version?: string
  reason?: string
}
/** Node runtime state, as the target-aware probe reports it. */
export interface NodeState {
  current: CommandProbe
  nvm: CommandProbe
  installed: string[]
  canInstallNvm: boolean
  /** Which machine was probed. */
  target: string
  error?: string
}
/** Docker state with image inventory, as the target-aware probe reports it. */
export interface DockerState {
  installed: boolean
  version?: string
  daemon: boolean
  daemonReason?: string
  images: Array<{ repository: string; tag: string; sizeBytes: number }>
  /** Which machine was probed, so the UI can say so. */
  target: string
}
/** A registered remote host, as the browser sees it. */
export interface RemoteHostView {
  id: string
  label: string
  host: string
  user: string
  port: number
  keySet: boolean
  createdAt: number
}
/** OS, hardware, and toolchain facts for a host. */
export interface SystemFacts {
  target: string
  os: string
  kernel: string
  arch: string
  totalMemoryBytes?: number
  freeMemoryBytes?: number
  cpus?: number
  gitInstalled: boolean
  gitVersion?: string
  canInstallPackages: boolean
}
/** Every fact about one host, as one probe returns them. */
export interface HostFacts {
  system: SystemFacts
  node: NodeState
  docker: DockerState
  target: string
}