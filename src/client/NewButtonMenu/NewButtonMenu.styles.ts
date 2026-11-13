/**
 * Styles for the split New button.
 */
import type { CSSProperties } from 'react'

/** The wrapper, positioned so the menu can hang below it. */
export const wrapStyle: CSSProperties = { position: 'relative', display: 'inline-flex' }

/** The dropdown surface. */
export const menuStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 4,
  minWidth: 220,
  zIndex: 50,
  borderRadius: 8,
  padding: 4,
  background: 'var(--dsw-alias-bg-layer-3, #ffffff)',
  border: '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)',
  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.16)',
}

/** One row in the dropdown. */
export const menuRowStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '7px 10px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  font: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
}

/** The muted second line of a row. */
export const menuHintStyle: CSSProperties = {
  display: 'block',
  fontSize: 11,
  opacity: 0.6,
  marginTop: 1,
}
