/**
 * ProjectsWizardHost — component.
 * Split out of client/ProjectsWizardHost.tsx by the module-structure refactor.
 */
import { useSyncExternalStore } from 'react'
import { NewProjectWizard } from '../NewProjectWizard/index.ts'
import { isOpen, setOpen, subscribe } from '../wizardStore/index.ts'
import type { ProjectsWizardHostProps } from './ProjectsWizardHost.interface.ts'

/**
 * Render the wizard when the store says it is open.
 * @param props - the injected picker surface.
 * @returns the wizard, or null while closed.
 */
export function ProjectsWizardHost({ picker }: ProjectsWizardHostProps = {}) {
  const open = useSyncExternalStore(subscribe, isOpen, isOpen)
  return <NewProjectWizard open={open} onClose={() => setOpen(false)} picker={picker} />
}