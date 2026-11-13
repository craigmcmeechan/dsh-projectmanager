/**
 * ManageTeams — component.
 * Split out of client/ManageTeams.tsx by the module-structure refactor.
 */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { addTeamMember, createTeam, createWorkflow, getCapabilities, getWorkflowStages, listTeamMembers, listTeams, listWorkflows, setCapabilities, listStageDefinitions, setWorkflowStages, type StageDefinition, type Team, type TeamMember, type Workflow, type WorkflowStage } from '../profile-api/index.ts'
import { inputStyle as input, hintStyle as hint, cardStyle as card, errorStyle } from '../styles/index.ts'
import { PipelineGraph } from '../PipelineGraph/index.ts'
import { StagePromptEditor } from '../StagePromptEditor/index.ts'
import { ROLES, CAPABILITIES, STAGE_KINDS, TIERS } from './ManageTeams.module.ts'
import type { ManageTeamsProps } from './ManageTeams.interface.ts'

/**
 * Render the team management screen.
 * @param props - which project, and how to go back.
 */
export function ManageTeams({ projectId, onBack }: ManageTeamsProps) {
  const [teams, setTeams] = useState<Team[]>([])
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const refresh = async (): Promise<void> => {
    try {
      const payload = await listTeams(projectId)
      setTeams(payload.teams)
      // Keep a selection valid across refreshes.
      if (selected === undefined && payload.teams[0] !== undefined) setSelected(payload.teams[0].id)
      setError(undefined)
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
    try {
      const { teamId } = await createTeam(projectId, {
        name: name.trim(),
        purpose: purpose.trim(),
      })
      setName('')
      setPurpose('')
      await refresh()
      setSelected(teamId)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not create the team.')
    } finally {
      setBusy(false)
    }
  }

  const active = teams.find((team) => team.id === selected)

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
        <button
          type="button"
          onClick={onBack}
          style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 12 }}
        >
          Project Manager
        </button>
        <span aria-hidden="true"> \ </span>
        <span style={{ opacity: 1, fontWeight: 600 }}>Manage Teams</span>
      </nav>

      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>Manage Teams</h2>

      {error === undefined ? null : (
        <p role="alert" style={errorStyle}>{error}</p>
      )}

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>New team</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ ...input, flex: 2 }}
            placeholder="Team name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            style={{ ...input, flex: 3 }}
            placeholder="Purpose (optional)"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
          />
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void create()}>
            Create
          </Button>
        </div>
      </div>

      {teams.length === 0 ? (
        <p style={{ fontSize: 13, opacity: 0.7 }}>No teams yet.</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => setSelected(team.id)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: `1px solid ${team.id === selected ? 'var(--dsw-alias-interactive-bg-active, #2563eb)' : 'var(--dsw-alias-border-l4, #d0d5dd)'}`,
                  background: 'none',
                  color: 'inherit',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {team.name}
              </button>
            ))}
          </div>

          {active === undefined ? null : (
            <>
              <TeamMembers projectId={projectId} team={active} onChanged={refresh} />
              <TeamWorkflows projectId={projectId} team={active} />
            </>
          )}
        </>
      )}
    </div>
  )
}
/** Members of one team, with their capabilities. */
function TeamMembers({
  projectId,
  team,
  onChanged,
}: {
  projectId: string
  team: Team
  onChanged: () => Promise<void>
}) {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [role, setRole] = useState('engineer')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = async (): Promise<void> => {
    const payload = await listTeamMembers(projectId, team.id)
    setMembers(payload.members)
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, team.id])

  const add = async (): Promise<void> => {
    if (name.trim().length === 0) return
    setBusy(true)
    try {
      const meta = ROLES.find((entry) => entry.role === role)
      const { memberId } = await addTeamMember(projectId, team.id, {
        role,
        name: name.trim(),
        responsibility: meta === undefined ? '' : `${meta.label} duties`,
      })
      // Seed capabilities from the role so the member is useful immediately.
      if (meta !== undefined) await setCapabilities(projectId, memberId, meta.capabilities)
      setName('')
      await refresh()
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Members — {team.name}</h3>
      {members.length === 0 ? (
        <p style={{ ...hint, marginTop: 0 }}>No members yet.</p>
      ) : (
        <div style={{ marginBottom: 12 }}>
          {members.map((member) => (
            <MemberRow key={member.id} projectId={projectId} member={member} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <select value={role} onChange={(event) => setRole(event.target.value)} style={{ ...input, width: 140 }}>
          {ROLES.map((entry) => (
            <option key={entry.role} value={entry.role}>{entry.label}</option>
          ))}
        </select>
        <input
          style={{ ...input, flex: 2 }}
          placeholder="Member name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void add()}>
          Add member
        </Button>
      </div>
    </div>
  )
}
/** One member row with editable capabilities. */
function MemberRow({ projectId, member }: { projectId: string; member: TeamMember }) {
  const [capabilities, setLocal] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const payload = await getCapabilities(projectId, member.id)
        setLocal(payload.capabilities)
      } catch {
        setLocal([])
      }
    })()
  }, [projectId, member.id])

  const toggle = async (capability: string): Promise<void> => {
    const next = capabilities.includes(capability)
      ? capabilities.filter((entry) => entry !== capability)
      : [...capabilities, capability]
    setLocal(next)
    setBusy(true)
    try {
      await setCapabilities(projectId, member.id, next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--dsw-alias-border-l4, #f1f5f9)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <strong style={{ fontSize: 13 }}>{member.name}</strong>
          <span style={{ ...hint, display: 'inline', marginLeft: 8 }}>{member.role}</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
        {CAPABILITIES.map((capability) => (
          <label key={capability} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={capabilities.includes(capability)}
              disabled={busy}
              onChange={() => void toggle(capability)}
            />
            {capability}
          </label>
        ))}
      </div>
    </div>
  )
}
/** Workflows owned by one team, with editable stages. */
function TeamWorkflows({ projectId, team }: { projectId: string; team: Team }) {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [stages, setStages] = useState<WorkflowStage[]>([])
  const [tier, setTier] = useState('full')
  const [name, setName] = useState('')
  const [definitions, setDefinitions] = useState<StageDefinition[]>([])
  const [selectedStage, setSelectedStage] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const refresh = async (): Promise<void> => {
    const payload = await listWorkflows(projectId, team.id)
    setWorkflows(payload.workflows)
    if (selected === undefined && payload.workflows[0] !== undefined) setSelected(payload.workflows[0].id)
  }

  useEffect(() => {
    void refresh()
    void (async () => {
      try {
        const payload = await listStageDefinitions(projectId)
        setDefinitions(payload.stages)
      } catch {
        setDefinitions([])
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, team.id])

  useEffect(() => {
    if (selected === undefined) return
    void (async () => {
      try {
        const payload = await getWorkflowStages(projectId, team.id, selected)
        setStages(payload.stages)
      } catch {
        setStages([])
      }
    })()
  }, [projectId, team.id, selected])

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const workflowName = name.trim().length > 0 ? name.trim() : `${team.name} ${tier}`
      const { workflowId } = await createWorkflow(projectId, team.id, { name: workflowName, tier })
      setName('')
      await refresh()
      setSelected(workflowId)
    } finally {
      setBusy(false)
    }
  }

  /** Persist the whole stage list, optionally with one stage patched. */
  const persist = async (
    next: WorkflowStage[],
  ): Promise<void> => {
    if (selected === undefined) return
    setBusy(true)
    try {
      await setWorkflowStages(
        projectId,
        team.id,
        selected,
        next.map((stage) => ({
          kind: stage.kind,
          name: stage.name,
          parallel: stage.parallel,
          role: stage.role,
          exitCriteria: stage.exitCriteria,
          optional: stage.optional,
          prompt: stage.prompt,
          deliverable: stage.deliverable,
          notes: stage.notes,
          provider: stage.provider,
          model: stage.model,
          reasoning: stage.reasoning,
        })),
      )
      const payload = await getWorkflowStages(projectId, team.id, selected)
      setStages(payload.stages)
    } finally {
      setBusy(false)
    }
  }

  const addStage = async (kind: string): Promise<void> => {
    if (selected === undefined) return
    setBusy(true)
    try {
      const next = [
        ...stages.map((stage) => ({
          kind: stage.kind,
          name: stage.name,
          parallel: stage.parallel,
          role: stage.role,
          exitCriteria: stage.exitCriteria,
          optional: stage.optional,
          prompt: stage.prompt,
          deliverable: stage.deliverable,
          notes: stage.notes,
          provider: stage.provider,
          model: stage.model,
          reasoning: stage.reasoning,
        })),
        { kind, name: '', parallel: false, role: '', exitCriteria: '', optional: false, prompt: '', deliverable: '', notes: '', provider: '', model: '', reasoning: '' },
      ]
      await setWorkflowStages(projectId, team.id, selected, next)
      const payload = await getWorkflowStages(projectId, team.id, selected)
      setStages(payload.stages)
    } finally {
      setBusy(false)
    }
  }

  const removeStage = async (kind: string): Promise<void> => {
    if (selected === undefined) return
    setBusy(true)
    try {
      const next = stages
        .filter((stage) => stage.kind !== kind)
        .map((stage) => ({
          kind: stage.kind,
          name: stage.name,
          parallel: stage.parallel,
          role: stage.role,
          exitCriteria: stage.exitCriteria,
          optional: stage.optional,
          prompt: stage.prompt,
          deliverable: stage.deliverable,
          notes: stage.notes,
          provider: stage.provider,
          model: stage.model,
          reasoning: stage.reasoning,
        }))
      await setWorkflowStages(projectId, team.id, selected, next)
      const payload = await getWorkflowStages(projectId, team.id, selected)
      setStages(payload.stages)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>Workflows — {team.name}</h3>
      <p style={{ ...hint, marginTop: 0 }}>
        The stages a feature runs through. A mechanical change wants two stages; a new product
        wants all eight.
      </p>

      {workflows.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {workflows.map((workflow) => (
            <button
              key={workflow.id}
              type="button"
              onClick={() => setSelected(workflow.id)}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                border: `1px solid ${workflow.id === selected ? 'var(--dsw-alias-interactive-bg-active, #2563eb)' : 'var(--dsw-alias-border-l4, #d0d5dd)'}`,
                background: 'none',
                color: 'inherit',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {workflow.name} · {workflow.tier}
            </button>
          ))}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select value={tier} onChange={(event) => setTier(event.target.value)} style={{ ...input, width: 160 }}>
          {TIERS.map((entry) => (
            <option key={entry.tier} value={entry.tier}>{entry.label} — {entry.description}</option>
          ))}
        </select>
        <input
          style={{ ...input, flex: 2 }}
          placeholder="Workflow name (optional)"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void create()}>
          New workflow
        </Button>
      </div>

      {selected === undefined ? null : (
        <>
          <div style={{ marginBottom: 12 }}>
            <PipelineGraph
              stages={stages}
              {...(selectedStage === undefined ? {} : { selectedId: selectedStage })}
              onSelect={(stageId) => setSelectedStage(stageId)}
            />
          </div>

          <ol style={{ margin: '0 0 10px', paddingLeft: 20, fontSize: 13 }}>
            {stages.map((stage) => (
              <li
                key={stage.id}
                style={{ marginBottom: 6, cursor: 'pointer' }}
                onClick={() => setSelectedStage(stage.id)}
              >
                <strong>{stage.name || stage.kind}</strong>
                {(() => {
                  const def = definitions.find((entry) => entry.kind === stage.kind)
                  return def === undefined ? null : (
                    <span style={{ ...hint, display: 'inline', marginLeft: 6 }}>
                      {def.role} · {def.exitCriteria}
                    </span>
                  )
                })()}
                {stage.parallel ? <span style={{ opacity: 0.6 }}> · parallel</span> : null}
                {stage.optional ? <span style={{ opacity: 0.6 }}> · optional</span> : null}
                <button
                  type="button"
                  onClick={() => void removeStage(stage.kind)}
                  disabled={busy}
                  style={{
                    marginLeft: 8,
                    border: 'none',
                    background: 'none',
                    color: 'var(--dsw-alias-state-error-primary, #b42318)',
                    cursor: 'pointer',
                    fontSize: 11,
                  }}
                >
                  remove
                </button>
              </li>
            ))}
          </ol>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STAGE_KINDS.filter((kind) => !stages.some((stage) => stage.kind === kind)).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => void addStage(kind)}
                disabled={busy}
                style={{
                  padding: '4px 9px',
                  borderRadius: 6,
                  border: '1px dashed var(--dsw-alias-border-l4, #d0d5dd)',
                  background: 'none',
                  color: 'inherit',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                + {kind}
              </button>
            ))}
          </div>

          {(() => {
            const active = stages.find((stage) => stage.id === selectedStage)
            if (active === undefined) {
              return (
                <p style={{ ...hint, marginTop: 12 }}>
                  Select a stage above (or click a node) to edit its instruction.
                </p>
              )
            }
            return (
              <StagePromptEditor
                projectId={projectId}
                stage={active}
                onSave={async (patch) => {
                  await persist(
                    stages.map((entry) =>
                      entry.id === active.id ? { ...entry, ...patch } : entry,
                    ),
                  )
                }}
              />
            )
          })()}
        </>
      )}
    </div>
  )
}