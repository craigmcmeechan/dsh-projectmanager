/**
 * index — module.
 * Split out of client/index.ts by the module-structure refactor.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ProjectsEntry } from '../ProjectsEntry/index.ts'
import { ProjectsIcon } from '../ProjectsIcon/index.ts'
import { ProjectsWorkspaceHost, sessionsFrom } from '../ProjectsWorkspaceHost/index.ts'
import type { DirectoryPickerApi } from '../DirectoryPicker/index.ts'
import { ProjectsRightPanel } from '../ProjectsRightPanel/index.ts'
import { ProjectsSettingsTab } from '../ProjectsSettingsTab/index.ts'
import { ProjectsWizardHost } from '../ProjectsWizardHost/index.ts'
import { DeleteProjectEntry } from '../DeleteProjectEntry/index.ts'
import { DeleteProjectHost } from '../DeleteProjectEntry/index.ts'
import { requestDelete } from '../DeleteProjectEntry/index.ts'
import { createSidebarRows } from '../ProjectSidebarRows/index.ts'
import type { SidebarRow } from '../ProjectSidebarRows/index.ts'
import { current, load } from '../settings/index.ts'

export const name = 'ui-projects-client'
/**
 * `slots` is the registry, `sidebarRightTabs` the right-window tab registry.
 * Both must exist before this plugin registers.
 */
/**
 * Cordis requires every service property to be declared here; reading an
 * undeclared one throws "cannot get property ... without inject". That is
 * exactly what Browse did before `remote.directoryPicker` was added.
 *
 * The picker is a hard dependency of the directory field, so declaring it
 * required is correct: a profile that composes no picker should not load a
 * plugin whose wizard cannot browse. The field still degrades to a typed path
 * when the *backend* is unavailable, which is a different case.
 */
export const inject = [
  'slots',
  'sidebarRightTabs',
  // Opening a terminal tab goes through the sidebar-right service, so it must
  // be declared: reading an undeclared service throws.
  'sidebarRight',
  'remote',
  'remote.directoryPicker',
  // Creating a Workspace goes through this generated namespace. Cordis throws
  // on reading an undeclared service, so a namespace used anywhere in the
  // plugin must be listed here — the same trap as directoryPicker.
  'remote.workspace',
  // The generated session namespace, for listing sessions. Declared for the
  // same reason as the others: reading it undeclared throws.
  'remote.session',
  'uiWorkspace',
]
/** Stable id shared by the sidebar row and the `main` page it opens. */
const PANEL_ID = 'projects'
/** Tab kind for the right-window presentation. */
const TAB_KIND = 'dsh-projects'
/**
 * Register the entry, panel, settings tab, and dialog.
 * @param ctx - the client context.
 */
