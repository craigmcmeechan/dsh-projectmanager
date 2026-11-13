/**
 * Styles for a project's main panel.
 */
import type { CSSProperties } from 'react'

/** The panel frame. */
export const pageStyle: CSSProperties = { padding: 16, height: '100%', overflowY: 'auto' }

/** A muted line of explanation. */
export const hintStyle: CSSProperties = { fontSize: 13, opacity: 0.7 }

/** One workspace row. */
export const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 10px',
  borderRadius: 6,
  border: '0.5px solid var(--dsw-alias-border-l4, #e2e8f0)',
  marginBottom: 6,
  fontSize: 13,
}
