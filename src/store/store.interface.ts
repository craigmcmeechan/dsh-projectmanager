/**
 * Plugin-wide store contracts.
 *
 * Three collections live in ONE SQLite file, because they share a lifetime (the
 * plugin's installation, not a project) and a single connection is cheaper than
 * three. They stay logically separate: each has its own table and its own
 * accessor surface, so a future move to separate files is a mechanical change.
 */
import type { DockerImageRecord, RemoteServerRecord, SettingRecord } from './store.types.ts'

/** One image in the catalogue, as the UI sees it. */
export interface DockerImageView extends DockerImageRecord {
  /** Whether the image is present on this machine, when last checked. */
  local?: boolean
  /** Newest tag reported by the registry, when last checked. */
  latest?: string
  /** Whether `latest` differs from the pinned tag. */
  outdated?: boolean
}

/** A remote server as the browser sees it: no secrets, ever. */
export interface RemoteServerView extends Omit<RemoteServerRecord, 'facts'> {
  /** Probe facts, already parsed. */
  facts: ServerFacts
  /** Whether an SSH key is stored/managed for this server. */
  keySet: boolean
}

/** Facts gathered by probing a remote server. */
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
  /** Packages the OS reports as upgradable. */
  updates?: { count: number; sample: string[] }
  probedAt?: number
}

/**
 * A machine credential as the browser sees it.
 *
 * Secrets never cross the wire: each one is replaced by a hint plus a `Set`
 * flag, the same rule the existing machine settings follow.
 */
export interface MachineCredentialView {
  provider: string
  /** Non-secret fields, as stored. */
  fields: Record<string, string>
  /** Secret fields: whether one is set, and a masked hint. */
  secrets: Record<string, { set: boolean; hint: string }>
  updatedAt: number
}

/** What a stored setting can hold. */
export type SettingValue = string | number | boolean | null

/** The result of adding or updating a catalogue entry. */
export interface StoreWriteResult<T> {
  value?: T
  error?: string
}

/** Result of resolving one image against its registry. */
export interface RegistryCheck {
  reference: string
  repository: string
  tag: string
  /** Tags the registry reports, newest first. */
  tags: string[]
  latest?: string
  error?: string
}

export type { DockerImageRecord, RemoteServerRecord, SettingRecord }
