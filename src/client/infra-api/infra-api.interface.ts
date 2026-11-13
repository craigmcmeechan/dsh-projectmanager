/**
 * infra-api — interface.
 * Split out of client/infra-api.ts by the module-structure refactor.
 */
/**
 * Client access to infrastructure and Docker state.
 */

/** One infrastructure option the host offers. */
export interface InfraOption {
  kind: string
  provider: string
  label: string
  description: string
  containerised: boolean
  image?: string
  port?: number
}
/** One recorded requirement. */
export interface InfraRequirement {
  id: string
  kind: string
  provider: string
  label: string
  containerised: boolean
  image: string
  port: number | null
  settings: string
  necessity: string
}
/** Docker daemon state. */
export interface DockerStatus {
  available: boolean
  version?: string
  reason?: string
}
/** One image's presence. */
export interface ImageStatus {
  image: string
  present: boolean
  sizeBytes?: number
}
/** Everything the Infrastructure tab needs in one response. */
export interface DockerProbe {
  status: DockerStatus
  options: InfraOption[]
  images: ImageStatus[]
}