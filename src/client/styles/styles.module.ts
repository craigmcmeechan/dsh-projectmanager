/**
 * styles — module.
 * Split out of client/styles.ts by the module-structure refactor.
 */
/**
 * Shared form styles built on the real DSH theme tokens.
 *
 * Earlier revisions of this plugin invented `--dsh-*` variables that do not
 * exist, so every declaration fell back to `#fff` and a `<select>` with
 * `color: inherit` rendered white text on a white field. These are the actual
 * tokens the shipped primitives use:
 *
 *   --dsw-alias-bg-layer-3            field background
 *   --dsw-alias-label-primary         body text
 *   --dsw-alias-border-l4             field border
 *   --dsw-alias-interactive-bg-hover  hover fill
 *   --dsw-radius-md                   control radius
 *
 * Native `<select>` does not inherit `color`, so it must be set explicitly —
 * that is the specific cause of the invisible text.
 */

/** Body and field text colour. */
export const TEXT = 'var(--dsw-alias-label-primary, #1f2329)'
/** Field background, one layer above the page. */
export const FIELD_BG = 'var(--dsw-alias-bg-layer-3, #ffffff)'
/** Hairline border. */
export const BORDER = '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)'
/**
 * Style for a sidebar-style navigation row, selected or not.
 * @param selected - whether this row is the current section.
 */
export function navRowStyle(selected: boolean): React.CSSProperties {
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '7px 8px',
    marginBottom: 2,
    borderRadius: 'var(--dsw-radius-md, 6px)',
    border: 'none',
    background: selected ? 'var(--dsw-alias-interactive-bg-active, #eff6ff)' : 'transparent',
    color: selected ? 'var(--dsw-alias-label-primary, #1d4ed8)' : TEXT,
    fontSize: 13,
    fontWeight: selected ? 600 : 400,
    cursor: 'pointer',
    font: 'inherit',
  }
}