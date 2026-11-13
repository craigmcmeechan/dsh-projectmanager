/**
 * ProjectsPanel — component.
 * Split out of client/ProjectsPanel.tsx by the module-structure refactor.
 */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { ProjectDetail } from '../ProjectDetail/index.ts'
import { ManageTeams } from '../ManageTeams/index.ts'
import { SessionsPane } from '../SessionsPane/index.ts'
import { DevelopmentInfraTab } from '../DevelopmentInfraTab/index.ts'
import { SettingsTab } from '../SettingsTab/index.ts'
import { StoreManager } from '../StoreManager/index.ts'
import { NewButtonMenu } from '../NewButtonMenu/index.ts'
import { NewTemplateWizard } from '../NewTemplateWizard/index.ts'
import { createTemplateWorkspace } from '../store-api/index.ts'
import type { DirectoryPickerApi } from '../DirectoryPicker/index.ts'
import type { SessionsInjected } from '../ProjectsWorkspaceHost/index.ts'
import { getProject, listProjects, type Feature, type ProjectConfig, type ProjectEntry } from '../api/index.ts'
import { setOpen } from '../wizardStore/index.ts'
import { SECTIONS, lastAccessLabel } from './ProjectsPanel.module.ts'
import type { Section } from './ProjectsPanel.types.ts'
import { cell, headCell } from './ProjectsPanel.styles.ts'

/**
 * Render the Projects panel and its project workspace.
 * @returns the panel, or the selected project's screen.
 */
