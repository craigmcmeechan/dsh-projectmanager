/**
 * ProjectsIcon — component.
 * Split out of client/ProjectsIcon.tsx by the module-structure refactor.
 */
/**
 * The sidebar row's icon.
 *
 * `sidebar.panellist` takes a component rendered in the navigation list; the
 * label comes from the registration, so this only draws the glyph.
 */
export function ProjectsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9.5" y="2.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.5" y="9.5" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9.5" y="9.5" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}