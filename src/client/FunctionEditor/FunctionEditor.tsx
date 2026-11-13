/**
 * Editor for an image function.
 *
 * A function groups images by the job they do ("Keycloak", "Postgres") and
 * carries the DNS template that describes how a *deployment* of that job is
 * addressed. The template is the reason this editor exists: without it a
 * function is only a label.
 */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { inputStyle, labelStyle } from '../styles/index.ts'
import { editorStyle, previewStyle } from './FunctionEditor.styles.ts'
import type { FunctionEditorProps } from './FunctionEditor.interface.ts'

/**
 * Render the function editor.
 * @param props - the function to edit and the save handler.
 */
export function FunctionEditor({ existing, onSave, onCancel, busy, error }: FunctionEditorProps) {
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [dnsTemplate, setDnsTemplate] = useState(existing?.dnsTemplate ?? '')
  const [port, setPort] = useState(existing?.port === undefined ? '' : String(existing.port))

  // Show what the template renders to, so a typo is visible before saving.
  const preview = dnsTemplate
    .replaceAll('{name}', name.length > 0 ? name.toLowerCase().replace(/[^a-z0-9-]/g, '-') : 'my-app')
    .replaceAll('{zone}', 'example.com')

  return (
    <div style={editorStyle}>
      <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>
        {existing === undefined ? 'New function' : `Edit function — ${existing.name}`}
      </h4>

      {error === undefined ? null : (
        <p role="alert" style={{ color: 'var(--dsw-alias-state-error-primary, #b42318)', fontSize: 12 }}>
          {error}
        </p>
      )}

      <label style={labelStyle} htmlFor="fn-name">
        Function name
      </label>
      <input
        id="fn-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Keycloak"
        style={inputStyle}
      />

      <label style={{ ...labelStyle, marginTop: 8 }} htmlFor="fn-desc">
        Description
      </label>
      <input
        id="fn-desc"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Identity provider: realms, users, OIDC clients"
        style={inputStyle}
      />

      <label style={{ ...labelStyle, marginTop: 8 }} htmlFor="fn-dns">
        DNS template
      </label>
      <input
        id="fn-dns"
        value={dnsTemplate}
        onChange={(event) => setDnsTemplate(event.target.value)}
        placeholder="{name}.{zone}"
        style={inputStyle}
      />
      <p style={{ fontSize: 11, opacity: 0.7, margin: '4px 0 0' }}>
        <code>{'{name}'}</code> is the deployment name, <code>{'{zone}'}</code> the zone. Leave
        empty for no automatic addressing.
      </p>
      {dnsTemplate.trim().length === 0 ? null : (
        <p style={{ marginTop: 6 }}>
          <span style={previewStyle}>{preview}</span>
        </p>
      )}

      <label style={{ ...labelStyle, marginTop: 8 }} htmlFor="fn-port">
        Default port
      </label>
      <input
        id="fn-port"
        value={port}
        onChange={(event) => setPort(event.target.value)}
        placeholder="8080"
        style={inputStyle}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || name.trim().length === 0}
          onClick={() => void onSave({ name: name.trim(), description, dnsTemplate, port })}
        >
          {busy ? '…' : 'Save function'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