export function ProjectsPanel({
  sessions,
  picker,
  onProjectsChanged,
}: {
  sessions: SessionsInjected
  /** Directory picker, when the composition has one. */
  picker?: DirectoryPickerApi | undefined
  /** Called after a project or template is created, to refresh the sidebar. */
  onProjectsChanged?: () => void
}) {
  const [projects, setProjects] = useState<ProjectEntry[] | undefined>(undefined)
  const [openId, setOpenId] = useState<string | undefined>(undefined)
  const [managingTeams, setManagingTeams] = useState<string | undefined>(undefined)
  const [managingStores, setManagingStores] = useState(false)
  const [templateWizardOpen, setTemplateWizardOpen] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const refresh = async (): Promise<void> => {
    try {
      const payload = await listProjects()
      setProjects(payload.projects)
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not load projects.')
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  // The stores are plugin-wide, so they are reachable from the top-level list
  // rather than only from inside a project.
  if (managingStores) {
    return <StoreManager onBack={() => setManagingStores(false)} picker={picker} />
  }

  // Manage Teams is reachable from the list as well as from inside a project, so
  // it keeps its own breadcrumb rather than living in the rail only.
  if (managingTeams !== undefined) {
    return <ManageTeams projectId={managingTeams} onBack={() => setManagingTeams(undefined)} />
  }

  if (openId !== undefined) {
    return (
      <ProjectWorkspace
        projectId={openId}
        onBack={() => {
          setOpenId(undefined)
          void refresh()
        }}
        onManageTeams={(id) => setManagingTeams(id)}
        sessions={sessions}
      />
    )
  }

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Project Manager</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant="outline"
            size="sm"
            title="Open a web terminal on the machine running this plugin"
            onClick={() => {
              try {
                sessions.openTerminal?.()
              } catch (failure) {
                setError(failure instanceof Error ? failure.message : 'could not open a web terminal')
              }
            }}
          >
            Web terminal
          </Button>
          <Button variant="outline" size="sm" onClick={() => setManagingStores(true)}>
            Stores
          </Button>
          {projects !== undefined && projects.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setManagingTeams(projects[0]?.id)}>
              Manage teams
            </Button>
          ) : null}
          <NewButtonMenu
            actions={[
              {
                id: 'project',
                label: 'New project',
                hint: 'From a directory, or a remote host',
                run: () => setOpen(true),
              },
              {
                id: 'template',
                label: 'New project template',
                hint: 'Create a template locally and start a session',
                run: () => setTemplateWizardOpen(true),
              },
            ]}
          />
        </div>
      </header>

      <NewTemplateWizard
        open={templateWizardOpen}
        onClose={() => setTemplateWizardOpen(false)}
        onCreate={async (input) => {
          // 1. Create the workspace on disk and register it as a template.
          //    The host writes project-details, AGENTS.md, README, and runs
          //    `git init` with an initial commit.
          const created = await createTemplateWorkspace(input)
          // A git failure is reported but does not discard the files: the
          // operator can commit by hand, and losing their work over a missing
          // identity would be worse than a warning.
          if (created.warning !== undefined) {
            setError(`Template created at ${created.path}, but ${created.warning}`)
          }
          // 2. Register the directory as a Workspace and start a Session in it,
          //    so the operator lands straight in the template.
          if (sessions.openWorkspace === undefined) {
            throw new Error('workspace creation is not available in this composition')
          }
          await sessions.openWorkspace(created.path)
          // A new template needs its own sidebar row.
          onProjectsChanged?.()
          return created.path
        }}
      />

      {error === undefined ? null : (
        <p role="alert" style={{ color: '#b42318', fontSize: 13 }}>
          {error}
        </p>
      )}

      {projects === undefined ? (
        <p style={{ fontSize: 13, opacity: 0.7 }}>Loading…</p>
      ) : projects.length === 0 ? (
        <p style={{ fontSize: 13, opacity: 0.7 }}>
          No projects yet. Create one to get started — it sets up a directory, a specification, and a
          board.
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={headCell}>Project</th>
              <th style={headCell}>Type</th>
              <th style={headCell}>Last access</th>
              <th style={headCell}>State</th>
              <th style={headCell} />
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id} style={{ borderBottom: '1px solid var(--dsw-alias-border-l4, #f1f5f9)' }}>
                <td style={cell}>
                  <div style={{ fontWeight: 500 }}>{project.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.6 }} title={project.root}>
                    {project.root}
                  </div>
                </td>
                <td style={cell}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: 12,
                      background: project.config?.mode === 'remote' ? '#eff6ff' : '#f0fdf4',
                      color: project.config?.mode === 'remote' ? '#1d4ed8' : '#15803d',
                    }}
                  >
                    {project.config?.mode ?? 'local'}
                  </span>
                </td>
                <td style={cell}>{lastAccessLabel(project)}</td>
                <td style={cell}>
                  <span style={{ opacity: 0.6 }}>idle</span>
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <Button variant="ghost" size="sm" onClick={() => setManagingTeams(project.id)}>
                      Teams
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setOpenId(project.id)}>
                      Open
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
/** One project's workspace: a left menu and the selected section. */
function ProjectWorkspace({
  projectId,
  onBack,
  onManageTeams,
  sessions,
}: {
  projectId: string
  onBack: () => void
  onManageTeams: (projectId: string) => void
  sessions: SessionsInjected
}) {
  const [section, setSection] = useState<Section>('overview')
  const [config, setConfig] = useState<ProjectConfig | undefined>(undefined)
  const [features, setFeatures] = useState<Feature[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    void (async () => {
      try {
        const snapshot = await getProject(projectId)
        setConfig(snapshot.config)
        setFeatures(snapshot.features)
      } catch {
        // The section components surface their own errors.
      }
    })()
  }, [projectId, refreshKey])

  const refresh = async (): Promise<void> => {
    setRefreshKey((value) => value + 1)
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <nav
        aria-label="Project sections"
        style={{
          width: 168,
          flexShrink: 0,
          borderRight: '1px solid var(--dsw-alias-border-l4, #e5e7eb)',
          padding: '12px 8px',
          overflowY: 'auto',
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            border: 'none',
            background: 'none',
            color: 'inherit',
            cursor: 'pointer',
            padding: '4px 6px',
            fontSize: 12,
            opacity: 0.7,
            marginBottom: 8,
            textAlign: 'left',
            width: '100%',
          }}
        >
          ← Project Manager
        </button>
        <div style={{ fontSize: 13, fontWeight: 600, padding: '0 6px 10px', lineHeight: 1.3 }}>
          {config?.name ?? '…'}
        </div>
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setSection(entry.id)}
            title={entry.hint}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '7px 8px',
              marginBottom: 2,
              borderRadius: 6,
              border: 'none',
              background: section === entry.id ? 'var(--dsw-alias-interactive-bg-active, #eff6ff)' : 'none',
              color: section === entry.id ? 'var(--dsw-alias-label-primary, #1d4ed8)' : 'inherit',
              fontSize: 13,
              fontWeight: section === entry.id ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        {section === 'overview' || section === 'features' ? (
          <ProjectDetail
            projectId={projectId}
            initialTab={section === 'features' ? 'Features' : 'Overview'}
            onBack={onBack}
            onChanged={() => void refresh()}
          />
        ) : null}
        {section === 'teams' ? (
          <div style={{ padding: 16 }}>
            <Button variant="outline" size="sm" onClick={() => onManageTeams(projectId)}>
              Open Manage Teams
            </Button>
            <p style={{ fontSize: 13, opacity: 0.7, marginTop: 10 }}>
              Team members, workflows, stage prompts, and per-stage models live in Manage Teams.
            </p>
          </div>
        ) : null}
        {section === 'sessions' ? (
          <SessionsPane projectId={projectId} features={features} startSession={sessions.startSession} {...(sessions.listSessions === undefined ? {} : { listSessions: sessions.listSessions })} />
        ) : null}
        {section === 'infrastructure' ? (
          <div style={{ padding: 16 }}>
            <DevelopmentInfraTab projectId={projectId} />
          </div>
        ) : null}
        {section === 'settings' ? (
          <div style={{ padding: 16 }}>
            <SettingsTab projectId={projectId} />
          </div>
        ) : null}
      </div>
    </div>
  )
}