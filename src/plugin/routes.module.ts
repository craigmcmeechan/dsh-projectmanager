/**
 * The Projects HTTP surface.
 *
 * One prefix route (`/api/projects`) with the resource dispatch that used to
 * live inline in the plugin entry. Extracted so the entry file reads as wiring
 * (services, tool registration, route mounting) instead of 900 lines of
 * request handling.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FeatureError, createFeatureWorkspace, mergeFeature } from '../features/index.ts'
import { bootstrapProject, readConfig, slugify, validateProjectName } from '../scaffold/index.ts'
import { STAGE_PROMPTS, stageInstruction } from '../stages/index.ts'
import { getRun, listRuns } from '../runner/index.ts'
import { INFRA_OPTIONS, dockerStatus, findOption, imageStatus, pullImage } from '../docker/index.ts'
import { parseImport, readMachineSettings, remoteHostsView, removeRemoteHost, settingsView, updateMachineSettings, upsertRemoteHost } from '../machine/index.ts'
import { describeTarget, installDockerOn, installGitOn, installNodeOn, installNvmOn, probeDocker, probeNode, probeSystem, remoteNodeVersionsOn } from '../target/index.ts'
import { COLUMNS } from '../db/index.ts'
import { handleStoreRequest } from './store-routes.module.ts'
import type { Target } from '../target/index.ts'
import { fail, ok, projectRootFor, readBody, readRegistry, readSettings, send, targetFor, withProject, writeRegistry, writeSettings } from './helpers.module.ts'

/**
 * Handle one `/api/projects/...` request.
 * @param req - incoming request.
 * @param res - response writer.
 * @param home - the Harness home directory the plugin resolved at mount.
 * @param deps - helpers the dispatch needs from the plugin entry.
 */
