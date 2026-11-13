/**
 * ProjectsEntry — component.
 * Split out of client/ProjectsEntry.tsx by the module-structure refactor.
 */
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import { setOpen } from '../wizardStore/index.ts'
import type { ProjectsEntryProps } from './ProjectsEntry.interface.ts'

/**
 * Render the menu row.
 * @param props - owner-supplied dismissal callback.
 */
export function ProjectsEntry({ onDismiss }: ProjectsEntryProps) {
  return (
    <MenuItemButton
      icon={null}
      onSelect={() => {
        // Dismiss the menu, then open a dialog that lives outside it.
        onDismiss()
        setOpen(true)
      }}
    >
      New project
    </MenuItemButton>
  )
}