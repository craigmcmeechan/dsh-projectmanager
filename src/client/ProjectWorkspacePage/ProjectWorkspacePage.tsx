/**
 * A project's or template's own panel in the main area.
 *
 * This is the destination for the sidebar row of the same name. It lists the
 * workspaces that live under this project's root, and the sessions in them, so
 * a project is one place rather than an entry buried in the generic Workspaces
 * tree.
 *
 * It reads `uiWorkspace` rather than owning any state: workspace membership is
 * the controller's, and duplicating it here would drift the moment a session is
 * created elsewhere.
 */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '@deepseek-ai/cordis'
import { hintStyle, pageStyle, rowStyle } from './ProjectWorkspacePage.styles.ts'
import type { ProjectWorkspacePageProps } from './ProjectWorkspacePage.interface.ts'

/** A workspace under this project, as the panel shows it. */
interface WorkspaceRow {
  workspaceId: string
  path: string
  title: string
  sessionIds: readonly string[]
}

/** Props the slot injects: the row, plus a live reader for workspaces. */
export type ProjectWorkspacePageInjected = ProjectWorkspacePageProps & {
  /** Read the current workspaces, filtered to this project by the caller. */
  listWorkspaces?: () => WorkspaceRow[]
  /** Start a session in a workspace. */
  startSession?: (workspaceId: string) => void
}

/**
 * Render the panel.
 * @param props - the row and the workspace reader.
 */
export function ProjectWorkspacePage({ row, listWorkspaces, startSession }: ProjectWorkspacePageInjected) {
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([])

  // Poll the controller's snapshot rather than subscribing to a private store:
  // the panel must not depend on internals it does not own.
  useEffect(() => {
    const read = (): void => {
      if (listWorkspaces !== undefined) setWorkspaces(listWorkspaces())
    }
    read()
    const timer = setInterval(read, 2000)
    return () => clearInterval(timer)
  }, [listWorkspaces])

  return (
    <div style={pageStyle}>
      <header style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, opacity: 0.6 }}>Project Manager \ {row.kind}</div>
        <h2 style={{ margin: 0, fontSize: 16 }}>{row.label}</h2>
        <div style={{ ...hintStyle, fontSize: 12, opacity: 0.6 }} title={row.root}>
          {row.root}
        </div>
      </header>

      <h3 style={{ fontSize: 13, marginTop: 0 }}>Workspaces</h3>
      {workspaces.length === 0 ? (
        <p style={hintStyle}>
          No workspaces yet for this {row.kind}. Start one from the Workspaces section, or create a
          session and point it here.
        </p>
      ) : (
        workspaces.map((workspace) => (
          <div key={workspace.workspaceId} style={rowStyle}>
            <div>
              <div style={{ fontWeight: 500 }}>{workspace.title}</div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>{workspace.path}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, opacity: 0.6 }}>
                {workspace.sessionIds.length} session{workspace.sessionIds.length === 1 ? '' : 's'}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => startSession?.(workspace.workspaceId)}
              >
                New session
              </Button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

/**
 * Build the injected face for a row.
 *
 * Filters to this project's root, so a row shows its own workspaces rather than
 * every workspace on the machine.
 * @param ctx - client context.
 * @param row - the project or template this panel belongs to.
 */
export function workspacePageInject(ctx: Context, row: ProjectWorkspacePageProps['row']): ProjectWorkspacePageInjected {
  const workspace = ctx.get('uiWorkspace') as
    | {
        workspaces?: { getSnapshot?: () => { items?: WorkspaceRow[] } }
        startSession?: (workspaceId?: string) => void
      }
    | undefined
  return {
    row,
    listWorkspaces: () => {
      const items = workspace?.workspaces?.getSnapshot?.().items ?? []
      // A workspace belongs to this project when its path is under the row's
      // root. That is the only membership signal a plugin can read.
      return items.filter(
        (item) => typeof item.path === 'string' && (item.path === row.root || item.path.startsWith(`${row.root}/`)),
      )
    },
    ...(typeof workspace?.startSession === 'function'
      ? { startSession: (workspaceId: string) => workspace.startSession!(workspaceId) }
      : {}),
  }
}

/**
 * The page the "Projects" header opens.
 *
 * A sidebar section caption is still a button in this shell, so it needs a
 * destination. Rather than show an empty page, this explains the grouping: it is
 * the only place a user can learn that each project has its own row.
 */
export function ProjectsOverviewPage() {
  return (
    <div style={pageStyle}>
      <header style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, opacity: 0.6 }}>Project Manager</div>
        <h2 style={{ margin: 0, fontSize: 16 }}>Projects</h2>
      </header>
      <p style={hintStyle}>
        Every project and project template has its own row in the sidebar, below this heading.
        Selecting one shows its workspaces and sessions here.
      </p>
      <p style={hintStyle}>
        Use <strong>Project Manager</strong> above for the full list, or <strong>More</strong> to
        reach anything not currently pinned to the sidebar.
      </p>
    </div>
  )
}
