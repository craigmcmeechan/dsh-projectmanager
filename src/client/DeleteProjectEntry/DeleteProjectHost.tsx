/**
 * The delete-project confirmation dialog.
 *
 * Lives in `shell.overlay` so it outlives the More menu that launches it — the
 * same reason the New Project wizard does.
 */
import { useSyncExternalStore } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { clearDelete, pendingDelete, subscribeToDelete } from './DeleteProjectEntry.module.ts'

/** Props for the host. */
export interface DeleteProjectHostProps {
  /** Perform the delete. Rejects on failure so the dialog can show it. */
  onConfirm: (projectId: string) => Promise<void>
}

/**
 * Render the dialog while a delete is pending.
 * @param props - the confirm handler.
 */
export function DeleteProjectHost({ onConfirm }: DeleteProjectHostProps) {
  const request = useSyncExternalStore(subscribeToDelete, pendingDelete, pendingDelete)

  if (request === undefined) return null

  return (
    <Modal
      open
      onClose={clearDelete}
      title="Delete project"
      closeLabel="Close"
      footer={
        <>
          <Button variant="outline" onClick={clearDelete}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              void onConfirm(request.projectId)
                .then(() => clearDelete())
                .catch(() => {
                  // The caller surfaces the failure; keep the dialog open so a
                  // retry is one click rather than a reopened menu.
                })
            }}
          >
            Delete project
          </Button>
        </>
      }
    >
      <p style={{ marginTop: 0, fontSize: 13 }}>
        Remove <strong>{request.label}</strong> from the project list?
      </p>
      <p style={{ fontSize: 12, opacity: 0.75 }}>
        This unregisters the project. The directory and its database are{' '}
        <strong>left on disk</strong>, so nothing is lost — you can add it again later.
      </p>
    </Modal>
  )
}
