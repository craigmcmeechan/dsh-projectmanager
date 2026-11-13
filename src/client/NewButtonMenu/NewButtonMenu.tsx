/**
 * A split "New" button.
 *
 * The primary half keeps the action people do most (new project); the caret
 * opens a small menu of the rarer ones. This is why the button is split rather
 * than replaced with a menu: the common path must stay one click.
 */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { menuHintStyle, menuRowStyle, menuStyle, wrapStyle } from './NewButtonMenu.styles.ts'
import type { NewButtonMenuProps } from './NewButtonMenu.interface.ts'

/**
 * Render the split button.
 * @param props - the menu actions and the disabled state.
 */
export function NewButtonMenu({ actions, disabled }: NewButtonMenuProps) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  // Close on an outside press or Escape: a menu that stays open after the user
  // moves on reads as a stuck overlay.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (wrap.current !== null && !wrap.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div style={wrapStyle} ref={wrap}>
      <Button
        variant="primary"
        size="sm"
        disabled={disabled === true}
        onClick={() => {
          const first = actions[0]
          if (first !== undefined) first.run()
        }}
      >
        New project
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={disabled === true}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More new items"
        onClick={() => setOpen((value) => !value)}
      >
        ▾
      </Button>

      {!open ? null : (
        <div style={menuStyle} role="menu">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              style={menuRowStyle}
              onClick={() => {
                setOpen(false)
                action.run()
              }}
            >
              {action.label}
              {action.hint === undefined ? null : <span style={menuHintStyle}>{action.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
