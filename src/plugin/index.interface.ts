/**
 * index — interface.
 * Split out of index.ts by the module-structure refactor.
 */
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Registry of known projects, stored as JSON in the Harness home. */
export interface Registry {
  version: 1
  projects: Array<{ id: string; name: string; root: string; createdAt: number; lastAccessedAt?: number }>
}
/** The plugin's own settings, stored beside the registry. */
export interface PluginSettings {
  /** `button` = first-class sidebar row; `menu` = a row in the More menu. */
  displayMode: 'button' | 'menu'
}