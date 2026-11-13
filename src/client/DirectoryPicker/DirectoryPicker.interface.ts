/**
 * DirectoryPicker — interface.
 * Split out of client/DirectoryPicker.tsx by the module-structure refactor.
 */
/** One directory entry from the browse backend. */
export interface DirectoryEntry {
  name: string
  path: string
  /** Whether this entry is a directory; files are shown but not selectable. */
  directory: boolean
}
/** The listing the browse backend returns. */
export interface DirectoryListing {
  path: string
  parent?: string
  entries: DirectoryEntry[]
}
/** The picker surface this component needs, injected by the host. */
export interface DirectoryPickerApi {
  /** Open the OS chooser; resolves null when cancelled. */
  pick?: () => Promise<string | null>
  /** List one directory; `undefined` starts at the default root. */
  list?: (path?: string) => Promise<DirectoryListing>
  /** Create a child directory; resolves to its absolute path. */
  createDirectory?: (path: string, name: string) => Promise<string>
}
/** Props for {@link DirectoryPickerField}. */
export interface DirectoryPickerFieldProps {
  /** The chosen absolute path. */
  value: string
  /** Called with a new absolute path. */
  onChange: (path: string) => void
  /** The picker surface, or undefined when the composition has none. */
  picker: DirectoryPickerApi | undefined
  /** Field label. */
  label: string
  /** Placeholder shown when empty. */
  placeholder?: string
}