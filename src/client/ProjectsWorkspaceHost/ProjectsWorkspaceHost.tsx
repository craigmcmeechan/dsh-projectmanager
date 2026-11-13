/**
 * ProjectsWorkspaceHost — component.
 * Split out of client/ProjectsWorkspaceHost.tsx by the module-structure refactor.
 */
import { ProjectsPanel } from '../ProjectsPanel/index.ts'
import type { ProjectsWorkspaceHostProps } from './ProjectsWorkspaceHost.interface.ts'

/**
 * Render the panel with its injected services.
 * @param props - the injected face.
 */
export function ProjectsWorkspaceHost({ inject, picker }: ProjectsWorkspaceHostProps) {
  return (
    <ProjectsPanel
      sessions={inject}
      picker={picker}
      {...(inject.onProjectsChanged === undefined ? {} : { onProjectsChanged: inject.onProjectsChanged })}
    />
  )
}