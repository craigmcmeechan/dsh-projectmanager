/**
 * Styles for the Add Remote Server wizard.
 *
 * All colours are real DSH theme tokens. An invented token falls back to the
 * literal default, which is what produced white-on-white earlier in this plugin.
 */
import type { CSSProperties } from 'react'

/** The wizard's own frame inside the manager. */
export const screenStyle: CSSProperties = {
  border: '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)',
  borderRadius: 8,
  padding: 14,
}

/** One `term: definition` row in the probe summary. */
export const factRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  padding: '5px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l4, #f1f5f9)',
}

/** The numbered step badge in the heading. */
export const stepBadge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  borderRadius: 999,
  marginRight: 8,
  fontSize: 11,
  fontWeight: 600,
  background: 'var(--dsw-alias-interactive-bg-active, #2563eb)',
  color: '#ffffff',
  verticalAlign: 'middle',
}
