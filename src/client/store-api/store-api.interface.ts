/**
 * Shapes for the plugin-wide stores, as the browser sees them.
 *
 * Mirrored from the host's `store.interface.ts` rather than imported: the client
 * bundle cannot import host modules, so these are the wire shapes and must stay
 * in step with the server's responses.
 */

/** One catalogue image. */
export interface DockerImage {
  id: string
  reference: string
  repository: string
  tag: string
  description: string
  source: 'local' | 'registry' | 'manual'
  latest?: string
  checkedAt?: number
  /** The function this image is grouped under. */
  functionId?: string
  createdAt: number
}

/** Facts gathered from a remote server probe. */
export interface ServerFacts {
  os?: string
  osId?: string
  kernel?: string
  arch?: string
  ramMb?: number
  cpu?: number
  node?: { present: boolean; version?: string }
  nvm?: { present: boolean; version?: string }
  git?: { present: boolean; version?: string }
  docker?: { present: boolean; version?: string }
  updates?: { count: number; sample: string[] }
  probedAt?: number
}

/** One remote server. */
export interface RemoteServer {
  id: string
  name: string
  host: string
  user: string
  port: number
  passwordDisabled?: boolean
  zone?: string
  hostname?: string
  defaultWorkdir?: string
  keySet: boolean
  facts: ServerFacts
  createdAt: number
  updatedAt: number
}

/** A grouping of images by the job they do. */
export interface ImageFunction {
  id: string
  name: string
  description: string
  dnsTemplate?: string
  port?: number
  imageCount?: number
  createdAt: number
  updatedAt: number
}

/** Docker availability on this machine. */
export interface DockerMachineStatus {
  available: boolean
  reason?: string
  imageCount: number
  images: string[]
}

/** A machine credential as the browser sees it: secrets masked. */
export interface MachineCredential {
  provider: string
  fields: Record<string, string>
  secrets: Record<string, { set: boolean; hint: string }>
  updatedAt: number
}

/** The setup descriptor a template's details folder may carry. */
export interface TemplateSetup {
  kind?: string
  packageManager?: string
  monorepo?: string
  node?: string
  bootstrap?: string[]
  [key: string]: unknown
}

/** What inspecting a template repository found. */
export interface TemplateInspection {
  found: boolean
  files: string[]
  setup?: TemplateSetup
  warnings: string[]
  error?: string
}

/** A project template. */
export interface ProjectTemplate {
  id: string
  name: string
  description: string
  repo: string
  ref?: string
  detailsPath: string
  detailsFound: boolean
  detailsNote?: string
  inspectedAt?: number
  enabled: boolean
  createdAt: number
  updatedAt: number
}

/** One plugin-wide setting row. */
export interface StoreSetting {
  key: string
  value: string
  updatedAt: number
}

/** A DNS zone the configured token can see. */
export interface DnsZone {
  id: string
  name: string
  status?: string
}

/** One image found on the local Docker daemon. */
export interface LocalImage {
  reference: string
  repository: string
  tag: string
}
