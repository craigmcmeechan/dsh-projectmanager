/**
 * db — module.
 * Split out of db.ts by the module-structure refactor.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DocumentRecord, WorkItem, Feature, Progress } from './db.interface.ts'
import type { Column, FeatureStatus } from './db.types.ts'
import { SCHEMA } from './db.schema.ts'

/**
 * The schema is inlined rather than read from disk: the package may be bundled,
 * installed under node_modules, or copied into a profile, and a relative file
 * lookup would break in at least one of those layouts.
 */
/** Kanban columns, in board order. */
export const COLUMNS = ['backlog', 'ready', 'doing', 'review', 'done', 'blocked'] as const
/** Feature lifecycle. */
export const FEATURE_STATUS = ['proposed', 'active', 'review', 'merged', 'abandoned'] as const
/** Create a stable id with a type prefix. */
function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}
/**
 * A Project's database.
 *
 * Opening is cheap and idempotent; the schema is applied with `IF NOT EXISTS`
 * so a database created by an older plugin version gains new tables without a
 * migration step. Column changes still need a migration and are not attempted
 * here.
 */
export class ProjectDatabase {
  readonly file: string
  private db: DatabaseSync

  constructor(file: string) {
    this.file = file
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(file)
    this.db.exec(SCHEMA)
    this.migrate()
  }

  /** Open the database for a project directory. */
  static forProject(projectDir: string): ProjectDatabase {
    return new ProjectDatabase(join(projectDir, '.dsh_project', 'project.db'))
  }

  /**
   * Bring an older database up to the current shape.
   *
   * `CREATE TABLE IF NOT EXISTS` never alters an existing table, so a project
   * created by an earlier version gains nothing from the schema above. Each
   * step is guarded by a column check and runs at most once.
   */
  private migrate(): void {
    const columns = (table: string): Set<string> => {
      const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>
      return new Set(rows.map((row) => row.name))
    }
    const featureColumns = columns('feature')
    if (!featureColumns.has('team_id')) {
      this.db.exec('ALTER TABLE feature ADD COLUMN team_id TEXT')
    }

    // Prompt overrides were added after workflows shipped, so a database
    // created earlier has the table without these columns.
    const stageColumns = columns('workflow_stage')
    for (const [column, definition] of [
      ['prompt', "TEXT NOT NULL DEFAULT ''"],
      ['deliverable', "TEXT NOT NULL DEFAULT ''"],
      ['notes', "TEXT NOT NULL DEFAULT ''"],
      ['model', "TEXT NOT NULL DEFAULT ''"],
      ['provider', "TEXT NOT NULL DEFAULT ''"],
      ['reasoning', "TEXT NOT NULL DEFAULT ''"],
    ] as const) {
      if (!stageColumns.has(column)) {
        this.db.exec(`ALTER TABLE workflow_stage ADD COLUMN ${column} ${definition}`)
      }
    }
  }

  /** Close the handle. Safe to call twice. */
  close(): void {
    try {
      this.db.close()
    } catch {
      // already closed
    }
  }

