/**
 * Sidebar rows for projects and project templates.
 *
 * `sidebar.workspaces` is a `single` slot owned by DSH's own browser, so a
 * plugin cannot nest sections inside that tree. Each project and template
 * therefore gets its **own row** in the panel list, beside "Project Manager".
 *
 * A row draws its own glyph; its actions live in the More menu, because the
 * icon seat cannot host a menu without re-declaring a slot core already owns.
 */
/** The project/template glyph, using the same grid as Project Manager. */
export function ProjectGlyph({ size }: { size?: number }) {
  return (
    <svg
      width={size ?? 16}
      height={size ?? 16}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      {/* The grid marks a project or template, as it does for Project Manager. */}
      <rect x="1.5" y="2.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9.5" y="2.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.5" y="9.5" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9.5" y="9.5" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

/**
 * The "Projects" section header row.
 *
 * The sidebar renders `sidebar.panellist` as a flat list of clickable rows, and
 * the More control is appended by core code after them — there is no slot
 * between the two, so a separator cannot be inserted *under* More. This header
 * sits above the project rows instead, which achieves the same grouping.
 *
 * It draws a caption, not a nav target: the row it occupies is a button that
 * selects a panel, so it registers a small explanation page rather than leading
 * nowhere.
 * @param props - the standard share; `size` is unused here.
 */
export function ProjectsSectionHeader() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width: 16,
        height: 16,
        borderTop: '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)',
        borderBottom: '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)',
        opacity: 0.55,
      }}
    />
  )
}

/**
 * The row body for a project.
 *
 * Draws nothing on purpose. Core renders `icon + label`; the label comes from
 * the registration and the icon comes from `sidebar.panel.icon`, where the
 * per-row menu lives. Returning null keeps the row from double-drawing a glyph.
 */
export function ProjectRow() {
  // The row's own glyph. A `sidebar.panel.icon` factory would have supplied this
  // and the menu, but it cannot be registered without re-declaring a slot core
  // already owns, so the row draws its own and the actions stay in More.
  return <ProjectGlyph />
}
