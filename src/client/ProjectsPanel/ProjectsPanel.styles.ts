/**
 * ProjectsPanel — styles.
 * Split out of client/ProjectsPanel.tsx by the module-structure refactor.
 */
export const cell: React.CSSProperties = { padding: '10px 8px', textAlign: 'left', fontSize: 13 }
export const headCell: React.CSSProperties = {
  ...cell,
  fontWeight: 600,
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  opacity: 0.6,
  borderBottom: '1px solid var(--dsw-alias-border-l4, #e5e7eb)',
}