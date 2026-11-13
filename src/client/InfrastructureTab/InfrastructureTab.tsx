/**
 * InfrastructureTab — component.
 * Split out of client/InfrastructureTab.tsx by the module-structure refactor.
 */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { cardStyle, errorStyle, hintStyle, headingStyle } from '../styles/index.ts'
import { dockerProbe, listInfrastructure, pullImage, saveInfrastructure, type DockerProbe, type InfraOption, type InfraRequirement } from '../infra-api/index.ts'
import type { InfrastructureTabProps } from './InfrastructureTab.interface.ts'

/**
 * Render the infrastructure configuration.
 * @param props - the project and a change callback.
 */
export function InfrastructureTab({ projectId, onChanged }: InfrastructureTabProps) {
  const [probe, setProbe] = useState<DockerProbe | undefined>(undefined)
  const [requirements, setRequirements] = useState<InfraRequirement[]>([])
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [message, setMessage] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const refresh = async (): Promise<void> => {
    try {
      const [docker, infra] = await Promise.all([dockerProbe(projectId), listInfrastructure(projectId)])
      setProbe(docker)
      setRequirements(infra.requirements)
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not read infrastructure state.')
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const chosen = new Set(requirements.map((entry) => entry.provider))

  const choose = async (option: InfraOption): Promise<void> => {
    setBusy(option.provider)
    setMessage(undefined)
    try {
      await saveInfrastructure(projectId, { provider: option.provider })
      await refresh()
      onChanged()
      setMessage(`${option.label} added to this project's requirements.`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save.')
    } finally {
      setBusy(undefined)
    }
  }

  const pull = async (option: InfraOption): Promise<void> => {
    if (option.image === undefined) return
    setBusy(option.image)
    setMessage(`Pulling ${option.image}… this can take several minutes.`)
    try {
      const { result } = await pullImage(projectId, option.image)
      setMessage(result.ok ? `Pulled ${result.image}.` : `Pull failed: ${result.detail}`)
      await refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Pull failed.')
    } finally {
      setBusy(undefined)
    }
  }

  const dockerOk = probe?.status.available === true

  return (
    <section>
      <h3 style={headingStyle}>Infrastructure</h3>
      <p style={{ ...hintStyle, marginTop: 0 }}>
        What this project needs running. Distinct from Technologies, which records what the code is
        written with.
      </p>

      {/* Docker state first: a containerised choice made against a dead daemon is
          a decision the user should make knowingly. */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <strong style={{ fontSize: 13 }}>Docker</strong>
          <span style={{ fontSize: 12, opacity: 0.8 }}>
            {probe === undefined
              ? 'checking…'
              : dockerOk
                ? `available (${probe.status.version ?? 'unknown version'})`
                : `unavailable — ${probe.status.reason ?? 'no reason given'}`}
          </span>
        </div>
        {!dockerOk && probe !== undefined ? (
          <p style={{ ...hintStyle, marginBottom: 0 }}>
            Containerised options below can be recorded but not pulled until Docker answers. Local
            options are unaffected.
          </p>
        ) : null}
      </div>

      {error === undefined ? null : <p style={errorStyle}>{error}</p>}

      {probe === undefined ? (
        <p style={hintStyle}>Loading options…</p>
      ) : (
        <>
          {['database', 'identity', 'cache', 'storage', 'queue', 'other'].map((kind) => {
            const options = probe.options.filter((option) => option.kind === kind)
            if (options.length === 0) return null
            return (
              <div key={kind} style={cardStyle}>
                <strong style={{ fontSize: 13, textTransform: 'capitalize' }}>{kind}</strong>
                <div style={{ marginTop: 8 }}>
                  {options.map((option) => {
                    const isChosen = chosen.has(option.provider)
                    const image = option.image === undefined
                      ? undefined
                      : probe.images.find((entry) => entry.image === option.image)
                    const canPull = dockerOk && image?.present !== true
                    return (
                      <div
                        key={option.provider}
                        style={{
                          display: 'flex',
                          gap: 10,
                          alignItems: 'center',
                          padding: '8px 0',
                          borderTop: '0.5px solid var(--dsw-alias-border-l4, #e5e7eb)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChosen}
                          disabled={busy !== undefined}
                          onChange={() => void choose(option)}
                          aria-label={`Use ${option.label}`}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'baseline' }}>
                            <strong>{option.label}</strong>
                            {option.containerised ? (
                              <span style={{ fontSize: 11, opacity: 0.65 }}>container</span>
                            ) : (
                              <span style={{ fontSize: 11, opacity: 0.65 }}>local</span>
                            )}
                            {option.port === undefined ? null : (
                              <span style={{ fontSize: 11, opacity: 0.55 }}>port {option.port}</span>
                            )}
                          </div>
                          <div style={{ ...hintStyle, marginTop: 1 }}>{option.description}</div>
                          {option.image === undefined ? null : (
                            <div style={{ fontSize: 11, marginTop: 2, opacity: 0.75 }}>
                              <code>{option.image}</code>{' '}
                              {image === undefined
                                ? ''
                                : image.present
                                  ? `· present${image.sizeBytes === undefined ? '' : ` (${Math.round(image.sizeBytes / 1024 / 1024)} MB)`}`
                                  : '· not pulled'}
                            </div>
                          )}
                        </div>
                        {option.image !== undefined && canPull ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy !== undefined}
                            onClick={() => void pull(option)}
                            title={
                              dockerOk
                                ? 'Download this image now'
                                : 'Docker must be available before an image can be pulled'
                            }
                          >
                            {busy === option.image ? 'Pulling…' : 'Pull'}
                          </Button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </>
      )}

      {requirements.length > 0 ? (
        <div style={cardStyle}>
          <strong style={{ fontSize: 13 }}>Recorded for this project</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>
            {requirements.map((entry) => (
              <li key={entry.id}>
                {entry.label || entry.provider}
                <span style={{ opacity: 0.6 }}> — {entry.kind}</span>
                {entry.containerised && entry.image ? (
                  <span style={{ opacity: 0.6 }}> · {entry.image}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {message === undefined ? null : <p style={{ ...hintStyle }}>{message}</p>}
    </section>
  )
}