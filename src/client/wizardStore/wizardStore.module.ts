/**
 * wizardStore — module.
 * Split out of client/wizardStore.ts by the module-structure refactor.
 */
import type { Listener } from './wizardStore.types.ts'

const listeners = new Set<Listener>()
let open = false
/** Subscribe to open/close changes. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
/** Current state, for `useSyncExternalStore`. */
export function isOpen(): boolean {
  return open
}
/** Open or close the wizard and notify every subscriber. */
export function setOpen(next: boolean): void {
  if (open === next) return
  open = next
  for (const listener of listeners) listener(next)
}