export async function handleProjectsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  home: string,
  changes?: import('./changes.module.ts').ChangeFeed,
): Promise<void> {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const rest = url.pathname.slice('/api/projects'.length).replace(/^\/+|\/+$/g, '')
          const method = req.method ?? 'GET'
          const segments = rest === '' ? [] : rest.split('/')

          // ---------------------------------------------------- /api/projects
          if (segments.length === 0) {
            if (method === 'GET') {
              const registry = readRegistry()
              const projects = registry.projects.map((entry) => ({
                ...entry,
                config: readConfig(entry.root),
              }))
              ok(res, { projects })
              return
            }
            if (method === 'POST') {
              const input = await readBody(req)
              const name = String(input.name ?? '')
              const description = String(input.description ?? '')
              const mode = input.mode === 'remote' ? 'remote' : 'local'
              const problem = validateProjectName(name)
              if (problem !== undefined) {
                throw Object.assign(new Error(problem), { code: 'invalid-name' })
              }

              // Local projects need a parent directory; the project gets its own
              // subdirectory, named after the slug.
              const parent = resolve(String(input.directory ?? ''))
              if (mode === 'local' && input.directory === undefined) {
                throw Object.assign(new Error('a directory is required for a local project'), {
                  code: 'invalid-body',
                })
              }
              const root = join(parent, slugify(name))
              if (existsSync(join(root, '.dsh_project', 'project.db'))) {
                throw Object.assign(new Error(`a project already exists at ${root}`), {
                  code: 'duplicate-name',
                })
              }

              const registry = readRegistry()
              if (registry.projects.some((p) => p.name.toLowerCase() === name.trim().toLowerCase())) {
                throw Object.assign(new Error(`a project named "${name}" is already registered`), {
                  code: 'duplicate-name',
                })
              }

              const remote =
                mode === 'remote' && input.remote !== undefined
                  ? {
                      host: String((input.remote as Record<string, unknown>).host ?? ''),
                      user: String((input.remote as Record<string, unknown>).user ?? ''),
                      port: Number((input.remote as Record<string, unknown>).port ?? 22),
                      path: String((input.remote as Record<string, unknown>).path ?? ''),
                    }
                  : undefined

              mkdirSync(parent, { recursive: true })
              // A project may override the machine's credentials at creation
              // time; only blocks with a value are written, so an untouched
              // field keeps inheriting.
              const credentials: { cloudflare?: Record<string, string>; github?: Record<string, string> } = {}
              for (const provider of ['cloudflare', 'github'] as const) {
                const raw = input[provider]
                if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
                const block: Record<string, string> = {}
                for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
                  if (typeof value === 'string' && value.length > 0) block[key] = value
                }
                if (Object.keys(block).length > 0) credentials[provider] = block
              }
              const { config } = bootstrapProject(root, {
                name: name.trim(),
                description,
                mode,
                remote,
                ...(Object.keys(credentials).length === 0 ? {} : { credentials }),
              })

              const projectId = `prj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
              registry.projects.push({ id: projectId, name: config.name, root, createdAt: config.createdAt })
              writeRegistry(registry)
              changes?.publish({ kind: 'projects' })
              ok(res, { project: { id: projectId, ...config } }, 201)
              return
            }
            send(res, 405, { ok: false, error: { code: 'method', message: 'use GET or POST' } })
            return
          }

          // --------------------------------------------------- the stores
          // Dispatched before the project routes because `store` is not a
          // project id; the handler returns false only when it does not own
          // the route, so the fall-through stays honest.
          if (segments[0] === 'store') {
            if (await handleStoreRequest(req, res, home, segments.slice(1), method, changes)) return
          }

          // ------------------------------------------------ plugin settings
          if (segments[0] === 'settings') {
            if (method === 'GET') {
              ok(res, { settings: readSettings() })
              return
            }
            if (method === 'PUT' || method === 'PATCH') {
              const input = await readBody(req)
              const next = { ...readSettings() }
              if (input.displayMode === 'button' || input.displayMode === 'menu') {
                next.displayMode = input.displayMode
              }
              writeSettings(next)
              ok(res, { settings: next })
              return
            }
            send(res, 405, { ok: false, error: { code: 'method', message: 'use GET or PUT' } })
            return
          }

          const projectId = segments[0]
          if (projectId === undefined) {
            send(res, 404, { ok: false, error: { code: 'not-found', message: 'missing project id' } })
            return
          }
          const root = projectRootFor(projectId)
          const resource = segments[1]
          // The id below a feature: features/<id>/<verb>. Hoisted so every branch
          // can rely on it and no branch can shadow another.
          const featureSpecId = segments[2]

          // -------------------------------------------------- project detail
          if (resource === undefined) {
            if (method === 'GET') {
              // Record the access so the panel can show a real "last access".
              const registry = readRegistry()
              const entry = registry.projects.find((candidate) => candidate.id === projectId)
              if (entry !== undefined) {
                entry.lastAccessedAt = Date.now()
                writeRegistry(registry)
              }
              const snapshot = withProject(root, (db) => ({
                config: readConfig(root),
                documents: db.listDocuments(),
                features: db.listFeatures(),
                items: db.listWorkItems(),
                progress: db.progress(),
                events: db.recentEvents(25),
              }))
              ok(res, snapshot)
              return
            }
            if (method === 'DELETE') {
              const registry = readRegistry()
              registry.projects = registry.projects.filter((p) => p.id !== projectId)
              writeRegistry(registry)
              changes?.publish({ kind: 'projects' })
              ok(res, {})
              return
            }
          }

          // ------------------------------------------------------ documents
          if (resource === 'documents') {
            const documentId = segments[2]
            if (documentId === undefined) {
              if (method === 'GET') {
                ok(res, { documents: withProject(root, (db) => db.listDocuments()) })
                return
              }
              if (method === 'POST') {
                const input = await readBody(req)
                const created = withProject(root, (db) => {
                  const id = db.createDocument({
                    kind: String(input.kind ?? 'note'),
                    slug: String(input.slug ?? slugify(String(input.title ?? 'untitled'))),
                    title: String(input.title ?? 'Untitled'),
                    body: String(input.body ?? ''),
                    ...(input.featureId === undefined ? {} : { featureId: String(input.featureId) }),
                    author: String(input.author ?? 'user'),
                  })
                  return db.getDocument(id)
                })
                ok(res, { document: created }, 201)
                return
              }
            }
            // Reached only when documentId was defined; the earlier branch
            // returned for the undefined case.
            const resolvedDocumentId = documentId as string
            if (method === 'GET') {
              const document = withProject(root, (db) => db.getDocument(resolvedDocumentId))
              if (document === undefined) {
                send(res, 404, { ok: false, error: { code: 'not-found', message: 'no such document' } })
                return
              }
              const revisions = withProject(root, (db) => db.listRevisions(resolvedDocumentId))
              ok(res, { document, revisions })
              return
            }
            if (method === 'PUT' || method === 'PATCH') {
              const input = await readBody(req)
              const revision = withProject(root, (db) =>
                db.reviseDocument(
                  resolvedDocumentId,
                  String(input.body ?? ''),
                  String(input.summary ?? ''),
                  String(input.author ?? 'user'),
                ),
              )
              ok(res, { revision })
              return
            }
          }

          // Path is /projects/<id>/features/<featureId>/merge, so with
          // segments [projectId, 'features', featureId, 'merge'] the feature id
          // is segments[2] and the verb is segments[3].
          const routeFeatureId = segments[2]
          if (resource === 'features' && routeFeatureId !== undefined && method === 'POST' && segments[3] === 'merge') {
            const featureId = routeFeatureId
            const feature = withProject(root, (db) => db.listFeatures().find((f) => f.id === featureId))
            if (feature === undefined) {
              send(res, 404, { ok: false, error: { code: 'not-found', message: 'no such feature' } })
              return
            }
            const report = mergeFeature(root, featureId, feature.slug)
            ok(res, { report })
            return
          }

          // ------------------------------------------------------- features
          // Collection only: a deeper path (features/<id>/spec, /team, /merge)
          // belongs to its own branch and must not be swallowed here.
          if (resource === 'features' && featureSpecId === undefined) {
            if (method === 'GET') {
              ok(res, { features: withProject(root, (db) => db.listFeatures()) })
              return
            }
            if (method === 'POST') {
              const input = await readBody(req)
              const title = String(input.title ?? '')
              const slug = slugify(String(input.slug ?? title))
              const created = withProject(root, (db) => db.createFeature({ slug, title }))
              // The worktree is created eagerly so the UI can report failure now
              // rather than at first use.
              try {
                const workspace = await createFeatureWorkspace(root, slug, String(input.base ?? 'HEAD'))
                withProject(root, (db) =>
                  db.updateFeature(created.id, {
                    status: 'active',
                    branch: workspace.branch,
                    worktreePath: workspace.path,
                    dbPath: workspace.dbPath,
                  }),
                )
                ok(res, { feature: { ...created, branch: workspace.branch, worktreePath: workspace.path } }, 201)
              } catch (error) {
                // Keep the feature row so the failure is visible and retryable.
                ok(res, { feature: created, warning: (error as Error).message }, 201)
              }
              return
            }
          }

          // ------------------------------------------------ project profile
          if (resource === 'profile') {
            if (method === 'GET') {
              ok(res, withProject(root, (db) => ({
                defaults: db.listDefaults(),
                technologies: db.listTechnologies(),
                conventions: db.listConventions(),
                documentation: db.renderDocumentation({
                  name: readConfig(root)?.name ?? 'Project',
                  description: readConfig(root)?.description ?? '',
                }),
              })))
              return
            }
            if (method === 'PUT') {
              const input = await readBody(req)
              withProject(root, (db) => {
                if (input.defaults !== undefined && typeof input.defaults === 'object') {
                  for (const [key, value] of Object.entries(input.defaults as Record<string, unknown>)) {
                    db.setDefault(key, String(value))
                  }
                }
                if (Array.isArray(input.technologies)) {
                  for (const entry of input.technologies as Array<Record<string, unknown>>) {
                    if (entry.name === undefined) continue
                    db.addTechnology({
                      category: String(entry.category ?? 'other'),
                      name: String(entry.name),
                      version: String(entry.version ?? ''),
                      rationale: String(entry.rationale ?? ''),
                    })
                  }
                }
                if (Array.isArray(input.conventions)) {
                  for (const entry of input.conventions as Array<Record<string, unknown>>) {
                    if (entry.title === undefined) continue
                    db.addConvention({
                      category: String(entry.category ?? 'other'),
                      title: String(entry.title),
                      body: String(entry.body ?? ''),
                    })
                  }
                }
                return undefined
              })
              ok(res, {})
              return
            }
          }

          // --------------------------------------------- feature specification
          if (resource === 'features' && featureSpecId !== undefined && segments[3] === 'spec') {
            if (method === 'GET') {
              ok(res, withProject(root, (db) => ({
                spec: db.getFeatureSpec(featureSpecId),
                team: db.teamForFeature(featureSpecId) ?? null,
              })))
              return
            }
            if (method === 'PUT' || method === 'PATCH') {
              const input = await readBody(req)
              withProject(root, (db) => {
                db.setFeatureSpec(featureSpecId, {
                  ...(input.requirements === undefined ? {} : { requirements: String(input.requirements) }),
                  ...(input.acceptance === undefined ? {} : { acceptance: String(input.acceptance) }),
                  ...(input.exclusions === undefined ? {} : { exclusions: String(input.exclusions) }),
                })
                return undefined
              })
              ok(res, {})
              return
            }
          }

          // ------------------------------------------------------- teams
          if (resource === 'teams') {
            const teamId = segments[2]
            if (teamId === undefined) {
              if (method === 'GET') {
                ok(res, { teams: withProject(root, (db) => db.listTeams()) })
                return
              }
              if (method === 'POST') {
                const input = await readBody(req)
                const name = String(input.name ?? '').trim()
                if (name.length === 0) {
                  throw Object.assign(new Error('a team name is required'), { code: 'invalid-body' })
                }
                const purpose = input.purpose === undefined ? '' : String(input.purpose)
                const created = withProject(root, (db) => {
                  const id = db.createTeam({ name, purpose })
                  // Members may arrive with the team, which is how a template
                  // team is created in one request.
                  if (Array.isArray(input.members)) {
                    for (const member of input.members as Array<Record<string, unknown>>) {
                      if (member.name === undefined) continue
                      db.addTeamMember({
                        teamId: id,
                        role: String(member.role ?? 'engineer'),
                        name: String(member.name),
                        ...(member.responsibility === undefined ? {} : { responsibility: String(member.responsibility) }),
                      })
                    }
                  }
                  return id
                })
                ok(res, { teamId: created }, 201)
                return
              }
            }
            if (method === 'GET') {
              const resolvedId = teamId as string
              const members = withProject(root, (db) => db.listTeamMembers(resolvedId))
              ok(res, { members })
              return
            }
            if (method === 'POST') {
              // POST /teams/<id>/members
              const input = await readBody(req)
              if (segments[3] !== 'members') {
                send(res, 404, { ok: false, error: { code: 'not-found', message: 'use /teams/<id>/members' } })
                return
              }
              const resolvedTeamId = teamId as string
              const memberId = withProject(root, (db) => {
                const created = db.addTeamMember({
                  teamId: resolvedTeamId,
                  role: String(input.role ?? 'engineer'),
                  name: String(input.name ?? 'Member'),
                  ...(input.responsibility === undefined ? {} : { responsibility: String(input.responsibility) }),
                })
                return created
              })
              ok(res, { memberId }, 201)
              return
            }
          }

          // ---------------------------------------------------- run state
          if (resource === 'runs' && method === 'GET') {
            const only = segments[2]
            const current = only === undefined ? listRuns() : [getRun(only)].filter(
              (run): run is NonNullable<typeof run> => run !== undefined,
            )
            ok(res, { runs: current })
            return
          }

          // ------------------------------------------------- stage prompts
          // The instruction each stage gives its agent, so the UI can show what
          // a stage will actually ask for rather than a label.
          if (resource === 'stages' && featureSpecId === undefined && method === 'GET') {
            ok(res, {
              stages: Object.entries(STAGE_PROMPTS).map(([kind, prompt]) => ({
                kind,
                role: prompt.role,
                deliverable: prompt.deliverable,
                exitCriteria: prompt.exitCriteria,
                // The built-in body, so the editor can show what is being
                // replaced and let a team revert to it.
                prompt: prompt.prompt,
              })),
            })
            return
          }

          if (resource === 'stages' && featureSpecId !== undefined && method === 'GET') {
            const feature = withProject(root, (db) => db.listFeatures().find((f) => f.id === featureSpecId))
            if (feature === undefined) {
              send(res, 404, { ok: false, error: { code: 'not-found', message: 'no such feature' } })
              return
            }
            ok(res, withProject(root, (db) => {
              const spec = db.getFeatureSpec(featureSpecId)
              const team = db.teamForFeature(featureSpecId)
              const kind = String(segments[3] ?? 'development')
              // A workflow stage may carry its own prompt; find it through the
              // feature's team workflow so the override actually applies.
              let override: { prompt: string; deliverable: string; exitCriteria: string } | undefined
              if (team !== undefined) {
                for (const workflow of db.listWorkflows(team.id)) {
                  const stage = db
                    .listWorkflowStages(workflow.id)
                    .find((candidate) => candidate.kind === kind)
                  if (stage !== undefined && stage.prompt.trim().length > 0) {
                    override = {
                      prompt: stage.prompt,
                      deliverable: stage.deliverable,
                      exitCriteria: stage.exitCriteria,
                    }
                    break
                  }
                }
              }
              return {
                instruction: stageInstruction(kind, {
                  featureTitle: feature.title,
                  requirement: spec.requirements,
                  acceptance: spec.acceptance,
                  teamName: team?.name ?? 'unassigned',
                  ...(override === undefined
                    ? {}
                    : {
                        promptOverride: override.prompt,
                        deliverableOverride: override.deliverable,
                        ...(override.exitCriteria.length > 0 ? { exitCriteria: override.exitCriteria } : {}),
                      }),
                }),
              }
            }))
            return
          }

          // ------------------------------------------------ machine settings
          if (resource === 'settings' && method === 'GET') {
            ok(res, { settings: settingsView(readMachineSettings(home)) })
            return
          }
          if (resource === 'settings' && method === 'PUT') {
            const input = await readBody(req)
            const updated = updateMachineSettings(home, {
              ...(input.cloudflare === undefined
                ? {}
                : { cloudflare: input.cloudflare as { accountId?: string; zone?: string; token?: string } }),
              ...(input.github === undefined
                ? {}
                : { github: input.github as { owner?: string; token?: string } }),
            })
            ok(res, { settings: settingsView(updated) })
            return
          }

          // ---------------------------------------------------- remote hosts
          if (resource === 'hosts' && method === 'GET') {
            ok(res, { hosts: remoteHostsView(home) })
            return
          }
          if (resource === 'hosts' && method === 'POST') {
            const input = await readBody(req)
            const result = upsertRemoteHost(home, {
              ...(input.id === undefined ? {} : { id: String(input.id) }),
              ...(input.label === undefined ? {} : { label: String(input.label) }),
              ...(input.host === undefined ? {} : { host: String(input.host) }),
              ...(input.user === undefined ? {} : { user: String(input.user) }),
              ...(input.port === undefined ? {} : { port: Number(input.port) }),
              ...(input.keyPath === undefined ? {} : { keyPath: String(input.keyPath) }),
            })
            if (result.error !== undefined) {
              throw Object.assign(new Error(result.error), { code: 'invalid-body' })
            }
            ok(res, { host: result.host }, 201)
            return
          }
          if (resource === 'hosts' && method === 'DELETE') {
            const input = await readBody(req)
            const removed = removeRemoteHost(home, String(input.id ?? ''))
            ok(res, { removed })
            return
          }

          // Probe an arbitrary host, so a host can be tested before a project
          // is created against it.
          if (resource === 'hosts' && segments[2] === 'probe' && method === 'POST') {
            const input = await readBody(req)
            const target: Target = {
              kind: 'remote',
              host: String(input.host ?? ''),
              user: String(input.user ?? ''),
              port: Number(input.port ?? 22),
            }
            const [system, node, docker] = await Promise.all([
              probeSystem(target),
              probeNode(target),
              probeDocker(target),
            ])
            ok(res, { system, node, docker, target: describeTarget(target) })
            return
          }

          // ---------------------------------------------------- machine probes
          // Every probe targets the machine the PROJECT runs on: a remote project
          // is probed over SSH, a local one in this process. Probing the Harness
          // host for a remote project would report the wrong machine.
          if (resource === 'machine' && method === 'GET') {
            const target = targetFor(root)
            const what = segments[2] ?? 'all'
            if (what === 'node') {
              ok(res, { node: await probeNode(target) })
              return
            }
            if (what === 'docker') {
              ok(res, { docker: await probeDocker(target) })
              return
            }
            if (what === 'all') {
              const [system, node, docker] = await Promise.all([
                probeSystem(target),
                probeNode(target),
                probeDocker(target),
              ])
              ok(res, { system, node, docker, target: describeTarget(target) })
              return
            }
            send(res, 404, { ok: false, error: { code: 'not-found', message: `unknown probe ${what}` } })
            return
          }

          if (resource === 'machine' && segments[2] === 'node' && segments[3] === 'remote' && method === 'GET') {
            ok(res, { remote: await remoteNodeVersionsOn(targetFor(root)) })
            return
          }
          if (resource === 'machine' && segments[2] === 'node' && segments[3] === 'install' && method === 'POST') {
            const input = await readBody(req)
            ok(res, { result: await installNodeOn(targetFor(root), String(input.version ?? '')) })
            return
          }
          if (resource === 'machine' && segments[2] === 'nvm' && segments[3] === 'install' && method === 'POST') {
            ok(res, { result: await installNvmOn(targetFor(root)) })
            return
          }
          if (resource === 'machine' && segments[2] === 'git' && segments[3] === 'install' && method === 'POST') {
            ok(res, { result: await installGitOn(targetFor(root)) })
            return
          }
          if (resource === 'machine' && segments[2] === 'docker' && segments[3] === 'install' && method === 'POST') {
            ok(res, { result: await installDockerOn(targetFor(root)) })
            return
          }

          // ------------------------------------------------- import teams/agents
          if (resource === 'import' && method === 'POST') {
            const input = await readBody(req)
            const text = String(input.json ?? '')
            const parsed = parseImport(text)
            if (parsed.error !== undefined) {
              throw Object.assign(new Error(parsed.error), { code: 'invalid-body' })
            }
            const created = withProject(root, (db) => {
              const teamIds: string[] = []
              for (const team of parsed.teams) {
                const teamId = db.createTeam({
                  name: team.name,
                  purpose: team.purpose ?? '',
                })
                for (const member of team.members ?? []) {
                  if (member.name === undefined) continue
                  const memberId = db.addTeamMember({
                    teamId,
                    role: member.role ?? 'engineer',
                    name: member.name,
                    ...(member.responsibility === undefined ? {} : { responsibility: member.responsibility }),
                  })
                  if (Array.isArray(member.capabilities) && member.capabilities.length > 0) {
                    db.setCapabilities(memberId, member.capabilities.map(String))
                  }
                }
                teamIds.push(teamId)
              }
              const actorIds: string[] = []
              for (const agent of parsed.agents) {
                if (agent.name === undefined) continue
                actorIds.push(
                  db.upsertActor({
                    kind: agent.kind ?? 'agent',
                    name: agent.name,
                    ...(agent.role === undefined ? {} : { role: agent.role }),
                  }),
                )
              }
              return { teamIds, actorIds }
            })
            ok(res, {
              imported: {
                teams: created.teamIds.length,
                agents: created.actorIds.length,
              },
            })
            return
          }

          // -------------------------------------------- infrastructure
          if (resource === 'infrastructure') {
            if (method === 'GET') {
              ok(res, withProject(root, (db) => ({
                requirements: db.listInfrastructure(),
              })))
              return
            }
            if (method === 'PUT') {
              const input = await readBody(req)
              const provider = String(input.provider ?? '')
              const option = findOption(provider)
              if (option === undefined) {
                throw Object.assign(new Error(`unknown infrastructure option "${provider}"`), {
                  code: 'invalid-body',
                })
              }
              withProject(root, (db) => {
                db.setInfrastructure({
                  kind: option.kind,
                  provider: option.provider,
                  label: option.label,
                  containerised: option.containerised,
                  ...(option.image === undefined ? {} : { image: option.image }),
                  ...(option.port === undefined ? {} : { port: option.port }),
                  ...(input.settings === undefined
                    ? {}
                    : { settings: input.settings as Record<string, unknown> }),
                  ...(input.necessity === undefined ? {} : { necessity: String(input.necessity) }),
                })
                return undefined
              })
              ok(res, {})
              return
            }
            if (method === 'DELETE') {
              const input = await readBody(req)
              withProject(root, (db) => {
                db.removeInfrastructure(String(input.kind ?? ''), String(input.provider ?? ''))
                return undefined
              })
              ok(res, {})
              return
            }
          }

          // ------------------------------------------------- docker probe
          // Read-only: reports whether the daemon answers, which options exist,
          // and whether each containerised image is already present.
          if (resource === 'docker' && method === 'GET') {
            const status = await dockerStatus()
            const images = status.available
              ? await Promise.all(
                  INFRA_OPTIONS.filter((option) => option.image !== undefined).map((option) =>
                    imageStatus(option.image as string),
                  ),
                )
              : []
            ok(res, { status, options: INFRA_OPTIONS, images })
            return
          }

          // Pulling is the only write here, and it is explicitly requested.
          if (resource === 'docker' && segments[2] === 'pull' && method === 'POST') {
            const input = await readBody(req)
            const image = String(input.image ?? '')
            // Only images this plugin offers may be pulled: the client must not
            // be able to name an arbitrary reference.
            const allowed = INFRA_OPTIONS.some((option) => option.image === image)
            if (!allowed) {
              throw Object.assign(new Error(`"${image}" is not an image this plugin manages`), {
                code: 'invalid-body',
              })
            }
            const result = await pullImage(image)
            ok(res, { result })
            return
          }

          // ---------------------------------------------------- workflows
          if (resource === 'workflows') {
            const teamId = segments[2]
            if (teamId === undefined) {
              send(res, 400, { ok: false, error: { code: 'invalid-body', message: 'team id required' } })
              return
            }
            const workflowId = segments[3]
            if (workflowId === undefined) {
              if (method === 'GET') {
                ok(res, { workflows: withProject(root, (db) => db.listWorkflows(teamId)) })
                return
              }
              if (method === 'POST') {
                const input = await readBody(req)
                const created = withProject(root, (db) =>
                  db.createWorkflow({
                    teamId,
                    name: String(input.name ?? 'Workflow'),
                    ...(input.tier === undefined ? {} : { tier: String(input.tier) }),
                    ...(input.purpose === undefined ? {} : { purpose: String(input.purpose) }),
                    ...(input.concurrency === undefined ? {} : { concurrency: Number(input.concurrency) }),
                  }),
                )
                ok(res, { workflowId: created }, 201)
                return
              }
            }
            // Reached only with a workflow id; the collection branch returned above.
            const resolvedWorkflowId = workflowId as string
            if (method === 'GET') {
              ok(res, withProject(root, (db) => ({ stages: db.listWorkflowStages(resolvedWorkflowId) })))
              return
            }
            if (method === 'PUT') {
              const input = await readBody(req)
              const stages = Array.isArray(input.stages)
                ? (input.stages as Array<Record<string, unknown>>).map((entry) => ({
                    kind: String(entry.kind ?? 'development'),
                    ...(entry.name === undefined ? {} : { name: String(entry.name) }),
                    ...(entry.parallel === undefined ? {} : { parallel: entry.parallel === true }),
                    ...(entry.role === undefined ? {} : { role: String(entry.role) }),
                    ...(entry.exitCriteria === undefined
                      ? {}
                      : { exitCriteria: String(entry.exitCriteria) }),
                    ...(entry.optional === undefined ? {} : { optional: entry.optional === true }),
                    // Prompt overrides are what make a stage editable; they must
                    // survive the trip through this route.
                    ...(entry.prompt === undefined ? {} : { prompt: String(entry.prompt) }),
                    ...(entry.deliverable === undefined
                      ? {}
                      : { deliverable: String(entry.deliverable) }),
                    ...(entry.notes === undefined ? {} : { notes: String(entry.notes) }),
                    ...(entry.model === undefined ? {} : { model: String(entry.model) }),
                    ...(entry.provider === undefined ? {} : { provider: String(entry.provider) }),
                    ...(entry.reasoning === undefined ? {} : { reasoning: String(entry.reasoning) }),
                  }))
                : []
              withProject(root, (db) => {
                db.setWorkflowStages(resolvedWorkflowId, stages)
                return undefined
              })
              ok(res, {})
              return
            }
            if (method === 'POST' && segments[4] === 'default') {
              withProject(root, (db) => {
                db.setDefaultWorkflow(teamId, resolvedWorkflowId)
                return undefined
              })
              ok(res, {})
              return
            }
          }

          // ------------------------------------------------ member capabilities
          if (resource === 'members' && featureSpecId !== undefined && segments[3] === 'capabilities') {
            if (method === 'GET') {
              ok(res, { capabilities: withProject(root, (db) => db.listCapabilities(featureSpecId)) })
              return
            }
            if (method === 'PUT') {
              const input = await readBody(req)
              const capabilities = Array.isArray(input.capabilities)
                ? (input.capabilities as unknown[]).map(String)
                : []
              withProject(root, (db) => {
                db.setCapabilities(featureSpecId, capabilities)
                return undefined
              })
              ok(res, {})
              return
            }
          }

          // ----------------------------------------- assign a team to a feature
          if (resource === 'features' && featureSpecId !== undefined && segments[3] === 'team' && method === 'POST') {
            const input = await readBody(req)
            const teamId = String(input.teamId ?? '')
            if (teamId.length === 0) {
              throw Object.assign(new Error('teamId is required'), { code: 'invalid-body' })
            }
            withProject(root, (db) => {
              db.assignTeamToFeature(featureSpecId, teamId)
              return undefined
            })
            ok(res, {})
            return
          }

          // ------------------------------------------------------ work items
          if (resource === 'items') {
            if (method === 'GET') {
              ok(res, { items: withProject(root, (db) => db.listWorkItems()) })
              return
            }
            if (method === 'POST') {
              const input = await readBody(req)
              const status = COLUMNS.includes(input.status as never)
                ? (input.status as (typeof COLUMNS)[number])
                : undefined
              const created = withProject(root, (db) =>
                db.createWorkItem({
                  title: String(input.title ?? 'Untitled'),
                  body: String(input.body ?? ''),
                  ...(status === undefined ? {} : { status }),
                  ...(input.featureId === undefined ? {} : { featureId: String(input.featureId) }),
                }),
              )
              ok(res, { item: created }, 201)
              return
            }
          }

          const itemId = segments[1]
          if (resource === 'items' && itemId !== undefined && method === 'PATCH') {
            const input = await readBody(req)
            const status = input.status as (typeof COLUMNS)[number]
            if (!COLUMNS.includes(status)) {
              throw Object.assign(new Error(`unknown column ${String(input.status)}`), { code: 'invalid-body' })
            }
            withProject(root, (db) => db.moveWorkItem(itemId, status, Number(input.index ?? 0)))
            ok(res, { items: withProject(root, (db) => db.listWorkItems()) })
            return
          }

          // -------------------------------------------------------- progress
          if (resource === 'progress' && method === 'GET') {
            ok(res, { progress: withProject(root, (db) => db.progress()) })
            return
          }

          send(res, 404, { ok: false, error: { code: 'not-found', message: `no route for ${rest}` } })
        } catch (error) {
          if (error instanceof FeatureError) {
            fail(res, error)
            return
          }
          fail(res, error)
        }
}
