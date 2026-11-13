/**
 * Styles for the New Template wizard.
 */
import type { CSSProperties } from 'react'

/** One field block. */
export const fieldBlock: CSSProperties = { marginBottom: 14 }

/** The folder path previewed on the folder step. */
export const folderPreviewStyle: CSSProperties = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: 12,
  padding: '6px 10px',
  borderRadius: 6,
  background: 'var(--dsw-alias-bg-layer-3, #f8fafc)',
  border: '0.5px solid var(--dsw-alias-border-l4, #e2e8f0)',
  wordBreak: 'break-all',
}
