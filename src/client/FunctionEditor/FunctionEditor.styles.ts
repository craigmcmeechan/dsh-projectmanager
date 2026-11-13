/**
 * Styles for the function editor.
 */
import type { CSSProperties } from 'react'

/** The editor's frame. */
export const editorStyle: CSSProperties = {
  border: '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)',
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
}

/** A monospace hint showing the rendered template. */
export const previewStyle: CSSProperties = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: 12,
  padding: '5px 8px',
  borderRadius: 6,
  background: 'var(--dsw-alias-bg-layer-3, #f8fafc)',
  border: '0.5px solid var(--dsw-alias-border-l4, #e2e8f0)',
  display: 'inline-block',
}
