/**
 * SettingsTab — component.
 * Split out of client/SettingsTab.tsx by the module-structure refactor.
 */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { cardStyle, errorStyle, hintStyle, inputStyle, labelStyle } from '../styles/index.ts'
import { getMachineSettings, importDefinitions, saveMachineSettings, type MachineSettingsView } from '../machine-api/index.ts'
import type { SettingsTabProps } from './SettingsTab.interface.ts'

/**
 * Render the settings screen.
 * @param props - the current project.
 */
export function SettingsTab({ projectId }: SettingsTabProps) {
  const [settings, setSettings] = useState<MachineSettingsView>({})
  const [accountId, setAccountId] = useState('')
  const [zone, setZone] = useState('')
  const [cfToken, setCfToken] = useState('')
  const [owner, setOwner] = useState('')
  const [ghToken, setGhToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [message, setMessage] = useState<string | undefined>(undefined)
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = async (): Promise<void> => {
    try {
      const payload = await getMachineSettings(projectId)
      setSettings(payload.settings)
      setAccountId(payload.settings.cloudflare?.accountId ?? '')
      setZone(payload.settings.cloudflare?.zone ?? '')
      setOwner(payload.settings.github?.owner ?? '')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not load settings.')
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    setMessage(undefined)
    try {
      const payload = await saveMachineSettings(projectId, {
        cloudflare: {
          accountId,
          zone,
          // An empty string tells the host "keep what you have"; the mask is not
          // a value the user typed.
          ...(cfToken.trim().length === 0 ? {} : { token: cfToken }),
        },
        github: {
          owner,
          ...(ghToken.trim().length === 0 ? {} : { token: ghToken }),
        },
      })
      setSettings(payload.settings)
      setCfToken('')
      setGhToken('')
      setMessage('Saved.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  const importFile = async (file: File): Promise<void> => {
    setBusy(true)
    setError(undefined)
    setMessage(undefined)
    try {
      const text = await file.text()
      const payload = await importDefinitions(projectId, text)
      setMessage(
        `Imported ${payload.imported.teams} team(s) and ${payload.imported.agents} agent(s).`,
      )
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not import that file.')
    } finally {
      setBusy(false)
      if (fileInput.current !== null) fileInput.current.value = ''
    }
  }

  return (
    <section>
      <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Machine settings</h3>
      <p style={{ ...hintStyle, marginTop: 0 }}>
        Credentials and definitions shared by every project on this machine.
      </p>

      {error === undefined ? null : <p style={errorStyle}>{error}</p>}
      {message === undefined ? null : <p style={hintStyle}>{message}</p>}

      <div style={cardStyle}>
        <strong style={{ fontSize: 13 }}>Cloudflare</strong>
        <div style={{ ...hintStyle, marginBottom: 8 }}>
          Used when this plugin creates DNS records. Scope the token to one zone.
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 2 }}>
            <label htmlFor="cf-account" style={labelStyle}>Account id</label>
            <input id="cf-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 2 }}>
            <label htmlFor="cf-zone" style={labelStyle}>Zone</label>
            <input id="cf-zone" value={zone} onChange={(e) => setZone(e.target.value)} placeholder="example.com" style={inputStyle} />
          </div>
        </div>
        <label htmlFor="cf-token" style={labelStyle}>API token</label>
        <input
          id="cf-token"
          type="password"
          value={cfToken}
          onChange={(e) => setCfToken(e.target.value)}
          placeholder={settings.cloudflare?.tokenSet === true ? `stored: ${settings.cloudflare.tokenHint}` : 'paste a token'}
          style={inputStyle}
        />
        <div style={hintStyle}>Leave blank to keep the stored token.</div>
      </div>

      <div style={cardStyle}>
        <strong style={{ fontSize: 13 }}>GitHub</strong>
        <div style={{ ...hintStyle, marginBottom: 8 }}>
          Used to create repositories. A fine-grained token scoped to one repository is enough.
        </div>
        <label htmlFor="gh-owner" style={labelStyle}>Owner</label>
        <input id="gh-owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="your-username" style={inputStyle} />
        <div style={{ height: 8 }} />
        <label htmlFor="gh-token" style={labelStyle}>Token</label>
        <input
          id="gh-token"
          type="password"
          value={ghToken}
          onChange={(e) => setGhToken(e.target.value)}
          placeholder={settings.github?.tokenSet === true ? `stored: ${settings.github.tokenHint}` : 'paste a token'}
          style={inputStyle}
        />
        <div style={hintStyle}>Leave blank to keep the stored token.</div>
      </div>

      <Button variant="primary" size="sm" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save settings'}
      </Button>

      <div style={{ ...cardStyle, marginTop: 16 }}>
        <strong style={{ fontSize: 13 }}>Import teams and agents</strong>
        <div style={{ ...hintStyle, marginBottom: 8 }}>
          A JSON file naming <code>teams</code> and/or <code>agents</code>. Imported teams appear in
          Manage Teams with their members and capabilities.
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file !== undefined) void importFile(file)
          }}
          style={{ fontSize: 12 }}
        />
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 12, cursor: 'pointer', opacity: 0.8 }}>Expected shape</summary>
          <pre
            style={{
              fontSize: 11,
              overflowX: 'auto',
              padding: 8,
              margin: '6px 0 0',
              borderRadius: 6,
              background: 'var(--dsw-alias-bg-layer-2, #f8fafc)',
            }}
          >
{`{
  "teams": [
    {
      "name": "Portal delivery",
      "purpose": "Ship the portal",
      "members": [
        { "name": "Dev", "role": "engineer",
          "capabilities": ["implement", "document"] }
      ]
    }
  ],
  "agents": [
    { "name": "Researcher", "role": "analyst", "kind": "agent" }
  ]
}`}
          </pre>
        </details>
      </div>
    </section>
  )
}