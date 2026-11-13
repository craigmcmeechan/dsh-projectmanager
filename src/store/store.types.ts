/**
 * Record shapes for the plugin-wide stores.
 *
 * These are the column-level shapes, kept apart from the view shapes in
 * `store.interface.ts` so a handler can persist a record without inheriting the
 * UI's derived fields.
 */

/** One catalogue entry for a container image a project may use. */
export interface DockerImageRecord {
  /** Stable id, so a selection survives a reference edit. */
  id: string
  /** Full reference, e.g. `postgres:17-alpine`. */
  reference: string
  /** Repository part, e.g. `postgres`. */
  repository: string
  /** Tag part, e.g. `17-alpine`. */
  tag: string
  /** What the image is for, shown in the picker. */
  description: string
  /** Where the entry came from: discovered locally, resolved from a registry, or typed by hand. */
  source: 'local' | 'registry' | 'manual'
  /** Registry-reported newest tag at the time of the last check. */
  latest?: string
  /** When the registry was last consulted, epoch ms. */
  checkedAt?: number
  /** The function this image serves, when grouped. */
  functionId?: string
  createdAt: number
}

/**
 * A grouping of images by the job they do.
 *
 * "Keycloak" is a function, not an image: it names a purpose, and a DNS template
 * attached to it describes how a *deployment* of that purpose is addressed. This
 * is why the template lives here rather than on the image — the same image can
 * serve one function with one addressing scheme.
 */
export interface ImageFunctionRecord {
  /** Stable id. */
  id: string
  /** Distinct name, e.g. `Keycloak`. */
  name: string
  /** One line explaining what the function is for. */
  description: string
  /**
   * DNS name template for a deployment of this function.
   *
   * Supports `{name}` (deployment name) and `{zone}` (the zone it belongs to),
   * so one function can describe many hosts. Stored per function because
   * addressing is a property of the purpose, not of the image.
   */
  dnsTemplate?: string
  /** Default port the function listens on. */
  port?: number
  createdAt: number
  updatedAt: number
}

/** A remote server the plugin can provision and target. */
export interface RemoteServerRecord {
  /** Stable id. */
  id: string
  /** Distinct display name; also used to derive the DNS hostname. */
  name: string
  host: string
  user: string
  port: number
  /**
   * Path to the private key this plugin generated and manages for the server.
   *
   * A password is never stored. When the operator supplies one, the plugin uses
   * it once to install a key and then disables password login, so the stored
   * credential is a key that can be revoked per server.
   */
  keyPath?: string
  /** Whether password SSH login has been disabled on the server. */
  passwordDisabled?: boolean
  /** Cloudflare zone this server's hostname was created in. */
  zone?: string
  /** Hostname created for the server, e.g. `build-01.example.com`. */
  hostname?: string
  /** Default directory new workspaces are created in. */
  defaultWorkdir?: string
  /** Last probe facts, serialised. */
  facts?: string
  createdAt: number
  updatedAt: number
}

/**
 * Credentials for one provider, at machine scope.
 *
 * `config` holds provider-specific keys. It is stored as JSON rather than a
 * column per field so adding a provider or a field needs no migration.
 */
export interface MachineCredentialRecord {
  /** Provider key, e.g. `cloudflare` or `github`. */
  provider: string
  /** Provider-specific configuration, including secrets. */
  config: Record<string, string>
  updatedAt: number
}

/**
 * A project template.
 *
 * A template points at a git repository. That repository may carry a
 * `project details` folder describing how a project of that shape is set up;
 * this record stores whether that folder was found and what it said, so the UI
 * can show the state without re-cloning on every render.
 */
export interface ProjectTemplateRecord {
  id: string
  /** Distinct name, e.g. `turbo-pnpm-monorepo`. */
  name: string
  description: string
  /** Clone URL or local path of the template repository. */
  repo: string
  /** Branch, tag, or commit to use. Absent means the repository default. */
  ref?: string
  /** Folder inside the repository that holds setup information. */
  detailsPath: string
  /** Whether that folder existed at the last inspection. */
  detailsFound: boolean
  /** What the inspection concluded, or why it could not run. */
  detailsNote?: string
  /** When the repository was last inspected, epoch ms. */
  inspectedAt?: number
  /** Whether the template is offered when creating a project. */
  enabled: boolean
  createdAt: number
  updatedAt: number
}

/**
 * What a repository inspection found.
 *
 * Kept separate from the record because it is the *result* of a check, not part
 * of the template's identity: a check can fail today and succeed tomorrow with
 * no edit to the template.
 */
export interface TemplateInspection {
  /** Whether the details folder exists. */
  found: boolean
  /** Files inside the details folder, relative to it. */
  files: string[]
  /** Parsed `project.setup.json`, when the folder carries one. */
  setup?: TemplateSetup
  /** Problems that did not prevent the inspection, e.g. an unreadable file. */
  warnings: string[]
  /** A failure that stopped the inspection entirely. */
  error?: string
}

/**
 * The setup descriptor a template's details folder may carry.
 *
 * **This is a deliberate extension point.** The shape is defined and read today
 * so a template can record its intent, but nothing consumes it yet: scaffolding
 * a new project from a template is future work. Fields are optional and unknown
 * keys are preserved by the reader so a newer template does not fail an older
 * plugin.
 */
export interface TemplateSetup {
  /** What kind of project this template produces, e.g. `turbo-pnpm-monorepo`. */
  kind?: string
  /** Package manager the project expects. */
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun'
  /** Monorepo tool, when the template is one. */
  monorepo?: 'turbo' | 'nx' | 'none'
  /** Node version the project targets. */
  node?: string
  /** Commands to run after scaffolding, in order. Not executed yet. */
  bootstrap?: string[]
  /** Anything else the template wants to record. */
  [key: string]: unknown
}

/** One plugin-wide key/value setting. */
export interface SettingRecord {
  key: string
  value: string
  updatedAt: number
}
