/**
 * settings — interface.
 * Split out of client/settings.ts by the module-structure refactor.
 */
import type { DisplayMode } from './settings.types.ts'

/** The plugin's own settings. */
export interface PluginSettings {
  /** `button` = first-class sidebar row; `menu` = a row inside the More menu. */
  displayMode: DisplayMode
}