/**
 * SessionsPane — component.
 * Split out of client/SessionsPane.tsx by the module-structure refactor.
 */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { inputStyle as input, errorStyle } from '../styles/index.ts'
import type { SessionsPaneProps, SessionRow } from './SessionsPane.interface.ts'

/**
 * Render the sessions pane.
 * @param props - the project and its features, for seeding a discussion.
 */
export function SessionsPane({ projectId, features, startSession, listSessions }: SessionsPaneProps) {
  const [sessions, setSessions] = useState<SessionRow[] | undefined>(undefined)
  const [featureId, setFeatureId] = useState<string>(features[0]?.id ?? '')
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    void (async () => {
      if (listSessions === undefined) {
        setSessions([])
        return
      }
      try {
        setSessions(await listSessions())
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Could not list sessions.')
        setSessions([])
      }
    })()
  }, [projectId, listSessions])

  /** Seed a conversation with the brainstorm instruction for one feature. */
  const startDiscussion = (): void => {
    const feature = features.find((candidate) => candidate.id === featureId)
    const prompt =
      feature === undefined
        ? 'Let us think through a requirement for this project.'
        : [
            `Use the brainstorm approach on this feature before it enters the pipeline.`,
            ``,
            `Feature: ${feature.title}`,
            `Project id: ${projectId}`,
            `Feature id: ${feature.id}`,
            ``,
            `Work through what it is, why now, goals and anti-goals, and acceptance criteria.`,
            `Then write the requirement text and offer to save it to the feature specification.`,
          ].join('\n')

    try {
      startSession({ prompt })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not start the session.')
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Sessions</h3>
      <p style={{ fontSize: 13, opacity: 0.7, marginTop: 0 }}>
        Discuss a requirement conversationally before the team runs. The conversation is seeded with
        the brainstorm instruction, so the agent works the requirement rather than jumping to code.
      </p>

      {error === undefined ? null : (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      )}

      <div
        style={{
          border: '1px solid var(--dsw-alias-border-l4, #e5e7eb)',
          borderRadius: 8,
          padding: 14,
          marginBottom: 12,
        }}
      >
        <strong style={{ fontSize: 13 }}>Start a discussion</strong>
        {features.length === 0 ? (
          <p style={{ fontSize: 13, opacity: 0.7, margin: '6px 0 0' }}>
            This project has no features yet. Add one first so the conversation has a subject.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <select
                value={featureId}
                onChange={(event) => setFeatureId(event.target.value)}
                style={{ ...input, flex: 2 }}
              >
                {features.map((feature) => (
                  <option key={feature.id} value={feature.id}>
                    {feature.title} ({feature.status})
                  </option>
                ))}
              </select>
              <Button variant="primary" size="sm" onClick={startDiscussion}>
                Discuss requirement
              </Button>
            </div>
            <p style={{ fontSize: 11, opacity: 0.65, margin: '8px 0 0' }}>
              Opens a new session in the current workspace with the brainstorm prompt pre-filled.
            </p>
          </>
        )}
      </div>

      <h4 style={{ margin: '16px 0 8px', fontSize: 13 }}>Recent sessions</h4>
      {sessions === undefined ? (
        <p style={{ fontSize: 13, opacity: 0.7 }}>Loading…</p>
      ) : sessions.length === 0 ? (
        <p style={{ fontSize: 13, opacity: 0.7 }}>
          No sessions reported. Sessions opened from the sidebar appear here once the session
          controller is reachable.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {sessions.slice(0, 20).map((session) => (
            <li
              key={session.sessionId}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                padding: '7px 0',
                borderBottom: '1px solid var(--dsw-alias-border-l4, #f1f5f9)',
                fontSize: 13,
              }}
            >
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                {session.sessionId.slice(0, 22)}
              </span>
              <span style={{ opacity: 0.6, fontSize: 12 }}>
                {session.running ? 'running' : session.blank ? 'blank' : 'idle'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}