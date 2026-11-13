/**
 * ProjectsPanel — module.
 * Split out of client/ProjectsPanel.tsx by the module-structure refactor.
 */
import { type ProjectEntry } from '../api/index.ts'
import type { Section } from './ProjectsPanel.types.ts'

export const SECTIONS: Array<{ id: Section; label: string; hint: string }> = [
  { id: 'overview', label: 'Overview', hint: 'Defaults, technologies, conventions' },
  { id: 'teams', label: 'Teams', hint: 'Members, workflows, models' },
  { id: 'features', label: 'Features', hint: 'Specifications and tasks' },
  { id: 'sessions', label: 'Sessions', hint: 'Discuss requirements' },
  { id: 'infrastructure', label: 'Development', hint: 'Node, Docker, runtimes on this machine' },
  { id: 'settings', label: 'Settings', hint: 'Credentials and imports' },
]
/** Relative time for a project's last access. */
export function lastAccessLabel(entry: ProjectEntry): string {
  const stamp = entry.lastAccessedAt ?? entry.createdAt
  if (stamp === undefined) return '—'
  const delta = Date.now() - stamp
  const minute = 60_000
  if (delta < minute) return 'just now'
  if (delta < 60 * minute) return `${Math.floor(delta / minute)}m ago`
  if (delta < 24 * 60 * minute) return `${Math.floor(delta / (60 * minute))}h ago`
  const days = Math.floor(delta / (24 * 60 * minute))
  return days < 30 ? `${days}d ago` : new Date(stamp).toLocaleDateString()
}