export function apply(ctx: Context): void {
  // The panel body: one registration, addressed by PANEL_ID from the sidebar row.
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        // Services are injected here rather than read from globals: slot
        // components receive props, and the panel must not reach for a context.
        // The picker rides alongside the session face: the template wizard
        // needs to choose a parent folder, and it lives in this panel.
        inject: () => ({
          inject: sessionsFrom(ctx),
          picker: lazyPicker(ctx),
          onProjectsChanged: () => void refreshSidebarRows(),
        }),
      },
      ProjectsWorkspaceHost,
    ),
  )

  // One sidebar row per project and per template.
  //
  // `sidebar.workspaces` is a single slot owned by DSH's own browser, so nested
  // sections there are not available to a plugin. These rows are the supported
  // equivalent: each project gets its own entry beside Project Manager, and its
  // panel lists that project's workspaces and sessions.
  const sidebarRows = createSidebarRows(ctx)
  const refreshSidebarRows = async (): Promise<void> => {
    try {
      const [projects, templates] = await Promise.all([
        fetch('/api/projects', { credentials: 'same-origin' }).then((response) =>
          response.ok ? (response.json() as Promise<{ projects?: Array<{ id: string; name: string; root: string }> }>) : { projects: [] },
        ),
        fetch('/api/projects/store/templates', { credentials: 'same-origin' }).then((response) =>
          response.ok ? (response.json() as Promise<{ templates?: Array<{ id: string; name: string; repo: string }> }>) : { templates: [] },
        ),
      ])
      const rows: SidebarRow[] = [
        ...(projects.projects ?? []).map((project) => ({
          // The panel id must not collide with the Project Manager row.
          id: `project-${project.id}`,
          label: project.name,
          kind: 'project' as const,
          root: project.root,
        })),
        ...(templates.templates ?? []).map((template) => ({
          id: `template-${template.id}`,
          label: template.name,
          kind: 'template' as const,
          root: template.repo,
        })),
      ]
      sidebarRows.sync(rows)
    } catch {
      // A failed fetch leaves the existing rows: losing the sidebar over a
      // transient error would be worse than a stale list.
    }
  }

  // Live updates: the host publishes on every project or template change, and
  // this stream applies it. A timer is deliberately avoided — polling would show
  // changes late and keep the connection busy while nothing happens.
  void refreshSidebarRows()
  const subscribeToChanges = (): (() => void) => {
    if (typeof EventSource === 'undefined') {
      // No SSE (an old browser): fall back to a refresh after a mutation, which
      // the panel already triggers.
      return () => {}
    }
    const source = new EventSource('/api/projects/events', { withCredentials: true })
    // Both event kinds re-read the list: the host is the source of truth, and a
    // diff of two lists it computed is cheaper than trusting an incremental
    // patch to stay in step.
    source.addEventListener('projects', () => void refreshSidebarRows())
    source.addEventListener('templates', () => void refreshSidebarRows())
    // A dropped stream reconnects on its own; nothing to do but let it.
    source.addEventListener('error', () => {})
    return () => source.close()
  }
  ctx.effect(() => subscribeToChanges(), 'projects: change stream')
  ctx.effect(() => () => sidebarRows.dispose(), 'projects: sidebar rows')

  // The right-window tab type, so the list can sit beside the conversation.
  ctx.effect(() =>
    ctx.sidebarRightTabs.register({
      id: 'dsh-projects/panel',
      kind: TAB_KIND,
      title: () => 'Project Manager',
    }),
  )
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'dsh-projects/panel' }, ProjectsRightPanel),
  )

  // The settings tab.
  ctx.slots.inject('settings.plugins.tab', () =>
    ctx.slots.register(
      {
        name: 'settings.plugins.tab',
        id: 'projects',
        order: 50,
        // The tab label is registrant-localized; this plugin ships one English
        // string rather than a dictionary, which the slot accepts.
        label: () => 'Project Manager',
      },
      ProjectsSettingsTab,
    ),
  )

  // Deleting a project is confirmed in the overlay, not in the menu: dismissing
  // the menu would otherwise unmount the dialog mid-question.
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'projects-delete-dialog',
        order: 901,
        inject: () => ({
          onConfirm: async (projectId: string) => {
            const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
              method: 'DELETE',
              credentials: 'same-origin',
            })
            if (!response.ok) throw new Error(`delete failed (${response.status})`)
            // The sidebar row must go with the registry entry.
            void refreshSidebarRows()
          },
        }),
      },
      DeleteProjectHost,
    ),
  )

  // The dialog lives outside the menu that launches it.
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'projects-wizard',
        order: 900,
        // The directory picker is a generated Remote namespace; resolve it here
        // so the wizard stays a plain component with no context dependency.
        // Lazy: the remote namespace may not exist yet, and a throwing inject
        // would take the whole dialog down with it.
        inject: () => ({ picker: lazyPicker(ctx) }),
      },
      ProjectsWizardHost,
    ),
  )

  // ---------------------------------------------------------------- the entry
  // Registered as a plain `inject` + `register`, the same shape the shipped
  // plugins use. An earlier version swapped registrations inside an effect to
  // honour a display preference; that raced `slots.inject`, which is
  // asynchronous, and could leave the entry disposed with nothing registered —
  // the sidebar row simply never appeared.
  //
  // The preference is therefore read once at apply time. Changing it takes
  // effect on the next plugin load, which is honest: a sidebar row that appears
  // after a reload is better than one that disappears unpredictably.
  void load()
  if (current().displayMode === 'menu') {
    ctx.slots.inject('sidebar.panellist.actions', () =>
      ctx.slots.register(
        { name: 'sidebar.panellist.actions', id: 'projects-entry', order: 900 },
        ProjectsEntry,
      ),
    )
    // The delete row is registered regardless of display mode: the More menu is
    // where a panel's own actions live, and a project open in the main area
    // still needs a way to remove itself.
    ctx.slots.inject('sidebar.panellist.actions', () =>
      ctx.slots.register(
        {
          name: 'sidebar.panellist.actions',
          id: 'projects-delete',
          order: 901,
          inject: () => ({
          onDelete: (panelId: string, label: string) => {
            // The sidebar prefixes project panels so they cannot collide with
            // the overview row; strip it to get the registry id.
            requestDelete({ projectId: panelId.replace(/^project-/, ''), label })
          },
        }),
        },
        DeleteProjectEntry,
      ),
    )
  } else {
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        { name: 'sidebar.panellist', id: PANEL_ID, order: 50, label: () => 'Project Manager' },
        ProjectsIcon,
      ),
    )
  }
}
/**
 * A picker whose lookups happen at call time rather than at registration time.
 *
 * `ctx.get` during registration captures whatever exists *then*; a service that
 * mounts later would be invisible forever. These functions resolve per call, so
 * a late-mounted remote still works.
 * @param ctx - the client context.
 */
