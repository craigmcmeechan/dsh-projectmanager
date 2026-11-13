/**
 * DevelopmentInfraTab — component.
 * Split out of client/DevelopmentInfraTab.tsx by the module-structure refactor.
 */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { cardStyle, errorStyle, headingStyle, hintStyle, inputStyle } from '../styles/index.ts'
import { deleteHost, getHostFacts, installDocker, installGit, installNvm, listHosts, probeHostFacts, saveHost, type HostFacts, type RemoteHostView } from '../machine-api/index.ts'
import { memory } from './DevelopmentInfraTab.module.ts'
import type { DevelopmentInfraTabProps } from './DevelopmentInfraTab.interface.ts'

/** One test row: a capability, its state, and an optional action. */
function TestRow({
  label,
  state,
  detail,
  action,
}: {
  label: string
  state: 'ok' | 'missing' | 'warn'
  detail: string
  action?: React.ReactNode
}) {
  const colour =
    state === 'ok'
      ? 'var(--dsw-alias-state-success-primary, #15803d)'
      : state === 'missing'
        ? 'var(--dsw-alias-state-error-primary, #b42318)'
        : '#b45309'
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        padding: '6px 0',
        borderTop: '0.5px solid var(--dsw-alias-border-l4, #e5e7eb)',
        fontSize: 12,
      }}
    >
      <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
        <span aria-hidden="true" style={{ color: colour, fontWeight: 700 }}>
          {state === 'ok' ? '✓' : state === 'missing' ? '✕' : '!'}
        </span>
        <strong style={{ fontWeight: 600 }}>{label}</strong>
        <span style={{ opacity: 0.7 }}>{detail}</span>
      </span>
      {action}
    </div>
  )
}
/** Facts block for one host. */
function HostFactsBlock({ facts }: { facts: HostFacts }) {
  const { system, node, docker } = facts
  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ opacity: 0.8 }}>
        <strong>{system.os}</strong>
        <span style={{ opacity: 0.7 }}>
          {' '}
          · kernel {system.kernel} · {system.arch}
        </span>
      </div>
      <div style={{ opacity: 0.7 }}>
        {memory(system.totalMemoryBytes)} RAM
        {system.freeMemoryBytes === undefined ? '' : ` (${memory(system.freeMemoryBytes)} free)`}
        {system.cpus === undefined ? '' : ` · ${system.cpus} CPU`}
      </div>
      <div style={{ marginTop: 6 }}>
        <TestRow
          label="Node"
          state={node.current.found ? 'ok' : 'missing'}
          detail={node.current.found ? (node.current.version ?? 'present') : (node.current.reason ?? 'not found')}
        />
        <TestRow
          label="nvm"
          state={node.nvm.found ? 'ok' : 'warn'}
          detail={
            node.nvm.found
              ? `${node.nvm.version ?? 'present'} · ${node.installed.length} version(s) installed`
              : (node.nvm.reason ?? 'not installed')
          }
        />
        <TestRow
          label="git"
          state={system.gitInstalled ? 'ok' : 'missing'}
          detail={system.gitInstalled ? (system.gitVersion ?? 'present') : 'not installed'}
        />
        <TestRow
          label="Docker"
          state={docker.installed ? (docker.daemon ? 'ok' : 'warn') : 'missing'}
          detail={
            docker.installed
              ? docker.daemon
                ? `${docker.version ?? 'present'} · daemon running · ${docker.images.length} image(s)`
                : `client ${docker.version ?? ''} but daemon unreachable`
              : 'not installed'
          }
        />
      </div>
      {docker.daemon && docker.images.length > 0 ? (
        <div style={{ marginTop: 6 }}>
          <strong>Images</strong>
          <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
            {docker.images.map((image) => (
              <li key={`${image.repository}:${image.tag}`}>
                <code>
                  {image.repository}:{image.tag}
                </code>
                {image.sizeBytes > 0 ? (
                  <span style={{ opacity: 0.6 }}> · {Math.round(image.sizeBytes / 1024 / 1024)} MB</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
/**
 * Render the development infrastructure screen.
 * @param props - the current project.
 */
export function DevelopmentInfraTab({ projectId }: DevelopmentInfraTabProps) {
  const [local, setLocal] = useState<HostFacts | undefined>(undefined)
  const [hosts, setHosts] = useState<RemoteHostView[]>([])
  const [results, setResults] = useState<Record<string, HostFacts | { error: string }>>({})
  const [label, setLabel] = useState('')
  const [addr, setAddr] = useState('')
  const [user, setUser] = useState('')
  const [port, setPort] = useState('22')
  const [keyPath, setKeyPath] = useState('')
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [message, setMessage] = useState<string | undefined>(undefined)

  const refresh = async (): Promise<void> => {
    try {
      const [facts, hostList] = await Promise.all([getHostFacts(projectId), listHosts(projectId)])
      setLocal(facts)
      setHosts(hostList.hosts)
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not probe this machine.')
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  /** Test one saved host. */
  const testHost = async (entry: RemoteHostView): Promise<void> => {
    setBusy(entry.id)
    setMessage(`Testing ${entry.label}…`)
    try {
      const facts = await probeHostFacts(projectId, {
        host: entry.host,
        user: entry.user,
        port: entry.port,
      })
      setResults((current) => ({ ...current, [entry.id]: facts }))
      setMessage(`${entry.label}: probed.`)
    } catch (failure) {
      setResults((current) => ({
        ...current,
        [entry.id]: { error: failure instanceof Error ? failure.message : 'probe failed' },
      }))
      setMessage(undefined)
    } finally {
      setBusy(undefined)
    }
  }

  const addHost = async (): Promise<void> => {
    setError(undefined)
    try {
      await saveHost(projectId, {
        label,
        host: addr,
        user,
        port: Number(port) || 22,
        ...(keyPath.trim().length === 0 ? {} : { keyPath: keyPath.trim() }),
      })
      setLabel('')
      setAddr('')
      setUser('')
      setPort('22')
      setKeyPath('')
      await refresh()
      setMessage('Host saved.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save that host.')
    }
  }

  const removeHost = async (id: string): Promise<void> => {
    try {
      await deleteHost(projectId, id)
      setResults((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      await refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not remove that host.')
    }
  }

  /** Run one install action on the local target and re-probe. */
  const runInstall = async (
    kind: 'git' | 'docker' | 'nvm',
  ): Promise<void> => {
    setBusy(kind)
    setMessage(`Installing ${kind}…`)
    try {
      const payload =
        kind === 'git' ? await installGit(projectId) : kind === 'docker' ? await installDocker(projectId) : await installNvm(projectId)
      setMessage(payload.result.ok ? `${kind}: ${payload.result.detail}` : `${kind}: ${payload.result.detail}`)
      await refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : `Could not install ${kind}.`)
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <section>
      <h3 style={headingStyle}>Development infrastructure</h3>
      <p style={{ ...hintStyle, marginTop: 0 }}>
        Per-host checks. The project's own target is listed first; saved hosts can be tested
        individually.
      </p>

      {error === undefined ? null : <p style={errorStyle}>{error}</p>}
      {message === undefined ? null : <p style={hintStyle}>{message}</p>}

      {/* -------------------------------------------------- the project's host */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <strong style={{ fontSize: 13 }}>Project host</strong>
          <span style={{ fontSize: 11, opacity: 0.7 }}>{local?.target ?? 'probing…'}</span>
        </div>

        {local === undefined ? (
          <p style={{ ...hintStyle }}>Probing…</p>
        ) : (
          <>
            <div style={{ marginTop: 6 }}>
              <HostFactsBlock facts={local} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {!local.system.gitInstalled ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== undefined || !local.system.canInstallPackages}
                  onClick={() => void runInstall('git')}
                  title={
                    local.system.canInstallPackages
                      ? 'Install git on this host'
                      : 'This user cannot install packages on that host'
                  }
                >
                  {busy === 'git' ? 'Installing git…' : 'Install git'}
                </Button>
              ) : null}
              {!local.docker.installed ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== undefined || !local.system.canInstallPackages}
                  onClick={() => void runInstall('docker')}
                  title={
                    local.system.canInstallPackages
                      ? 'Install Docker on this host'
                      : 'This user cannot install packages on that host'
                  }
                >
                  {busy === 'docker' ? 'Installing Docker…' : 'Install Docker'}
                </Button>
              ) : null}
              {!local.node.nvm.found ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== undefined}
                  onClick={() => void runInstall('nvm')}
                >
                  {busy === 'nvm' ? 'Installing nvm…' : 'Install nvm'}
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" disabled={busy !== undefined} onClick={() => void refresh()}>
                Re-test
              </Button>
            </div>
            {!local.system.canInstallPackages ? (
              <div style={hintStyle}>
                This user cannot install packages on that host, so install actions are disabled
                rather than failing after a click.
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* ------------------------------------------------------- remote hosts */}
      <div style={cardStyle}>
        <strong style={{ fontSize: 13 }}>Remote hosts</strong>
        <div style={{ ...hintStyle, marginBottom: 8 }}>
          Machines a remote project can target. Each is probed where it runs, not here.
        </div>

        {hosts.length === 0 ? (
          <p style={{ ...hintStyle, marginTop: 0 }}>No hosts saved yet.</p>
        ) : (
          hosts.map((entry) => {
            const result = results[entry.id]
            return (
              <div
                key={entry.id}
                style={{
                  border: '0.5px solid var(--dsw-alias-border-l4, #e5e7eb)',
                  borderRadius: 6,
                  padding: 10,
                  marginBottom: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 12 }}>
                    <strong>{entry.label}</strong>
                    <span style={{ opacity: 0.7 }}>
                      {' '}
                      — {entry.user}@{entry.host}:{entry.port}
                    </span>
                    <span style={{ opacity: 0.55 }}> · key {entry.keySet ? 'configured' : 'default'}</span>
                  </span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== undefined}
                      onClick={() => void testHost(entry)}
                    >
                      {busy === entry.id ? 'Testing…' : 'Test'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void removeHost(entry.id)}>
                      Remove
                    </Button>
                  </span>
                </div>

                {result === undefined ? (
                  <div style={{ ...hintStyle, marginTop: 4 }}>Not tested yet.</div>
                ) : 'error' in result ? (
                  <p style={{ ...errorStyle, marginTop: 6, fontSize: 12 }}>{result.error}</p>
                ) : (
                  <div style={{ marginTop: 6 }}>
                    <HostFactsBlock facts={result} />
                  </div>
                )}
              </div>
            )
          })
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <input
            aria-label="Host label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label"
            style={{ ...inputStyle, flex: 1, minWidth: 90 }}
          />
          <input
            aria-label="Host address"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="Host or IP"
            style={{ ...inputStyle, flex: 2, minWidth: 120 }}
          />
          <input
            aria-label="SSH user"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="User"
            style={{ ...inputStyle, flex: 1, minWidth: 80 }}
          />
          <input
            aria-label="SSH port"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="22"
            style={{ ...inputStyle, width: 66 }}
          />
        </div>
        <input
          aria-label="Private key path"
          value={keyPath}
          onChange={(e) => setKeyPath(e.target.value)}
          placeholder="Private key path (optional; default key or agent otherwise)"
          style={{ ...inputStyle, marginTop: 8 }}
        />
        <div style={{ marginTop: 8 }}>
          <Button variant="primary" size="sm" disabled={busy !== undefined} onClick={() => void addHost()}>
            Save host
          </Button>
        </div>
        <div style={hintStyle}>
          No password is stored. Key auth is what the remote flow sets up; a password at rest is a
          leak waiting to happen.
        </div>
      </div>

      <div style={hintStyle}>
        Cloudflare and GitHub credentials live in Settings, since they are configuration rather than
        what a machine can run.
      </div>
    </section>
  )
}