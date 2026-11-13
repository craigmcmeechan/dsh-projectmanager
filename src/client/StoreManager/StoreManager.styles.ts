/**
 * Styles for the store manager.
 *
 * Colours come from the real DSH theme tokens (--dsw-alias-*). Earlier revisions
 * of this plugin invented --dsh-* names, which silently fell back to white.
 */
import type { CSSProperties } from 'react'

/** The outer panel: full height with its own scroll. */
export const panelStyle: CSSProperties = {
  padding: 16,
  height: '100%',
  overflowY: 'auto',
}

/** One store's section. */
export const sectionStyle: CSSProperties = { marginBottom: 18 }

/** A header cell. */
export const headCell: CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  opacity: 0.6,
  padding: '6px 8px',
  borderBottom: '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)',
}

/** A body cell. */
export const cell: CSSProperties = {
  padding: '8px',
  fontSize: 13,
  borderBottom: '1px solid var(--dsw-alias-border-l4, #f1f5f9)',
  verticalAlign: 'top',
}

/** One tab button; `active` fills it with the interactive token. */
export function tabStyle(active: boolean): CSSProperties {
  return {
    padding: '5px 12px',
    borderRadius: 999,
    fontSize: 12,
    cursor: 'pointer',
    font: 'inherit',
    border: '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)',
    background: active ? 'var(--dsw-alias-interactive-bg-active, #2563eb)' : 'transparent',
    color: active ? '#ffffff' : 'var(--dsw-alias-label-primary, inherit)',
  }
}
