/**
 * ProjectDetail — component.
 * Split out of client/ProjectDetail.tsx by the module-structure refactor.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { InfrastructureTab } from '../InfrastructureTab/index.ts'
import { createFeature, createItem, getProject, type Feature, type ProjectConfig, type WorkItem } from '../api/index.ts'
import { assignTeam, createTeam, getFeatureSpec, getProfile, listTeams, saveFeatureSpec, saveProfile, type ProjectProfile, type Team } from '../profile-api/index.ts'
import { TABS, DEFAULT_FIELDS, ROLES } from './ProjectDetail.module.ts'
import type { ProjectDetailProps } from './ProjectDetail.interface.ts'
import type { Tab } from './ProjectDetail.types.ts'
import { input, label, card } from './ProjectDetail.styles.ts'

/**
 * Render the project specification workspace.
 * @param props - which project, and how to go back.
 */
export function ProjectDetail({ projectId, onBack, initialTab, onChanged }: ProjectDetailProps) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'Overview')
  const [config, setConfig] = useState<ProjectConfig | undefined>(undefined)
  const [profile, setProfile] = useState<ProjectProfile | undefined>(undefined)
  const [features, setFeatures] = useState<Feature[]>([])
  const [items, setItems] = useState<WorkItem[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const refresh = async (): Promise<void> => {
    try {
      const [snapshot, prof] = await Promise.all([getProject(projectId), getProfile(projectId)])
      setConfig(snapshot.config)
      setProfile(prof)
      setFeatures(snapshot.features)
      setItems(snapshot.items)
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not load the project.')
    }
  }

  useEffect(() => {
    void refresh()
    // Reload when the project changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const setDefault = async (key: string, value: string): Promise<void> => {
    if (profile === undefined) return
    const defaults = { ...profile.defaults, [key]: value }
    setProfile({ ...profile, defaults })
  }

  const persistDefaults = async (): Promise<void> => {
    if (profile === undefined) return
    setBusy(true)
    try {
      await saveProfile(projectId, { defaults: profile.defaults })
      await refresh()
      onChanged?.()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  if (error !== undefined) {
    return (
      <div style={{ padding: 16 }}>
        <p role="alert" style={{ color: '#b42318' }}>{error}</p>
        <Button variant="outline" onClick={onBack}>Back to projects</Button>
      </div>
    )
  }

  if (profile === undefined || config === undefined) {
    return <div style={{ padding: 16, fontSize: 13, opacity: 0.7 }}>Loading…</div>
  }

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <header style={{ marginBottom: 12 }}>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Projects
        </Button>
        <h2 style={{ margin: '6px 0 2px', fontSize: 18 }}>{config.name}</h2>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>{config.description || 'No description.'}</p>
      </header>

      <nav style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--dsw-alias-border-l4, #e5e7eb)', marginBottom: 14 }}>
        {TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setTab(entry)}
            style={{
              padding: '8px 12px',
              border: 'none',
              borderBottom: `2px solid ${tab === entry ? 'var(--dsw-alias-interactive-bg-active, #2563eb)' : 'transparent'}`,
              background: 'none',
              color: 'inherit',
              fontSize: 13,
              fontWeight: tab === entry ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {entry}
          </button>
        ))}
      </nav>

      {tab === 'Overview' ? (
        <section>
          <p style={{ fontSize: 13, opacity: 0.75, marginTop: 0 }}>
            Defaults describe how work happens on this project. They are recorded in the project
            database and rendered into the documentation tab.
          </p>
          {DEFAULT_FIELDS.map((field) => (
            <div key={field.key} style={{ marginBottom: 12 }}>
              <label htmlFor={`default-${field.key}`} style={label}>
                {field.label}
              </label>
              <input
                id={`default-${field.key}`}
                style={input}
                value={profile.defaults[field.key] ?? ''}
                placeholder={field.placeholder}
                onChange={(event) => void setDefault(field.key, event.target.value)}
              />
              <div style={{ fontSize: 11, opacity: 0.6, marginTop: 3 }}>{field.hint}</div>
            </div>
          ))}
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void persistDefaults()}>
            {busy ? 'Saving…' : 'Save defaults'}
          </Button>
        </section>
      ) : null}

      {tab === 'Infrastructure' ? (
        <InfrastructureTab projectId={projectId} onChanged={() => { void refresh(); onChanged?.() }} />
      ) : null}

      {tab === 'Technologies' ? (
        <TechnologiesTab projectId={projectId} profile={profile} onChange={refresh} />
      ) : null}

      {tab === 'Teams' ? <TeamsTab projectId={projectId} onChange={refresh} /> : null}

      {tab === 'Features' ? (
        <FeaturesTab projectId={projectId} features={features} items={items} onChange={refresh} />
      ) : null}

      {tab === 'Documentation' ? (
        <section>
          <p style={{ fontSize: 13, opacity: 0.75, marginTop: 0 }}>
            Generated from the overview, technologies, and features. Nothing here is hand-edited.
          </p>
          <pre
            style={{
              ...card,
              whiteSpace: 'pre-wrap',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              maxHeight: '60vh',
              overflow: 'auto',
            }}
          >
            {profile.documentation}
          </pre>
        </section>
      ) : null}
    </div>
  )
}
/** Technologies and conventions: what the project is built with, and how. */
function TechnologiesTab({
  projectId,
  profile,
  onChange,
}: {
  projectId: string
  profile: ProjectProfile
  onChange: () => Promise<void>
}) {
  const [category, setCategory] = useState('language')
  const [name, setName] = useState('')
  const [version, setVersion] = useState('')
  const [rationale, setRationale] = useState('')
  const [conventionTitle, setConventionTitle] = useState('')
  const [conventionBody, setConventionBody] = useState('')
  const [conventionCategory, setConventionCategory] = useState('style')
  const [busy, setBusy] = useState(false)

  const addTech = async (): Promise<void> => {
    if (name.trim().length === 0) return
    setBusy(true)
    try {
      await saveProfile(projectId, {
        technologies: [
          ...profile.technologies.map(({ category: c, name: n, version: v, rationale: r }) => ({
            category: c,
            name: n,
            version: v,
            rationale: r,
          })),
          { category, name: name.trim(), version, rationale },
        ],
      })
      setName('')
      setVersion('')
      setRationale('')
      await onChange()
    } finally {
      setBusy(false)
    }
  }

  const addConvention = async (): Promise<void> => {
    if (conventionTitle.trim().length === 0) return
    setBusy(true)
    try {
      await saveProfile(projectId, {
        conventions: [
          ...profile.conventions.map((c) => ({ category: c.category, title: c.title, body: c.body })),
          { category: conventionCategory, title: conventionTitle.trim(), body: conventionBody },
        ],
      })
      setConventionTitle('')
      setConventionBody('')
      await onChange()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Technologies</h3>
        {profile.technologies.length === 0 ? (
          <p style={{ fontSize: 13, opacity: 0.7, marginTop: 0 }}>None recorded yet.</p>
        ) : (
          <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 13 }}>
            {profile.technologies.map((tech) => (
              <li key={tech.id} style={{ marginBottom: 4 }}>
                <strong>{tech.name}</strong>
                {tech.version ? ` ${tech.version}` : ''}
                <span style={{ opacity: 0.6 }}> — {tech.category}</span>
                {tech.rationale ? <div style={{ opacity: 0.7, fontSize: 12 }}>{tech.rationale}</div> : null}
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={category} onChange={(event) => setCategory(event.target.value)} style={{ ...input, width: 140 }}>
            {['language', 'framework', 'database', 'infrastructure', 'tool', 'other'].map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <input style={{ ...input, flex: 2 }} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input style={{ ...input, flex: 1 }} placeholder="Version" value={version} onChange={(e) => setVersion(e.target.value)} />
        </div>
        <input
          style={{ ...input, marginTop: 8 }}
          placeholder="Why this project uses it"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
        <div style={{ marginTop: 8 }}>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void addTech()}>
            Add technology
          </Button>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Conventions</h3>
        {profile.conventions.length === 0 ? (
          <p style={{ fontSize: 13, opacity: 0.7, marginTop: 0 }}>None recorded yet.</p>
        ) : (
          <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 13 }}>
            {profile.conventions.map((convention) => (
              <li key={convention.id} style={{ marginBottom: 4 }}>
                <strong>{convention.title}</strong>
                <span style={{ opacity: 0.6 }}> — {convention.category}</span>
                {convention.body ? <div style={{ opacity: 0.7, fontSize: 12 }}>{convention.body}</div> : null}
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={conventionCategory}
            onChange={(event) => setConventionCategory(event.target.value)}
            style={{ ...input, width: 140 }}
          >
            {['style', 'testing', 'structure', 'review', 'security', 'other'].map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <input
            style={{ ...input, flex: 2 }}
            placeholder="Title, e.g. No default exports"
            value={conventionTitle}
            onChange={(e) => setConventionTitle(e.target.value)}
          />
        </div>
        <input
          style={{ ...input, marginTop: 8 }}
          placeholder="Detail"
          value={conventionBody}
          onChange={(e) => setConventionBody(e.target.value)}
        />
        <div style={{ marginTop: 8 }}>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void addConvention()}>
            Add convention
          </Button>
        </div>
      </div>
    </section>
  )
}
/** Features with their specification and task breakdown. */
function FeaturesTab({
  projectId,
  features,
  items,
  onChange,
}: {
  projectId: string
  features: Feature[]
  items: WorkItem[]
  onChange: () => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [selected, setSelected] = useState<string | undefined>(features[0]?.id)
  const [spec, setSpec] = useState({ requirements: '', acceptance: '', exclusions: '' })
  const [team, setTeam] = useState<{ id: string; name: string; purpose: string } | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [taskTitle, setTaskTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | undefined>(undefined)

  const active = features.find((feature) => feature.id === selected)

  useEffect(() => {
    if (selected === undefined) return
    void (async () => {
      try {
        const [payload, teamList] = await Promise.all([
          getFeatureSpec(projectId, selected),
          listTeams(projectId),
        ])
        setSpec(payload.spec)
        setTeam(payload.team)
        setTeams(teamList.teams)
      } catch {
        // A feature without a spec yet is normal.
      }
    })()
  }, [projectId, selected])

  const featureTasks = useMemo(
    () => items.filter((item) => item.featureId === selected),
    [items, selected],
  )

  const addFeature = async (): Promise<void> => {
    if (title.trim().length === 0) return
    setBusy(true)
    try {
      const { feature, warning } = await createFeature(projectId, { title: title.trim() })
      setTitle('')
      setSelected(feature.id)
      setMessage(warning)
      await onChange()
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'Could not create the feature.')
    } finally {
      setBusy(false)
    }
  }

  const saveSpec = async (): Promise<void> => {
    if (selected === undefined) return
    setBusy(true)
    try {
      await saveFeatureSpec(projectId, selected, spec)
      setMessage('Specification saved.')
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  const addTask = async (): Promise<void> => {
    if (selected === undefined || taskTitle.trim().length === 0) return
    setBusy(true)
    try {
      await createItem(projectId, { title: taskTitle.trim(), featureId: selected, status: 'backlog' })
      setTaskTitle('')
      await onChange()
    } finally {
      setBusy(false)
    }
  }

  const attachTeam = async (teamId: string): Promise<void> => {
    if (selected === undefined || teamId.length === 0) return
    setBusy(true)
    try {
      await assignTeam(projectId, selected, teamId)
      const payload = await getFeatureSpec(projectId, selected)
      setTeam(payload.team)
      setMessage('Team assigned.')
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'Could not assign.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div style={card}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ ...input, flex: 3 }}
            placeholder="New feature title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void addFeature()}>
            Add feature
          </Button>
        </div>
        {features.length === 0 ? (
          <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 0 }}>No features yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
            {features.map((feature) => (
              <li key={feature.id}>
                <button
                  type="button"
                  onClick={() => setSelected(feature.id)}
                  style={{
                    display: 'flex',
                    width: '100%',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '8px 10px',
                    marginBottom: 4,
                    borderRadius: 6,
                    border: `1px solid ${feature.id === selected ? 'var(--dsw-alias-interactive-bg-active, #2563eb)' : 'transparent'}`,
                    background: 'none',
                    color: 'inherit',
                    fontSize: 13,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span>{feature.title}</span>
                  <span style={{ opacity: 0.6, fontSize: 12 }}>{feature.status}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {active === undefined ? null : (
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>{active.title}</h3>

          {(['requirements', 'acceptance', 'exclusions'] as const).map((field) => (
            <div key={field} style={{ marginBottom: 10 }}>
              <label htmlFor={`spec-${field}`} style={label}>
                {field === 'requirements' ? 'Requirements' : field === 'acceptance' ? 'Acceptance criteria' : 'Out of scope'}
              </label>
              <textarea
                id={`spec-${field}`}
                rows={3}
                style={input}
                value={spec[field]}
                onChange={(event) => setSpec({ ...spec, [field]: event.target.value })}
              />
            </div>
          ))}
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void saveSpec()}>
            Save specification
          </Button>

          <h4 style={{ margin: '18px 0 8px', fontSize: 13 }}>Tasks</h4>
          {featureTasks.length === 0 ? (
            <p style={{ fontSize: 13, opacity: 0.7, marginTop: 0 }}>No tasks yet.</p>
          ) : (
            <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>
              {featureTasks.map((item) => (
                <li key={item.id}>
                  {item.title} <span style={{ opacity: 0.6 }}>— {item.status}</span>
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ ...input, flex: 3 }}
              placeholder="New task"
              value={taskTitle}
              onChange={(event) => setTaskTitle(event.target.value)}
            />
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void addTask()}>
              Add task
            </Button>
          </div>

          <h4 style={{ margin: '18px 0 8px', fontSize: 13 }}>Team</h4>
          {team === null ? (
            <p style={{ fontSize: 13, opacity: 0.7, marginTop: 0 }}>No team assigned to this feature.</p>
          ) : (
            <p style={{ fontSize: 13, marginTop: 0 }}>
              <strong>{team.name}</strong>
              {team.purpose ? <span style={{ opacity: 0.7 }}> — {team.purpose}</span> : null}
            </p>
          )}
          {teams.length === 0 ? (
            <p style={{ fontSize: 13, opacity: 0.7 }}>
              No teams yet. Create one in the Teams tab, then assign it here.
            </p>
          ) : (
            <select
              style={{ ...input, maxWidth: 280 }}
              defaultValue={team?.id ?? ''}
              onChange={(event) => void attachTeam(event.target.value)}
              disabled={busy}
            >
              <option value="">Choose a team…</option>
              {teams.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.memberCount} members)
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {message === undefined ? null : (
        <p style={{ fontSize: 12, opacity: 0.75 }}>{message}</p>
      )}
    </section>
  )
}
/** Teams: the groups that deliver features. */
function TeamsTab({ projectId, onChange }: { projectId: string; onChange: () => Promise<void> }) {
  const [teams, setTeams] = useState<Team[]>([])
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [chosenRoles, setChosenRoles] = useState<string[]>(['product', 'engineer', 'qa'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const refresh = async (): Promise<void> => {
    try {
      const payload = await listTeams(projectId)
      setTeams(payload.teams)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not load teams.')
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const create = async (): Promise<void> => {
    if (name.trim().length === 0) return
    setBusy(true)
    setError(undefined)
    try {
      await createTeam(projectId, {
        name: name.trim(),
        purpose: purpose.trim(),
        // Each chosen role becomes one member, named after the role, with the
        // responsibility the role implies. Editing names comes next; creating
        // the shape in one step is what makes a team useful immediately.
        members: chosenRoles.map((role) => {
          const meta = ROLES.find((entry) => entry.role === role)
          return {
            role,
            name: meta?.label ?? role,
            responsibility: meta?.responsibility ?? '',
          }
        }),
      })
      setName('')
      setPurpose('')
      await refresh()
      await onChange()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not create the team.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>New team</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            style={{ ...input, flex: 2 }}
            placeholder="Team name, e.g. Portal delivery"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            style={{ ...input, flex: 3 }}
            placeholder="Purpose (optional)"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
          />
        </div>

        <fieldset style={{ border: 'none', padding: 0, margin: '0 0 10px' }}>
          <legend style={label}>Roles</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {ROLES.map((role) => (
              <label key={role.role} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={chosenRoles.includes(role.role)}
                  onChange={(event) => {
                    setChosenRoles((current) =>
                      event.target.checked
                        ? [...current, role.role]
                        : current.filter((entry) => entry !== role.role),
                    )
                  }}
                />
                {role.label}
              </label>
            ))}
          </div>
        </fieldset>

        <Button variant="primary" size="sm" disabled={busy} onClick={() => void create()}>
          {busy ? 'Creating…' : 'Create team'}
        </Button>
        {error === undefined ? null : (
          <p role="alert" style={{ color: '#b42318', fontSize: 12, marginTop: 8 }}>{error}</p>
        )}
      </div>

      {teams.length === 0 ? (
        <p style={{ fontSize: 13, opacity: 0.7 }}>No teams yet.</p>
      ) : (
        teams.map((team) => (
          <div key={team.id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong style={{ fontSize: 14 }}>{team.name}</strong>
              <span style={{ fontSize: 12, opacity: 0.6 }}>{team.memberCount} members</span>
            </div>
            {team.purpose ? (
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{team.purpose}</div>
            ) : null}
          </div>
        ))
      )}
    </section>
  )
}