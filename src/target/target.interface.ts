/**
 * target — interface.
 * Split out of target.ts by the module-structure refactor.
 */
/** One command's outcome, shaped for both targets. */
export interface TargetProbe {
  found: boolean
  version?: string | undefined
  path?: string | undefined
  reason?: string | undefined
}
/** Result of running a shell snippet. */
export interface ShellResult {
  ok: boolean
  stdout: string
  stderr: string
}
/** OS, hardware, and toolchain facts for one host. */
export interface SystemFacts {
  /** Which machine these facts describe. */
  target: string
  /** OS description, e.g. "Ubuntu 26.04.1 LTS". */
  os: string
  /** Kernel release. */
  kernel: string
  /** Architecture. */
  arch: string
  /** Total memory in bytes, when reported. */
  totalMemoryBytes?: number
  /** Available memory in bytes, when reported. */
  freeMemoryBytes?: number
  /** CPU core count. */
  cpus?: number
  /** Whether git is present. */
  gitInstalled: boolean
  gitVersion?: string
  /** Whether the connecting user can install packages. */
  canInstallPackages: boolean
}