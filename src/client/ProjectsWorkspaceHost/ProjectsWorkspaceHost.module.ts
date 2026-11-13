/**
 * ProjectsWorkspaceHost — module.
 * Split out of client/ProjectsWorkspaceHost.tsx by the module-structure refactor.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionsInjected, WorkspaceService, SessionController } from './ProjectsWorkspaceHost.interface.ts'

/**
 * Build the injected face from the client context.
 * @param ctx - the client context provided by the slot runtime.
 * @returns the session actions, degrading to a no-op with a clear error when the
 * services are absent.
 */
export function sessionsFrom(ctx: Context): SessionsInjected {
  const workspace = ctx.get('uiWorkspace') as WorkspaceService | undefined

  const startSession = (options: { prompt: string }): void => {
    if (workspace === undefined || typeof workspace.startSession !== 'function') {
      throw new Error('the workspace service is not available in this composition')
    }
    // `append` keeps anything already drafted rather than discarding it.
    workspace.startSession(undefined, { prompt: options.prompt, whenDraftExists: 'append' })
  }

  // The terminal tab belongs to the shipped sidebar-terminals plugin. Opening it
  // through the sidebar service reuses that plugin's PTY, sizing, theme, and
  // recovery instead of standing up a second shell channel here.
  /**
   * Register a path as a Workspace and start a Session in it.
   *
   * `workspaces.create` is idempotent on path, so pointing at an existing
   * directory adopts it rather than failing.
   */
  const openWorkspace = async (path: string): Promise<void> => {
    const remote = ctx.get('remote') as
      | { workspace?: { create?: (request: { path: string }) => Promise<unknown> } }
      | undefined
    // The generated namespace is `workspace`, not `workspaceController`: the
    // service class name and its wire namespace differ, and guessing the class
    // name produced "the workspace service is not available".
    const create = remote?.workspace?.create
    if (typeof create !== 'function') {
      throw new Error('the workspace service is not available in this composition')
    }
    // `create` answers with a result envelope, the same shape `directoryPicker`
    // uses: unwrap it, and surface a failure as a rejection.
    const envelope = (await create({ path })) as unknown as
      | { ok: true; value: { workspace?: { workspaceId?: string } } }
      | { ok: false; error?: { message?: string } }
    if (envelope !== null && typeof envelope === 'object' && 'ok' in envelope && envelope.ok === false) {
      throw new Error(envelope.error?.message ?? 'could not create the workspace')
    }
    const value =
      envelope !== null && typeof envelope === 'object' && 'ok' in envelope && envelope.ok === true
        ? envelope.value
        : (envelope as unknown as { workspace?: { workspaceId?: string } })
    const workspaceId = value?.workspace?.workspaceId

    const workspace = ctx.get('uiWorkspace') as
      | { startSession?: (workspaceId?: string, options?: Record<string, unknown>) => void }
      | undefined
    if (typeof workspace?.startSession !== 'function') {
      throw new Error('the session service is not available in this composition')
    }
    workspace.startSession(workspaceId, {})
  }

  const openTerminal = (): void => {
    const sidebar = ctx.get('sidebarRight') as
      | {
          mounted?: { getSnapshot: () => string | undefined }
          openTabIn?: (sessionId: string, kind: string) => void
        }
      | undefined
    if (typeof sidebar?.openTabIn !== 'function') {
      throw new Error('the sidebar terminal plugin is not available in this composition')
    }
    // `commandTarget()` was the wrong API: it resolves an *already open* pane and
    // returns undefined with the right sidebar closed, which made this a silent
    // no-op. `mounted` reports the on-screen Session regardless, and `openTabIn`
    // opens the tab into that Session's sidebar.
    const sessionId = sidebar.mounted?.getSnapshot()
    if (sessionId === undefined) {
      throw new Error('no Session is on screen, so there is nowhere to open a terminal')
    }
    sidebar.openTabIn(sessionId, 'terminal')
  }

  // The wire namespace is `session` (from the generated client), not
  // `sessionController`: the class name and the namespace differ, and using the
  // class name made this lookup silently return undefined.
  const remote = ctx.get('remote') as { session?: SessionController } | undefined
  const controller = remote?.session
  const listSessions =
    controller === undefined
      ? undefined
      : async (): Promise<Array<{ sessionId: string; updatedAt: number; running: boolean; blank: boolean; cwd?: string }>> => {
          // `list` answers with a result envelope: `{ ok, value }`. Reading
          // `.items` straight off it always produced an empty list.
          const envelope = (await controller.list({})) as unknown as
            | { ok: true; value?: { items?: unknown[]; sessions?: unknown[] } | unknown[] }
            | { ok: false; error?: { message?: string } }
          if (envelope !== null && typeof envelope === 'object' && 'ok' in envelope && envelope.ok === false) {
            throw new Error(envelope.error?.message ?? 'could not list sessions')
          }
          const value =
            envelope !== null && typeof envelope === 'object' && 'ok' in envelope && envelope.ok === true
              ? envelope.value
              : (envelope as unknown as { items?: unknown[]; sessions?: unknown[] })
          const list = Array.isArray(value) ? value : (value?.items ?? value?.sessions ?? [])
          const rows = list as Array<{
            sessionId: string
            updatedAt?: number
            running?: boolean
            blank?: boolean
            cwd?: string
          }>
          return rows.map((row) => ({
            sessionId: String(row.sessionId),
            updatedAt: Number(row.updatedAt ?? 0),
            running: row.running === true,
            blank: row.blank === true,
            ...(row.cwd === undefined ? {} : { cwd: row.cwd }),
          }))
        }

  return {
    startSession,
    openWorkspace,
    openTerminal,
    ...(listSessions === undefined ? {} : { listSessions }),
  }
}