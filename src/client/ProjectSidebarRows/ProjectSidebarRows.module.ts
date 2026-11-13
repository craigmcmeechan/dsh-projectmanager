/**
 * Keep one sidebar row per project and per project template.
 *
 * `sidebar.panellist` is a `list` slot, so rows can be added and removed at
 * runtime — but registration is imperative and a stale registration leaves a
 * row pointing at a panel that no longer renders. This module owns that
 * bookkeeping: a diff between the desired rows and the registered ones, applied
 * on every refresh.
 *
 * The "Project Manager" row itself is registered separately and never touched
 * here: it is the overview, not a project.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ProjectRow, ProjectsSectionHeader } from './ProjectSidebarRows.tsx'
import { ProjectWorkspacePage, ProjectsOverviewPage, workspacePageInject } from '../ProjectWorkspacePage/index.ts'
import type { SidebarRow } from './ProjectSidebarRows.interface.ts'

/** A registered row, with the disposers that remove it and its panel. */
interface Registration {
  row: SidebarRow
  dispose: () => void
}

/** The header row's id, so it is never confused with a project. */
const HEADER_ID = 'projects-section-header'

/** Order of the header: after Project Manager (50), before the rows (100+). */
const HEADER_ORDER = 90

/** Order base for project rows: below the header. */
const BASE_ORDER = 100

/**
 * Manage the per-project sidebar rows.
 *
 * @param ctx - client context, used for `slots`.
 * @returns a function that reconciles the rows to a desired set.
 */
export function createSidebarRows(ctx: Context): {
  sync: (rows: SidebarRow[]) => void
  dispose: () => void
} {
  const live = new Map<string, Registration>()

  // NOTE: a `sidebar.panel.icon` factory was tried here to put each row's menu in
  // the icon seat. It cannot work: the factory definition requires declaring the
  // `sidebar.panellist` child, and core's `sidebar` entry already declared that
  // slot — a second declarer throws at load time and takes the entire sidebar
  // down. The row menu lives in the More menu (`sidebar.panellist.actions`)
  // instead, which needs no declarations.

  const disposeOne = (id: string): void => {
    const entry = live.get(id)
    if (entry === undefined) return
    entry.dispose()
    live.delete(id)
  }

  const register = (row: SidebarRow, order: number): void => {
    // The row selects its panel by id, so the panel must exist under the same
    // key: a row whose `main` key renders nothing would select a blank screen.
    const panelDispose = ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: row.id, inject: () => workspacePageInject(ctx, row) },
        ProjectWorkspacePage,
      ),
    ) as unknown as () => void

    // `slots.inject` is asynchronous; awaiting it here would let two syncs race
    // and double-register. The list slot resolves on its own schedule, so the
    // registration closure runs exactly once per row.
    //
    // The row itself draws no glyph: `sidebar.panel.icon` supplies it, and that
    // is where the per-row menu lives.
    const rowDispose = ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        {
          name: 'sidebar.panellist',
          id: row.id,
          order,
          // Labels are resolved reactively by the sidebar, so a rename is picked
          // up without re-registering.
          label: () => row.label,
        },
        ProjectRow,
      ),
    ) as unknown as () => void

    live.set(row.id, {
      row,
      dispose: () => {
        // Panel first: removing the row while its panel still renders would
        // leave a selected key with no sidebar entry.
        if (typeof panelDispose === 'function') panelDispose()
        if (typeof rowDispose === 'function') rowDispose()
      },
    })
  }

  // The header lives for as long as there is at least one project or template:
  // a "Projects" caption above an empty list would be noise.
  let headerLive = false
  const ensureHeader = (present: boolean): void => {
    if (present === headerLive) return
    headerLive = present
    if (present) {
      // Every sidebar row is a button that calls selectPanel(id), so the header
      // must own a panel too: without one, clicking it selects a key nothing
      // renders and the main area goes blank.
      void ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: HEADER_ID }, ProjectsOverviewPage),
      )
      void ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: HEADER_ID,
            order: HEADER_ORDER,
            label: () => 'Projects',
          },
          ProjectsSectionHeader,
        ),
      )
      return
    }
  }

  const sync = (rows: SidebarRow[]): void => {
    ensureHeader(rows.length > 0)
    const wanted = new Set(rows.map((row) => row.id))

    // Remove rows that no longer exist (a deleted project or template).
    for (const id of [...live.keys()]) {
      if (!wanted.has(id)) disposeOne(id)
    }

    // Add new ones, and keep the order stable by sorted index.
    const sorted = [...rows].sort((a, b) => a.label.localeCompare(b.label))
    sorted.forEach((row, index) => {
      if (live.has(row.id)) return
      register(row, BASE_ORDER + index)
    })
  }

  const dispose = (): void => {
    for (const id of [...live.keys()]) disposeOne(id)
  }

  return { sync, dispose }
}
