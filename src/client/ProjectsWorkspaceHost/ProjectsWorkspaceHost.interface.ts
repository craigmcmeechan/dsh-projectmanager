/**
 * ProjectsWorkspaceHost — interface.
 * Split out of client/ProjectsWorkspaceHost.tsx by the module-structure refactor.
 */
import type { DirectoryPickerApi } from '../DirectoryPicker/index.ts'

/** Session actions the panel needs. */
export interface SessionsInjected {
  /** Start a new session in the current workspace with a prompt pre-filled. */
  startSession: (options: { prompt: string }) => void
  /**
   * Create a Workspace for a path and start a Session in it.
   *
   * Used after this plugin makes a directory on disk: the Workspace registry owns
   * path validation and the Session is started through the workspace service, so
   * neither is reimplemented here.
   */
  openWorkspace?: (path: string) => Promise<void>
  /**
   * Open a terminal tab in the right sidebar.
   *
   * The terminal stack is a shipped plugin; this only asks it to open a tab,
   * rather than spawning a shell of its own.
   */
  openTerminal?: () => void
  /** Called after a project or template is created or removed, to refresh the sidebar. */
  onProjectsChanged?: () => void
  /** List known sessions, when the controller is available. */
  listSessions?: () => Promise<
    Array<{ sessionId: string; updatedAt: number; running: boolean; blank: boolean; cwd?: string }>
  >
}
/** Minimal shape of the workspace service this host uses. */
export interface WorkspaceService {
  startSession(
    workspaceId?: string,
    options?: { prompt?: string; whenDraftExists?: 'keep' | 'replace' | 'append'; agentPreset?: string },
  ): void
}
/** Minimal shape of the session controller remote. */
export interface SessionController {
  list(request: unknown): Promise<{ items?: unknown[]; sessions?: unknown[] }>
}
/** Props the slot passes to the panel host. */
export interface ProjectsWorkspaceHostProps {
  /** Injected by the registering plugin. */
  inject: SessionsInjected
  /**
   * Directory picker, when the composition has one.
   *
   * Optional because a profile may compose no picker; the wizard then falls
   * back to a typed path rather than failing.
   */
  picker?: DirectoryPickerApi | undefined
}