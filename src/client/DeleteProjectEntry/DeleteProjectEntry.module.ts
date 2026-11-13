/**
 * The delete-confirmation flow.
 *
 * Deletion is destructive, so this never fires from a single click: the menu row
 * opens a store-backed confirmation, and the delete runs only when that confirms.
 *
 * Scope is stated before confirming. The host's `DELETE /api/projects/:id`
 * unregisters the project from the registry and leaves the directory and its
 * database untouched, so the wording says "removed from the list" rather than
 * "deleted from disk" — the operator can still find their files.
 */

type Listener = (request: DeleteRequest | undefined) => void

/** A pending delete awaiting confirmation. */
export interface DeleteRequest {
  /** Registry project id, without the sidebar prefix. */
  projectId: string
  /** Project name, for the dialog. */
  label: string
}

let pending: DeleteRequest | undefined
const listeners = new Set<Listener>()

/** Subscribe to confirmation requests. */
export function subscribeToDelete(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The request awaiting confirmation, for `useSyncExternalStore`. */
export function pendingDelete(): DeleteRequest | undefined {
  return pending
}

/** Ask the operator to confirm a delete. */
export function requestDelete(request: DeleteRequest): void {
  pending = request
  for (const listener of listeners) listener(pending)
}

/** Clear the request, confirmed or cancelled. */
export function clearDelete(): void {
  pending = undefined
  for (const listener of listeners) listener(undefined)
}
