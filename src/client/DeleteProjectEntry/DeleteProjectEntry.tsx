/**
 * "Delete project" in the sidebar's More menu.
 *
 * `sidebar.panellist.actions` is a list of rows shared by every panel — it has
 * no per-row identity — so this cannot be one delete item per project. Instead
 * it is a single row that acts on the **selected** panel, which is what the
 * operator means when they have a project open.
 *
 * Deleting is destructive and irreversible, so the row never deletes directly:
 * it opens a confirmation that names the project and states exactly what will
 * be removed.
 */
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DeleteProjectEntryProps } from './DeleteProjectEntry.interface.ts'

/** Prefix the sidebar rows use for project panels. */
const PROJECT_PREFIX = 'project-'

/**
 * Render the delete row.
 *
 * Disabled unless a project (not a template, not the overview) is the active
 * panel, because there is nothing to delete otherwise — and deleting a template
 * is a different operation with a different consequence.
 * @param props - the panel list, dismissal, and delete handler.
 */
export function DeleteProjectEntry({ entries, onDismiss, onDelete }: DeleteProjectEntryProps) {
  const active = entries.find((entry) => entry.active === true)
  const deletable = active !== undefined && active.id.startsWith(PROJECT_PREFIX)

  return (
    <MenuItemButton
      icon={null}
      disabled={!deletable}
      onSelect={() => {
        if (!deletable) return
        onDismiss()
        onDelete(active.id, active.label)
      }}
    >
      {deletable ? `Delete project “${active.label}”…` : 'Delete project (open one first)'}
    </MenuItemButton>
  )
}
