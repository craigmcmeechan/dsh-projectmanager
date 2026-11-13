/**
 * settings — module.
 * Split out of client/settings.ts by the module-structure refactor.
 */
import { useEffect, useState } from 'react'
import type { PluginSettings } from './settings.interface.ts'

/** Defaults, used until the Host answers. */
const DEFAULTS: PluginSettings = { displayMode: 'button' }
let cached: PluginSettings = DEFAULTS
const listeners = new Set<(value: PluginSettings) => void>()
/** Read the current cached settings. */
export function current(): PluginSettings {
  return cached
}
/** Subscribe to settings changes. */
export function subscribe(listener: (value: PluginSettings) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
/** Publish new settings to every subscriber. */
function publish(next: PluginSettings): void {
  cached = next
  for (const listener of listeners) listener(next)
}
/** Load from the Host once. */
export async function load(): Promise<void> {
  try {
    const response = await fetch('/api/projects/settings', { credentials: 'same-origin' })
    if (!response.ok) return
    const payload = (await response.json()) as { settings?: PluginSettings }
    if (payload.settings !== undefined) publish({ ...DEFAULTS, ...payload.settings })
  } catch {
    // Keep defaults; the panel still renders.
  }
}
/** Persist a patch and publish the result. */
export async function save(patch: Partial<PluginSettings>): Promise<PluginSettings> {
  const response = await fetch('/api/projects/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(patch),
  })
  if (!response.ok) throw new Error(`settings save failed (${response.status})`)
  const payload = (await response.json()) as { settings: PluginSettings }
  publish({ ...DEFAULTS, ...payload.settings })
  return cached
}
/** React binding for the settings. */
export function useSettings(): PluginSettings {
  const [value, setValue] = useState<PluginSettings>(cached)
  useEffect(() => {
    const unsubscribe = subscribe(setValue)
    // A panel may mount before the first load finished.
    if (cached === DEFAULTS) void load()
    return unsubscribe
  }, [])
  return value
}