  // ---------------------------------------------------------------- meta
  /** Read one meta value. */
  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value
  }

  /** Write one meta value. */
  setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  // ---------------------------------------------------------------- documents
  /** List document headers without bodies. */
  listDocuments(kind?: string): Array<Omit<DocumentRecord, 'body'>> {
    const base = `SELECT d.id, d.kind, d.slug, d.title, d.feature_id AS featureId,
                         d.current_rev AS revision, d.updated_at AS updatedAt
                    FROM document d`
    const rows = (
      kind === undefined
        ? this.db.prepare(`${base} ORDER BY d.updated_at DESC`).all()
        : this.db.prepare(`${base} WHERE d.kind = ? ORDER BY d.updated_at DESC`).all(kind)
    ) as Array<Omit<DocumentRecord, 'body'>>
    return rows
  }

  /** Read a document including its current body. */
  getDocument(documentId: string): DocumentRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT d.id, d.kind, d.slug, d.title, d.feature_id AS featureId,
                d.current_rev AS revision, d.updated_at AS updatedAt,
                COALESCE(r.body, '') AS body
           FROM document d
           LEFT JOIN document_revision r
                  ON r.document_id = d.id AND r.revision = d.current_rev
          WHERE d.id = ?`,
      )
      .get(documentId) as DocumentRecord | undefined
    return row
  }

  /**
   * Create a document with its first revision.
   * @returns the new document id.
   */
  createDocument(input: {
    kind: string
    slug: string
    title: string
    body: string
    featureId?: string
    author?: string
  }): string {
    const now = Date.now()
    const documentId = id('doc')
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO document(id, kind, slug, title, feature_id, current_rev, created_at, updated_at)
           VALUES(?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(documentId, input.kind, input.slug, input.title, input.featureId ?? null, now, now)
      this.db
        .prepare(
          `INSERT INTO document_revision(document_id, revision, body, summary, author, created_at)
           VALUES(?, 1, ?, ?, ?, ?)`,
        )
        .run(documentId, input.body, 'initial', input.author ?? 'user', now)
      this.recordEvent('document', documentId, 'created', input.author, { kind: input.kind })
    })
    return documentId
  }

  /**
   * Append a revision. Documents are never overwritten in place, so history
   * stays intact and a spec can be rolled back.
   * @returns the new revision number.
   */
  reviseDocument(documentId: string, body: string, summary = '', author = 'user'): number {
    const now = Date.now()
    return this.transaction(() => {
      const current = this.db
        .prepare('SELECT current_rev AS rev FROM document WHERE id = ?')
        .get(documentId) as { rev: number } | undefined
      if (current === undefined) throw new Error(`no document ${documentId}`)
      const next = current.rev + 1
      this.db
        .prepare(
          `INSERT INTO document_revision(document_id, revision, body, summary, author, created_at)
           VALUES(?, ?, ?, ?, ?, ?)`,
        )
        .run(documentId, next, body, summary, author, now)
      this.db
        .prepare('UPDATE document SET current_rev = ?, updated_at = ? WHERE id = ?')
        .run(next, now, documentId)
      this.recordEvent('document', documentId, 'revised', author, { revision: next, summary })
      return next
    })
  }

  /** Read one historical revision. */
  getRevision(documentId: string, revision: number): { body: string; summary: string; author: string; createdAt: number } | undefined {
    return this.db
      .prepare(
        `SELECT body, summary, author, created_at AS createdAt
           FROM document_revision WHERE document_id = ? AND revision = ?`,
      )
      .get(documentId, revision) as
      | { body: string; summary: string; author: string; createdAt: number }
      | undefined
  }

  /** Every revision of one document, newest first, without bodies. */
  listRevisions(documentId: string): Array<{ revision: number; summary: string; author: string; createdAt: number }> {
    return this.db
      .prepare(
        `SELECT revision, summary, author, created_at AS createdAt
           FROM document_revision WHERE document_id = ? ORDER BY revision DESC`,
      )
      .all(documentId) as Array<{ revision: number; summary: string; author: string; createdAt: number }>
  }

  // ---------------------------------------------------------------- features
  /** List features in creation order. */
  listFeatures(): Feature[] {
    return this.db
      .prepare(
        `SELECT id, slug, title, status, branch, worktree_path AS worktreePath,
                base_commit AS baseCommit, db_path AS dbPath, team_id AS teamId,
                created_at AS createdAt, updated_at AS updatedAt, merged_at AS mergedAt
           FROM feature ORDER BY created_at`,
      )
      .all() as unknown as Feature[]
  }

  /** Create a feature row, refusing a duplicate slug with a clear error. */
  createFeature(input: { slug: string; title: string }): Feature {
    const clash = this.db
      .prepare('SELECT status FROM feature WHERE slug = ?')
      .get(input.slug) as { status: FeatureStatus } | undefined
    if (clash !== undefined) {
      // A stale row from a failed worktree creation is the common case, so the
      // message says how to recover rather than surfacing a SQLite error.
      throw Object.assign(
        new Error(
          `a feature with the slug "${input.slug}" already exists (status: ${clash.status}). ` +
            'Remove it or choose a different title.',
        ),
        { code: 'duplicate-name' },
      )
    }
    const now = Date.now()
    const featureId = id('feat')
    this.db
      .prepare(
        `INSERT INTO feature(id, slug, title, status, created_at, updated_at)
         VALUES(?, ?, ?, 'proposed', ?, ?)`,
      )
      .run(featureId, input.slug, input.title, now, now)
    this.recordEvent('feature', featureId, 'created', undefined, { slug: input.slug })
    const created = this.listFeatures().find((f) => f.id === featureId)
    if (created === undefined) throw new Error('feature insert failed')
    return created
  }

  /** Update a feature's mutable fields. */
  updateFeature(
    featureId: string,
    patch: Partial<Pick<Feature, 'title' | 'status' | 'branch' | 'worktreePath' | 'baseCommit' | 'dbPath' | 'mergedAt'>>,
  ): void {
    const sets: string[] = []
    const values: Array<string | number | null> = []
    const map: Array<[keyof typeof patch, string]> = [
      ['title', 'title'],
      ['status', 'status'],
      ['branch', 'branch'],
      ['worktreePath', 'worktree_path'],
      ['baseCommit', 'base_commit'],
      ['dbPath', 'db_path'],
      ['mergedAt', 'merged_at'],
    ]
    for (const [key, column] of map) {
      const value = patch[key]
      if (value === undefined) continue
      sets.push(`${column} = ?`)
      values.push(value as string | number | null)
    }
    if (sets.length === 0) return
    sets.push('updated_at = ?')
    values.push(Date.now())
    values.push(featureId)
    this.db.prepare(`UPDATE feature SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  // ---------------------------------------------------------------- work items
  /** Every card, board-ordered. */
  listWorkItems(featureId?: string): WorkItem[] {
    const base = `SELECT id, feature_id AS featureId, title, body, status, position,
                         parent_id AS parentId, created_at AS createdAt,
                         updated_at AS updatedAt, closed_at AS closedAt
                    FROM work_item`
    const rows = (
      featureId === undefined
        ? this.db.prepare(`${base} ORDER BY position`).all()
        : this.db.prepare(`${base} WHERE feature_id = ? ORDER BY position`).all(featureId)
    ) as unknown as WorkItem[]
    return rows
  }

  /** Create a card at the end of its column. */
  createWorkItem(input: {
    title: string
    body?: string
    status?: Column
    featureId?: string
    parentId?: string
  }): WorkItem {
    const now = Date.now()
    const status = input.status ?? 'backlog'
    const itemId = id('item')
    const max = this.db
      .prepare('SELECT COALESCE(MAX(position), 0) AS p FROM work_item WHERE status = ?')
      .get(status) as { p: number }
    this.db
      .prepare(
        `INSERT INTO work_item(id, feature_id, title, body, status, position, parent_id, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        itemId,
        input.featureId ?? null,
        input.title,
        input.body ?? '',
        status,
        max.p + 1,
        input.parentId ?? null,
        now,
        now,
      )
    this.recordEvent('work_item', itemId, 'created', undefined, { status })
    const created = this.listWorkItems().find((i) => i.id === itemId)
    if (created === undefined) throw new Error('work item insert failed')
    return created
  }

  /**
   * Move a card. The position is the target index within the destination
   * column; cards at or after it shift by one.
   */
  moveWorkItem(itemId: string, status: Column, index: number): void {
    const item = this.db.prepare('SELECT status FROM work_item WHERE id = ?').get(itemId) as
      | { status: Column }
      | undefined
    if (item === undefined) throw new Error(`no work item ${itemId}`)
    const now = Date.now()
    this.transaction(() => {
      // Park the card past the end, then make room, so the partial unique-free
      // ordering cannot collide mid-update.
      this.db.prepare('UPDATE work_item SET position = position + 1000000 WHERE id = ?').run(itemId)
      this.db
        .prepare('UPDATE work_item SET position = position + 1 WHERE status = ? AND position >= ?')
        .run(status, index)
      this.db
        .prepare(
          `UPDATE work_item
              SET status = ?, position = ?, updated_at = ?,
                  closed_at = CASE WHEN ? = 'done' THEN ? ELSE NULL END
            WHERE id = ?`,
        )
        .run(status, index, now, status, now, itemId)
      this.recordEvent('work_item', itemId, 'moved', undefined, { from: item.status, to: status })
    })
  }

  // ---------------------------------------------------------------- actors
  /** Register or update an actor by id. */
  upsertActor(input: { id?: string; kind: string; name: string; role?: string }): string {
    const actorId = input.id ?? id('actor')
    this.db
      .prepare(
        `INSERT INTO actor(id, kind, name, role, created_at) VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role`,
      )
      .run(actorId, input.kind, input.name, input.role ?? '', Date.now())
    return actorId
  }

  /** Assign an actor to a work item or feature. */
  assign(input: { actorId: string; workItemId?: string; featureId?: string }): string {
    if ((input.workItemId === undefined) === (input.featureId === undefined)) {
      throw new Error('assign needs exactly one of workItemId or featureId')
    }
    const assignmentId = id('asg')
    this.db
      .prepare(
        `INSERT INTO assignment(id, actor_id, work_item_id, feature_id, assigned_at)
         VALUES(?, ?, ?, ?, ?)`,
      )
      .run(assignmentId, input.actorId, input.workItemId ?? null, input.featureId ?? null, Date.now())
    this.recordEvent('assignment', assignmentId, 'assigned', input.actorId, {
      workItemId: input.workItemId ?? null,
      featureId: input.featureId ?? null,
    })
    return assignmentId
  }

  /** Close an assignment without deleting its history. */
  release(assignmentId: string): void {
    this.db.prepare('UPDATE assignment SET released_at = ? WHERE id = ?').run(Date.now(), assignmentId)
    this.recordEvent('assignment', assignmentId, 'released', undefined, {})
  }

  /** Open assignments for one entity. */
  assignmentsFor(entityId: string): Array<{ id: string; actorId: string; name: string; role: string }> {
    return this.db
      .prepare(
        `SELECT a.id, a.actor_id AS actorId, ac.name, ac.role
           FROM assignment a JOIN actor ac ON ac.id = a.actor_id
          WHERE (a.work_item_id = ? OR a.feature_id = ?) AND a.released_at IS NULL`,
      )
      .all(entityId, entityId) as Array<{ id: string; actorId: string; name: string; role: string }>
  }

  // ---------------------------------------------------------------- progress
  /** Derive progress from the cards; nothing is cached. */
  progress(featureId?: string): Progress {
    const rows = (
      featureId === undefined
        ? this.db.prepare('SELECT status, COUNT(*) AS n FROM work_item GROUP BY status').all()
        : this.db
            .prepare('SELECT status, COUNT(*) AS n FROM work_item WHERE feature_id = ? GROUP BY status')
            .all(featureId)
    ) as Array<{ status: Column; n: number }>
    const byColumn = Object.fromEntries(COLUMNS.map((c) => [c, 0])) as Record<Column, number>
    for (const row of rows) if (row.status in byColumn) byColumn[row.status] = row.n
    const total = Object.values(byColumn).reduce((a, b) => a + b, 0)
    const denominator = total - byColumn.blocked
    const ratio = denominator <= 0 ? 0 : byColumn.done / denominator
    return { total, byColumn, ratio }
  }

  // ---------------------------------------------------------------- events
  /** Resolve a free-form author name to an actor id, creating it if needed. */
  private actorFor(name: string): string | undefined {
    if (name.length === 0) return undefined
    const existing = this.db
      .prepare('SELECT id FROM actor WHERE id = ? OR name = ? LIMIT 1')
      .get(name, name) as { id: string } | undefined
    if (existing !== undefined) return existing.id
    // A name that is not a registered actor becomes a plain human actor. This
    // keeps authors like "user" or a plugin name usable without a prior step.
    const created = `actor_${name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`.slice(0, 64)
    this.db
      .prepare('INSERT OR IGNORE INTO actor(id, kind, name, role, created_at) VALUES(?, ?, ?, ?, ?)')
      .run(created, name === 'user' ? 'user' : 'service', name, '', Date.now())
    return created
  }

  /** Append one event. */
  recordEvent(
    entity: string,
    entityId: string,
    action: string,
    actorId: string | undefined,
    detail: Record<string, unknown>,
    origin = 'project',
  ): void {
    const resolved = actorId === undefined ? undefined : this.actorFor(actorId)
    this.db
      .prepare(
        `INSERT INTO event(entity, entity_id, action, actor_id, detail, created_at, origin)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(entity, entityId, action, resolved ?? null, JSON.stringify(detail), Date.now(), origin)
  }

  /** Recent events, newest first. */
  recentEvents(limit = 50): unknown[] {
    return this.db
      .prepare(
        `SELECT id, entity, entity_id AS entityId, action, actor_id AS actorId,
                detail, created_at AS createdAt, origin
           FROM event ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as unknown[]
  }

  /**
   * Insert a work item preserving its original id, used when merging a feature
   * database so assignments and events keep addressing the same row.
   * @returns whether a row was inserted (false when the id already exists).
   */
  importWorkItem(item: WorkItem, featureId: string): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO work_item
           (id, feature_id, title, body, status, position, parent_id, created_at, updated_at, closed_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        featureId,
        item.title,
        item.body,
        item.status,
        item.position,
        item.parentId,
        item.createdAt,
        item.updatedAt,
        item.closedAt,
      )
    return Number(result.changes) > 0
  }

  /** Events with an id greater than `since`, oldest first. */
  eventsSince(since: number): Array<{
    id: number
    entity: string
    entityId: string
    action: string
    actorId: string | null
    detail: string
    createdAt: number
  }> {
    return this.db
      .prepare(
        `SELECT id, entity, entity_id AS entityId, action, actor_id AS actorId,
                detail, created_at AS createdAt
           FROM event WHERE id > ? ORDER BY id`,
      )
      .all(since) as Array<{
      id: number
      entity: string
      entityId: string
      action: string
      actorId: string | null
      detail: string
      createdAt: number
    }>
  }

  /** Append a previously recorded event, tagging where it came from. */
  importEvent(event: {
    entity: string
    entityId: string
    action: string
    actorId: string | null
    detail: string
    createdAt: number
  }, origin: string): void {
    this.db
      .prepare(
        `INSERT INTO event(entity, entity_id, action, actor_id, detail, created_at, origin)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(event.entity, event.entityId, event.action, event.actorId, event.detail, event.createdAt, origin)
  }

  /** Highest feature event id already merged, for idempotent replays. */
  lastMergedEvent(featureId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(last_event), 0) AS n FROM merge_log WHERE feature_id = ?')
      .get(featureId) as { n: number } | undefined
    return row?.n ?? 0
  }

  /** Record one completed merge. */
  recordMerge(featureId: string, lastEvent: number, itemsAdded: number, eventsAdded: number): void {
    this.db
      .prepare(
        `INSERT INTO merge_log(id, feature_id, merged_at, last_event, items_added, events_added)
         VALUES(?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `mrg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        featureId,
        Date.now(),
        lastEvent,
        itemsAdded,
        eventsAdded,
      )
  }

  // ------------------------------------------------- project defaults & tech
  /** Every default, as a key/value map. */
  listDefaults(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM project_default').all() as unknown as Array<{
      key: string
      value: string
    }>
    return Object.fromEntries(rows.map((row) => [row.key, row.value]))
  }

  /** Write one default. */
  setDefault(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO project_default(key, value, updated_at) VALUES(?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, Date.now())
    this.recordEvent('project', 'defaults', 'revised', undefined, { key })
  }

  /** Every technology in insertion order. */
  listTechnologies(): Array<{
    id: string
    category: string
    name: string
    version: string
    rationale: string
  }> {
    return this.db
      .prepare(
        `SELECT id, category, name, version, rationale
           FROM technology ORDER BY category, name`,
      )
      .all() as unknown as Array<{
      id: string
      category: string
      name: string
      version: string
      rationale: string
    }>
  }

  /** Add or update a technology by (category, name). */
  addTechnology(input: {
    category: string
    name: string
    version?: string
    rationale?: string
  }): string {
    const techId = id('tech')
    this.db
      .prepare(
        `INSERT INTO technology(id, category, name, version, rationale, created_at)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(category, name) DO UPDATE SET
           version = excluded.version, rationale = excluded.rationale`,
      )
      .run(
        techId,
        input.category,
        input.name,
        input.version ?? '',
        input.rationale ?? '',
        Date.now(),
      )
    this.recordEvent('technology', input.name, 'created', undefined, { category: input.category })
    const row = this.db
      .prepare('SELECT id FROM technology WHERE category = ? AND name = ?')
      .get(input.category, input.name) as { id: string } | undefined
    return row?.id ?? techId
  }

  /** Remove a technology. */
  removeTechnology(technologyId: string): void {
    this.db.prepare('DELETE FROM technology WHERE id = ?').run(technologyId)
  }

  /** Every convention. */
  listConventions(): Array<{ id: string; category: string; title: string; body: string }> {
    return this.db
      .prepare('SELECT id, category, title, body FROM convention ORDER BY category, title')
      .all() as unknown as Array<{ id: string; category: string; title: string; body: string }>
  }

  /** Add a convention. */
  addConvention(input: { category: string; title: string; body?: string }): string {
    const conventionId = id('conv')
    this.db
      .prepare('INSERT INTO convention(id, category, title, body, created_at) VALUES(?, ?, ?, ?, ?)')
      .run(conventionId, input.category, input.title, input.body ?? '', Date.now())
    this.recordEvent('convention', conventionId, 'created', undefined, { title: input.title })
    return conventionId
  }

  /** Remove a convention. */
  removeConvention(conventionId: string): void {
    this.db.prepare('DELETE FROM convention WHERE id = ?').run(conventionId)
  }

  // ------------------------------------------------------ feature specification
  /** Read a feature's specification, creating an empty one on demand. */
  getFeatureSpec(featureId: string): { requirements: string; acceptance: string; exclusions: string } {
    const row = this.db
      .prepare(
        'SELECT requirements, acceptance, exclusions FROM feature_spec WHERE feature_id = ?',
      )
      .get(featureId) as
      | { requirements: string; acceptance: string; exclusions: string }
      | undefined
    return row ?? { requirements: '', acceptance: '', exclusions: '' }
  }

  /** Write a feature's specification. */
  setFeatureSpec(
    featureId: string,
    input: { requirements?: string; acceptance?: string; exclusions?: string },
  ): void {
    const current = this.getFeatureSpec(featureId)
    this.db
      .prepare(
        `INSERT INTO feature_spec(feature_id, requirements, acceptance, exclusions, updated_at)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(feature_id) DO UPDATE SET
           requirements = excluded.requirements,
           acceptance = excluded.acceptance,
           exclusions = excluded.exclusions,
           updated_at = excluded.updated_at`,
      )
      .run(
        featureId,
        input.requirements ?? current.requirements,
        input.acceptance ?? current.acceptance,
        input.exclusions ?? current.exclusions,
        Date.now(),
      )
    this.recordEvent('feature', featureId, 'revised', undefined, { section: 'spec' })
  }

  // ------------------------------------------------------------ infrastructure
  /** Every infrastructure requirement. */
  listInfrastructure(): Array<{
    id: string
    kind: string
    provider: string
    label: string
    containerised: boolean
    image: string
    port: number | null
    settings: string
    necessity: string
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, kind, provider, label, containerised, image, port, settings, necessity
           FROM infra_requirement ORDER BY kind, provider`,
      )
      .all() as unknown as Array<{
      id: string
      kind: string
      provider: string
      label: string
      containerised: number
      image: string
      port: number | null
      settings: string
      necessity: string
    }>
    return rows.map((row) => ({ ...row, containerised: row.containerised === 1 }))
  }

  /** Add or replace an infrastructure requirement, keyed by (kind, provider). */
  setInfrastructure(input: {
    kind: string
    provider: string
    label?: string
    containerised?: boolean
    image?: string
    port?: number
    settings?: Record<string, unknown>
    necessity?: string
  }): string {
    const infraId = id('infra')
    this.db
      .prepare(
        `INSERT INTO infra_requirement
           (id, kind, provider, label, containerised, image, port, settings, necessity, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(kind, provider) DO UPDATE SET
           label = excluded.label,
           containerised = excluded.containerised,
           image = excluded.image,
           port = excluded.port,
           settings = excluded.settings,
           necessity = excluded.necessity`,
      )
      .run(
        infraId,
        input.kind,
        input.provider,
        input.label ?? '',
        input.containerised === true ? 1 : 0,
        input.image ?? '',
        input.port ?? null,
        JSON.stringify(input.settings ?? {}),
        input.necessity ?? 'required',
        Date.now(),
      )
    this.recordEvent('infrastructure', input.provider, 'created', undefined, { kind: input.kind })
    const row = this.db
      .prepare('SELECT id FROM infra_requirement WHERE kind = ? AND provider = ?')
      .get(input.kind, input.provider) as { id: string } | undefined
    return row?.id ?? infraId
  }

  /** Remove an infrastructure requirement by (kind, provider). */
  removeInfrastructure(kind: string, provider: string): void {
    this.db.prepare('DELETE FROM infra_requirement WHERE kind = ? AND provider = ?').run(kind, provider)
  }

  // ---------------------------------------------------------------- teams
  /** Every team, newest first. */
  listTeams(): Array<{
    id: string
    name: string
    purpose: string
    status: string
    memberCount: number
    createdAt: number
  }> {
    return this.db
      .prepare(
        `SELECT t.id, t.name, t.purpose, t.status, t.created_at AS createdAt,
                (SELECT COUNT(*) FROM team_member m WHERE m.team_id = t.id) AS memberCount
           FROM team t ORDER BY t.created_at DESC`,
      )
      .all() as unknown as Array<{
      id: string
      name: string
      purpose: string
      status: string
      memberCount: number
      createdAt: number
    }>
  }

  /** Create a team. */
  createTeam(input: { name: string; purpose?: string }): string {
    const teamId = id('team')
    const now = Date.now()
    this.db
      .prepare('INSERT INTO team(id, name, purpose, status, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(teamId, input.name, input.purpose ?? '', 'active', now, now)
    this.recordEvent('team', teamId, 'created', undefined, { name: input.name })
    return teamId
  }

  /** Members of one team, in creation order. */
  listTeamMembers(teamId: string): Array<{
    id: string
    role: string
    name: string
    responsibility: string
  }> {
    return this.db
      .prepare(
        `SELECT id, role, name, responsibility FROM team_member
          WHERE team_id = ? ORDER BY created_at`,
      )
      .all(teamId) as unknown as Array<{ id: string; role: string; name: string; responsibility: string }>
  }

  /** Add a member to a team. */
  addTeamMember(input: {
    teamId: string
    role: string
    name: string
    responsibility?: string
  }): string {
    const memberId = id('member')
    this.db
      .prepare(
        'INSERT INTO team_member(id, team_id, role, name, responsibility, created_at) VALUES(?, ?, ?, ?, ?, ?)',
      )
      .run(memberId, input.teamId, input.role, input.name, input.responsibility ?? '', Date.now())
    this.db.prepare('UPDATE team SET updated_at = ? WHERE id = ?').run(Date.now(), input.teamId)
    this.recordEvent('team', input.teamId, 'revised', undefined, { added: input.name, role: input.role })
    return memberId
  }

  /** Remove a team member. */
  removeTeamMember(memberId: string): void {
    this.db.prepare('DELETE FROM team_member WHERE id = ?').run(memberId)
  }

  // ------------------------------------------------------------ workflows
  /** Default stages per tier, mirroring a real R&D pipeline. */
  private static readonly STAGE_SETS: Record<string, string[]> = {
    // Mechanical change: implement and verify only.
    patch: ['development', 'qa'],
    lite: ['requirement', 'development', 'qa'],
    medium: ['requirement', 'prd', 'techspec', 'development', 'qa'],
    full: ['requirement', 'prd', 'design', 'architecture', 'techspec', 'development', 'qa', 'acceptance'],
  }

  /** The stages a tier starts with. */
  stagesForTier(tier: string): string[] {
    return ProjectDatabase.STAGE_SETS[tier] ?? ProjectDatabase.STAGE_SETS.full ?? []
  }

  /** Every workflow for a team, default first. */
  listWorkflows(teamId: string): Array<{
    id: string
    name: string
    purpose: string
    tier: string
    concurrency: number
    isDefault: boolean
    stageCount: number
  }> {
    return this.db
      .prepare(
        `SELECT w.id, w.name, w.purpose, w.tier, w.concurrency, w.is_default AS isDefault,
                (SELECT COUNT(*) FROM workflow_stage s WHERE s.workflow_id = w.id) AS stageCount
           FROM workflow w WHERE w.team_id = ?
          ORDER BY w.is_default DESC, w.created_at`,
      )
      .all(teamId) as unknown as Array<{
      id: string
      name: string
      purpose: string
      tier: string
      concurrency: number
      isDefault: boolean
      stageCount: number
    }>
  }

  /** Stages of one workflow, in order. */
  listWorkflowStages(workflowId: string): Array<{
    id: string
    kind: string
    name: string
    position: number
    parallel: boolean
    role: string
    exitCriteria: string
    optional: boolean
    prompt: string
    deliverable: string
    notes: string
    model: string
    provider: string
    reasoning: string
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, kind, name, position, parallel, role,
                exit_criteria AS exitCriteria, optional,
                prompt, deliverable, notes, model, provider, reasoning
           FROM workflow_stage WHERE workflow_id = ? ORDER BY position`,
      )
      .all(workflowId) as unknown as Array<{
      id: string
      kind: string
      name: string
      position: number
      parallel: number
      role: string
      exitCriteria: string
      optional: number
      prompt: string
      deliverable: string
      notes: string
      model: string
      provider: string
      reasoning: string
    }>
    return rows.map((row) => ({
      ...row,
      parallel: row.parallel === 1,
      optional: row.optional === 1,
    }))
  }

  /**
   * Create a workflow from a tier's default stage set.
   * @param input - owning team, name, and tier.
   * @returns the workflow id.
   */
  createWorkflow(input: {
    teamId: string
    name: string
    tier?: string
    purpose?: string
    concurrency?: number
  }): string {
    const tier = input.tier ?? 'full'
    const workflowId = id('wf')
    const now = Date.now()
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO workflow(id, team_id, name, purpose, tier, concurrency, is_default, created_at, updated_at)
           VALUES(?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(
          workflowId,
          input.teamId,
          input.name,
          input.purpose ?? '',
          tier,
          input.concurrency ?? 3,
          now,
          now,
        )
      const stages = this.stagesForTier(tier)
      stages.forEach((kind, index) => {
        this.db
          .prepare(
            `INSERT INTO workflow_stage(id, workflow_id, kind, name, position, parallel, role, exit_criteria, optional)
             VALUES(?, ?, ?, '', ?, ?, '', '', 0)`,
          )
          .run(`${workflowId}_s${index}`, workflowId, kind, index, kind === 'development' ? 1 : 0)
      })
      this.recordEvent('workflow', workflowId, 'created', undefined, { tier, stages: stages.length })
    })
    return workflowId
  }

  /** Set a workflow's stage list, replacing what is there. */
  setWorkflowStages(
    workflowId: string,
    stages: Array<{
      kind: string
      name?: string
      parallel?: boolean
      role?: string
      exitCriteria?: string
      optional?: boolean
      prompt?: string
      deliverable?: string
      notes?: string
      model?: string
      provider?: string
      reasoning?: string
    }>,
  ): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM workflow_stage WHERE workflow_id = ?').run(workflowId)
      stages.forEach((stage, index) => {
        this.db
          .prepare(
            `INSERT INTO workflow_stage(id, workflow_id, kind, name, position, parallel, role, exit_criteria, optional, prompt, deliverable, notes, model, provider, reasoning)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            `${workflowId}_s${index}`,
            workflowId,
            stage.kind,
            stage.name ?? '',
            index,
            stage.parallel === true ? 1 : 0,
            stage.role ?? '',
            stage.exitCriteria ?? '',
            stage.optional === true ? 1 : 0,
            stage.prompt ?? '',
            stage.deliverable ?? '',
            stage.notes ?? '',
            stage.model ?? '',
            stage.provider ?? '',
            stage.reasoning ?? '',
          )
      })
      this.db.prepare('UPDATE workflow SET updated_at = ? WHERE id = ?').run(Date.now(), workflowId)
      this.recordEvent('workflow', workflowId, 'revised', undefined, { stages: stages.length })
    })
  }

  /** Mark one workflow as its team's default. */
  setDefaultWorkflow(teamId: string, workflowId: string): void {
    this.transaction(() => {
      this.db.prepare('UPDATE workflow SET is_default = 0 WHERE team_id = ?').run(teamId)
      this.db.prepare('UPDATE workflow SET is_default = 1 WHERE id = ?').run(workflowId)
    })
  }

  /** Capabilities a team member holds. */
  listCapabilities(memberId: string): string[] {
    const rows = this.db
      .prepare('SELECT capability FROM member_capability WHERE member_id = ?')
      .all(memberId) as unknown as Array<{ capability: string }>
    return rows.map((row) => row.capability)
  }

  /** Replace a team member's capabilities. */
  setCapabilities(memberId: string, capabilities: string[]): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM member_capability WHERE member_id = ?').run(memberId)
      for (const capability of capabilities) {
        this.db
          .prepare('INSERT INTO member_capability(id, member_id, capability) VALUES(?, ?, ?)')
          .run(id('cap'), memberId, capability)
      }
    })
  }

  /**
   * Assign a team to a feature. The assignment is stored on the feature row so a
   * feature has at most one owning team, which is what "assign a team to a
   * feature" means in practice.
   */
  assignTeamToFeature(featureId: string, teamId: string): void {
    this.db.prepare('UPDATE feature SET team_id = ?, updated_at = ? WHERE id = ?').run(teamId, Date.now(), featureId)
    this.recordEvent('feature', featureId, 'assigned', undefined, { teamId })
  }

  /** The team assigned to a feature, if any. */
  teamForFeature(featureId: string): { id: string; name: string; purpose: string } | undefined {
    return this.db
      .prepare(
        `SELECT t.id, t.name, t.purpose FROM team t
           JOIN feature f ON f.team_id = t.id
          WHERE f.id = ?`,
      )
      .get(featureId) as { id: string; name: string; purpose: string } | undefined
  }

  /** Render the project's documentation from its current state. */
  renderDocumentation(opts: { name: string; description: string }): string {
    const defaults = this.listDefaults()
    const technologies = this.listTechnologies()
    const conventions = this.listConventions()
    const features = this.listFeatures()

    const lines: string[] = [`# ${opts.name}`, '', opts.description || '_No description._', '']

    if (Object.keys(defaults).length > 0) {
      lines.push('## Project defaults', '')
      for (const [key, value] of Object.entries(defaults).sort()) {
        lines.push(`- **${key}**: ${value}`)
      }
      lines.push('')
    }

    if (technologies.length > 0) {
      lines.push('## Technologies', '', '| Category | Name | Version | Rationale |', '| --- | --- | --- | --- |')
      for (const tech of technologies) {
        lines.push(`| ${tech.category} | ${tech.name} | ${tech.version || '—'} | ${tech.rationale || '—'} |`)
      }
      lines.push('')
    }

    if (conventions.length > 0) {
      lines.push('## Conventions', '')
      const byCategory = new Map<string, typeof conventions>()
      for (const convention of conventions) {
        const bucket = byCategory.get(convention.category) ?? []
        bucket.push(convention)
        byCategory.set(convention.category, bucket)
      }
      for (const [category, entries] of [...byCategory].sort()) {
        lines.push(`### ${category}`, '')
        for (const entry of entries) {
          lines.push(`- **${entry.title}**${entry.body ? ` — ${entry.body}` : ''}`)
        }
        lines.push('')
      }
    }

    if (features.length > 0) {
      lines.push('## Features', '')
      for (const feature of features) {
        lines.push(`### ${feature.title} (${feature.status})`, '')
        const spec = this.getFeatureSpec(feature.id)
        if (spec.requirements) lines.push('**Requirements**', '', spec.requirements, '')
        if (spec.acceptance) lines.push('**Acceptance**', '', spec.acceptance, '')
        if (spec.exclusions) lines.push('**Out of scope**', '', spec.exclusions, '')
      }
    }

    return lines.join('\n')
  }

  /** Run a function inside a transaction, rolling back on throw. */
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
/** Whether a project directory already holds a database. */
export function hasProjectDatabase(projectDir: string): boolean {
  return existsSync(join(projectDir, '.dsh_project', 'project.db'))
}