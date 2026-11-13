/**
 * SessionsPane — interface.
 * Split out of client/SessionsPane.tsx by the module-structure refactor.
 */
import type { Feature } from '../api/index.ts'

/** One session as the Harness reports it. */
export interface SessionRow {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  cwd?: string
}
/** Props for {@link SessionsPane}, injected by the owning plugin. */
export interface SessionsPaneProps {
  projectId: string
  features: Feature[]
  /** Start a session in the current workspace; supplied by the client context. */
  startSession: (options: { prompt: string }) => void
  /** List sessions, or undefined when the controller is unavailable. */
  listSessions?: () => Promise<SessionRow[]>
}