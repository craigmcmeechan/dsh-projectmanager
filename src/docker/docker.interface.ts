/**
 * docker — interface.
 * Split out of docker.ts by the module-structure refactor.
 */
/** Result of checking whether Docker can be used. */
export interface DockerStatus {
  /** Whether the daemon answered. */
  available: boolean
  /** Server version, when available. */
  version?: string
  /** Why it is unavailable, when it is. */
  reason?: string | undefined
}
/** State of one image on the host. */
export interface ImageStatus {
  /** Image reference that was asked about. */
  image: string
  /** Whether the image is already present locally. */
  present: boolean
  /** Size in bytes, when known and present. */
  sizeBytes?: number
}
/** Result of one pull attempt. */
export interface PullResult {
  image: string
  ok: boolean
  /** Last line of output, for a short report. */
  detail: string
}
/** One known infrastructure option the UI offers. */
export interface InfraOption {
  /** Category this option satisfies. */
  kind: string
  /** Machine value stored on the requirement. */
  provider: string
  /** Label shown in the UI. */
  label: string
  /** One line explaining when this is the right choice. */
  description: string
  /** Whether the option runs in a container. */
  containerised: boolean
  /** Image to pull, when containerised. */
  image?: string
  /** Default host port, when relevant. */
  port?: number
}