/**
 * styles — styles.
 * Split out of client/styles.ts by the module-structure refactor.
 */
import { TEXT, FIELD_BG, BORDER } from './styles.module.ts'

/** Input, select, and textarea styling. */
export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 12px',
  borderRadius: 'var(--dsw-radius-md, 6px)',
  border: BORDER,
  // Both are needed: a native select paints its own background and does not
  // inherit colour from the parent, which is what made the text invisible.
  background: FIELD_BG,
  color: TEXT,
  font: 'inherit',
  fontSize: 13,
  boxSizing: 'border-box',
}
/** Monospace variant, for prompt bodies and identifiers. */
export const codeAreaStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  lineHeight: 1.5,
  resize: 'vertical',
}
/** Small field label. */
export const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 4,
  color: TEXT,
}
/** Supporting text under a control. */
export const hintStyle: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.7,
  marginTop: 2,
  color: TEXT,
}
/** A bordered section. */
export const cardStyle: React.CSSProperties = {
  border: BORDER,
  borderRadius: 8,
  padding: 14,
  marginBottom: 12,
  background: 'var(--dsw-alias-bg-layer-2, transparent)',
  color: TEXT,
}
/** A table cell. */
export const cellStyle: React.CSSProperties = {
  padding: '10px 8px',
  textAlign: 'left',
  fontSize: 13,
  color: TEXT,
}
/** A table header cell. */
export const headCellStyle: React.CSSProperties = {
  ...cellStyle,
  fontWeight: 600,
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  opacity: 0.6,
  borderBottom: BORDER,
}
/** A section heading. */
export const headingStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 15,
  color: TEXT,
}
/** The error colour, for validation text. */
export const errorStyle: React.CSSProperties = {
  color: 'var(--dsw-alias-state-error-primary, #b42318)',
  fontSize: 13,
}