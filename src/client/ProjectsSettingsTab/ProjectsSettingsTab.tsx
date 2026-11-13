/**
 * ProjectsSettingsTab — component.
 * Split out of client/ProjectsSettingsTab.tsx by the module-structure refactor.
 */
import { useState } from 'react'
import { useSettings, save, type DisplayMode } from '../settings/index.ts'
import { hintStyle, errorStyle } from '../styles/index.ts'
import { rowStyle } from './ProjectsSettingsTab.styles.ts'

/**
 * Render the settings tab.
 * @returns the plugin's settings form.
 */
export function ProjectsSettingsTab() {
  const settings = useSettings()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const choose = async (mode: DisplayMode): Promise<void> => {
    if (busy || mode === settings.displayMode) return
    setBusy(true)
    setError(undefined)
    try {
      await save({ displayMode: mode })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the setting.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Plugin display</h3>
      <p style={{ ...hintStyle, marginTop: 0 }}>How the plugin appears in the left sidebar.</p>

      <div style={rowStyle}>
        <div>
          <div style={{ fontWeight: 500 }}>Display as own button</div>
          <div style={hintStyle}>
            On: a Projects row sits in the sidebar with its own panel. Off: the plugin appears as a
            row in the sidebar&apos;s More menu.
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            checked={settings.displayMode === 'button'}
            disabled={busy}
            onChange={(event) => void choose(event.target.checked ? 'button' : 'menu')}
          />
          {settings.displayMode === 'button' ? 'Yes' : 'No'}
        </label>
      </div>

      {error === undefined ? null : (
        <p role="alert" style={{ ...errorStyle, marginTop: 10 }}>
          {error}
        </p>
      )}

      <p style={{ ...hintStyle, marginTop: 14 }}>
        Changing this re-registers the sidebar entry immediately; a page reload is not required.
      </p>
    </section>
  )
}