function lazyPicker(ctx: Context): DirectoryPickerApi {
  return {
    pick: () => resolvePicker(ctx)?.pick?.() ?? Promise.resolve(null),
    list: async (path?: string) => {
      const api = resolvePicker(ctx)
      if (api?.list === undefined) throw new Error('no directory browser in this composition')
      return api.list(path)
    },
    // Forwarded here too: this wrapper is the only face the field sees, so a
    // verb missing here is invisible no matter what `resolvePicker` returns.
    // That is what made "New folder" silently unable to create anything.
    createDirectory: async (path: string, name: string) => {
      const api = resolvePicker(ctx)
      if (api?.createDirectory === undefined) {
        throw new Error('this deployment cannot create folders')
      }
      return api.createDirectory(path, name)
    },
  }
}
/**
 * Resolve the directory-picking surface from the client context.
 * @param ctx - the client context.
 * @returns the picker API, or undefined when this composition has no backend.
 */
function resolvePicker(ctx: Context): DirectoryPickerApi | undefined {
  const remote = ctx.get('remote') as
    | {
        directoryPicker?: {
          pick?: (signal?: AbortSignal) => Promise<unknown>
          list?: (path?: string, signal?: AbortSignal) => Promise<unknown>
          createDirectory?: (path: string, name: string) => Promise<unknown>
        }
      }
    | undefined
  const namespace = remote?.directoryPicker
  if (namespace === undefined) return undefined

  const api: DirectoryPickerApi = {}
  if (typeof namespace.pick === 'function') {
    api.pick = async () => {
      const envelope = (await namespace.pick!(undefined)) as unknown as
        | { ok: true; value: string | null }
        | { ok: false; error?: { message?: string } }
      if (envelope !== null && typeof envelope === 'object' && 'ok' in envelope) {
        if (envelope.ok === false) throw new Error(envelope.error?.message ?? 'the system dialog is unavailable')
        return envelope.value
      }
      // An older shape returned the value directly; accept it rather than throw.
      return envelope as unknown as string | null
    }
  }
  if (typeof namespace.list === 'function') {
    api.list = async (path?: string) => {
      // `Remote` methods answer with a result envelope, not the value: reading
      // `.path` off the envelope yielded undefined and the field rendered
      // "[object Object]". Unwrap it, and surface a failure as a rejection so
      // the field can show the reason.
      const envelope = (await namespace.list!(path, undefined)) as unknown as
        | { ok: true; value: { path?: string; parent?: string; entries?: Array<{ name: string; path: string; directory?: boolean }> } }
        | { ok: false; error?: { message?: string } }
      if (envelope !== null && typeof envelope === 'object' && 'ok' in envelope && envelope.ok === false) {
        throw new Error(envelope.error?.message ?? 'directory listing failed')
      }
      const listing =
        envelope !== null && typeof envelope === 'object' && 'ok' in envelope && envelope.ok === true
          ? envelope.value
          : (envelope as unknown as { path?: string; parent?: string; entries?: Array<{ name: string; path: string; directory?: boolean }> })
      return {
        // `path` is what the field writes back, so it must be a real string.
        path: typeof listing.path === 'string' ? listing.path : '',
        ...(listing.parent === undefined ? {} : { parent: listing.parent }),
        entries: (Array.isArray(listing.entries) ? listing.entries : []).map((entry) => ({
          name: entry.name,
          path: entry.path,
          directory: entry.directory !== false,
        })),
      }
    }
  }
  if (typeof namespace.createDirectory === 'function') {
    api.createDirectory = async (path: string, name: string) => {
      // Same envelope rule as `list`: unwrap `{ ok, value }`, and surface a
      // failure as a rejection so the field can show why.
      const envelope = (await namespace.createDirectory!(path, name)) as unknown as
        | { ok: true; value: string }
        | { ok: false; error?: { message?: string } }
      if (envelope !== null && typeof envelope === 'object' && 'ok' in envelope) {
        if (envelope.ok === false) throw new Error(envelope.error?.message ?? 'could not create the folder')
        if (typeof envelope.value !== 'string') throw new Error('the host did not return a folder path')
        return envelope.value
      }
      return String(envelope)
    }
  }

  // A namespace with neither verb is no picker at all.
  return Object.keys(api).length === 0 ? undefined : api
}