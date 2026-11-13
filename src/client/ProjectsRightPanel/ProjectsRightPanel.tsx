/**
 * ProjectsRightPanel — component.
 *
 * The panel inside the right sidebar tab, with its own top-right menu.
 *
 * The store manager lives here rather than in the main panel because it is
 * plugin-wide: it is about this installation (images, servers, defaults), not
 * about one project. The tab body receives no injected services, so the
 * session-starting face stays honest about that limitation.
 */
import { useState } from 'react'
import { ProjectsPanel } from '../ProjectsPanel/index.ts'
import { StoreManager } from '../StoreManager/index.ts'

/** Which view the right tab is showing. */
type View = 'projects' | 'stores'

/**
 * Render the panel inside the right sidebar tab.
 */
export function ProjectsRightPanel() {
  const [view, setView] = useState<View>('projects')

  if (view === 'stores') {
    return <StoreManager onBack={() => setView('projects')} />
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '6px 10px 0',
          gap: 6,
        }}
      >
        <button
          type="button"
          onClick={() => setView('stores')}
          title="Manage plugin-wide stores"
          aria-label="Manage stores"
          style={{
            border: '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)',
            borderRadius: 6,
            background: 'transparent',
            color: 'var(--dsw-alias-label-primary, inherit)',
            font: 'inherit',
            fontSize: 12,
            padding: '3px 9px',
            cursor: 'pointer',
          }}
        >
          Manage remote servers
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ProjectsPanel
          sessions={{
            startSession: () => {
              throw new Error(
                'start a session from the main panel, where the workspace service is available',
              )
            },
          }}
        />
      </div>
    </div>
  )
}
