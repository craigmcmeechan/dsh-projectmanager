/**
 * DirectoryPicker — component.
 * Split out of client/DirectoryPicker.tsx by the module-structure refactor.
 */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { errorStyle, hintStyle, inputStyle } from '../styles/index.ts'
import type { DirectoryListing, DirectoryPickerFieldProps } from './DirectoryPicker.interface.ts'

/**
 * Render a path input with a Browse button.
 * @param props - current value, change handler, and the picker surface.
 */
export function DirectoryPickerField({
  value,
  onChange,
  picker,
  label,
  placeholder,
}: DirectoryPickerFieldProps) {
  const [browseOpen, setBrowseOpen] = useState(false)
  const [listing, setListing] = useState<DirectoryListing | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [newFolder, setNewFolder] = useState('')
  const [creating, setCreating] = useState(false)

  const browse = async (path?: string): Promise<void> => {
    if (picker?.list === undefined) {
      setError('This deployment has no directory browser; type the path instead.')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      setListing(await picker.list(path))
      setBrowseOpen(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not list that directory.')
    } finally {
      setBusy(false)
    }
  }

  /** Create a child folder in the listing being shown, then enter it. */
  const createFolder = async (): Promise<void> => {
    const name = newFolder.trim()
    if (name.length === 0 || listing === undefined) return
    if (picker?.createDirectory === undefined) {
      setError('This deployment cannot create folders; make one and browse to it.')
      return
    }
    setCreating(true)
    setError(undefined)
    try {
      const created = await picker.createDirectory(listing.path, name)
      setNewFolder('')
      // Show the new folder rather than assuming: the host owns the final path.
      await browse(created)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not create that folder.')
    } finally {
      setCreating(false)
    }
  }

  const openPicker = async (): Promise<void> => {
    // Browse FIRST, not the OS dialog.
    //
    // `pick()` only exists when the composition mounted the *native* backend.
    // This deployment mounts the *browse* backend, which registers a slot-based
    // browser and never implements `pick`, so calling it produced an empty
    // result and the dialog appeared to do nothing. The browse list also works
    // on a remote host, where no OS chooser can reach the operator's screen.
    setBusy(true)
    setError(undefined)
    try {
      const initial = value.trim().length > 0 ? value.trim() : undefined
      const listing = await picker?.list?.(initial)
      if (listing === undefined) {
        // No backend at all: say so instead of doing nothing.
        setError('This deployment has no directory browser; type the path instead.')
        return
      }
      setListing(listing)
      setBrowseOpen(true)
    } catch (failure) {
      // A saved value can point at a folder that no longer exists (it was
      // created on another machine, or deleted). Fall back to the picker's
      // default root rather than leaving the field permanently unusable — the
      // operator cannot recover from a dialog that refuses to open.
      if (value.trim().length > 0) {
        try {
          const fallback = await picker?.list?.(undefined)
          if (fallback !== undefined) {
            setListing(fallback)
            setBrowseOpen(true)
            setError(`"${value.trim()}" could not be opened; starting from ${fallback.path}.`)
            return
          }
        } catch {
          // Fall through to the OS dialog and the error below.
        }
      }
      // Only now try the OS dialog, as a last resort.
      if (picker?.pick !== undefined) {
        try {
          const chosen = await picker.pick()
          if (chosen !== null) {
            onChange(chosen)
            return
          }
        } catch {
          // Fall through to the error below.
        }
      }
      setError(failure instanceof Error ? failure.message : 'Could not list that directory.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!browseOpen) return
    // Refresh when the field's value changes while the browser is open.
    void browse(value.length > 0 ? value : undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseOpen])

  return (
    <div>
      <label htmlFor="wizard-directory" style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
        {label}
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id="wizard-directory"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder ?? '/home/you/projects'}
          style={{ ...inputStyle, flex: 1 }}
          data-modal-autofocus
        />
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void openPicker()}>
          {busy ? '…' : 'Browse…'}
        </Button>
      </div>

      {error === undefined ? null : <p style={{ ...errorStyle, marginTop: 6 }}>{error}</p>}

      {browseOpen && listing !== undefined ? (
        <div
          style={{
            marginTop: 8,
            border: '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)',
            borderRadius: 'var(--dsw-radius-md, 6px)',
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 8px',
              borderBottom: '0.5px solid var(--dsw-alias-border-l4, #d0d5dd)',
              fontSize: 12,
            }}
          >
            <span style={{ fontFamily: 'ui-monospace, monospace', opacity: 0.8 }}>{listing.path}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {listing.parent === undefined ? null : (
                <Button variant="ghost" size="sm" onClick={() => void browse(listing.parent)}>
                  Up
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void browse()}
                title="Go to the starting folder"
              >
                Home
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onChange(listing.path)
                  setBrowseOpen(false)
                }}
              >
                Select this folder
              </Button>
            </div>
          </div>
          {/* Create a folder here, so choosing a new location does not mean
              leaving the dialog. */}
          <div
            style={{
              display: 'flex',
              gap: 6,
              padding: '6px 8px',
              borderBottom: '0.5px solid var(--dsw-alias-border-l4, #e2e8f0)',
            }}
          >
            <input
              value={newFolder}
              onChange={(event) => setNewFolder(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void createFolder()
                }
              }}
              placeholder="New folder name"
              aria-label="New folder name"
              style={{ ...inputStyle, flex: 1, fontSize: 12 }}
              disabled={creating}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={creating || newFolder.trim().length === 0}
              onClick={() => void createFolder()}
            >
              {creating ? '…' : 'New folder'}
            </Button>
          </div>

          {listing.entries.length === 0 ? (
            <p style={{ ...hintStyle, padding: '8px' }}>No subdirectories.</p>
          ) : (
            listing.entries
              .filter((entry) => entry.directory)
              .map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => void browse(entry.path)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '5px 10px',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--dsw-alias-label-primary, inherit)',
                    fontSize: 12,
                    cursor: 'pointer',
                    font: 'inherit',
                  }}
                >
                  {entry.name}
                </button>
              ))
          )}
        </div>
      ) : null}

      <p style={{ ...hintStyle, marginTop: 6 }}>
        The project is created in a subdirectory named after the project.
      </p>
    </div>
  )
}