/**
 * The project database schema.
 *
 * Inlined rather than read from disk: the package may be bundled, installed
 * under node_modules, or copied into a profile, and a relative file lookup
 * would break in at least one of those layouts.
 *
 * Extracted from the database module so the class file describes behaviour
 * rather than the whole SQL surface.
 */
export const SCHEMA = `-- Projects: a Project groups Workspaces and owns its own development record.
--
-- One database per Project, stored at <project>/.dsh_project/project.db.
-- Feature work happens in a worktree with its own features/<slug>.db, merged
-- back here when the feature is accepted.
--
-- Design notes:
--  * Everything is scoped to a Project by being IN this file; there is no
--    project_id column to get wrong.
--  * Documents are versioned, never overwritten: edits append a revision so a
--    spec can be diffed and rolled back.
--  * Work items (tasks) are the kanban unit; a card IS a work item in a column.
--  * Agents are actors; assignments are their own rows so history survives.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Project identity and settings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Versioned documents: specification, requirements, decisions, notes.
-- A document has one row per revision; \`current_rev\` on document points at the
-- live one. Nothing is ever destroyed, so history is a first-class feature.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS document (
  id           TEXT PRIMARY KEY,
  -- Discriminator: spec | feature | adr | note | brief
  kind         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  title        TEXT NOT NULL,
  -- Owning feature when kind = 'feature'; NULL for project-level documents.
  feature_id   TEXT REFERENCES feature (id) ON DELETE SET NULL,
  current_rev  INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (kind, slug)
);

CREATE TABLE IF NOT EXISTS document_revision (
  document_id  TEXT NOT NULL REFERENCES document (id) ON DELETE CASCADE,
  revision     INTEGER NOT NULL,
  -- Markdown body. Stored whole; diffs are computed, not stored.
  body         TEXT NOT NULL,
  -- Optional one-line summary of what changed in this revision.
  summary      TEXT NOT NULL DEFAULT '',
  -- Who authored it: an agent id, 'user', or a plugin name.
  author       TEXT NOT NULL DEFAULT 'user',
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (document_id, revision)
);

-- ---------------------------------------------------------------------------
-- Features: a unit of work that gets its own worktree and database.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS feature (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  -- proposed | active | review | merged | abandoned
  status       TEXT NOT NULL DEFAULT 'proposed',
  -- Branch and worktree this feature owns while active.
  branch       TEXT,
  worktree_path TEXT,
  base_commit  TEXT,
  -- Path to the feature's own database, relative to the project root.
  db_path      TEXT,
  -- Owning team. Deliberately not a foreign key: team is declared after
  -- feature, and SQLite cannot add a constraint to an existing table. The
  -- relationship is enforced by assignTeamToFeature and teamForFeature.
  team_id      TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  merged_at    INTEGER
);

-- ---------------------------------------------------------------------------
-- Work items: the kanban card. One table, status decides the column.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS work_item (
  id           TEXT PRIMARY KEY,
  feature_id   TEXT REFERENCES feature (id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  -- backlog | ready | doing | review | done | blocked
  status       TEXT NOT NULL DEFAULT 'backlog',
  -- Sort key within a column; fractional so inserts need no renumbering.
  position     REAL NOT NULL DEFAULT 0,
  -- Optional parent for checklist-style breakdown.
  parent_id    TEXT REFERENCES work_item (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  closed_at    INTEGER
);

CREATE INDEX IF NOT EXISTS work_item_board ON work_item (status, position);
CREATE INDEX IF NOT EXISTS work_item_feature ON work_item (feature_id);

-- ---------------------------------------------------------------------------
-- Actors: agents (and the human) who can own work.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS actor (
  id           TEXT PRIMARY KEY,
  -- agent | user | service
  kind         TEXT NOT NULL,
  name         TEXT NOT NULL,
  -- Free-form role label: implementer, reviewer, architect…
  role         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);

-- Who is assigned to what. Many-to-many, with history: unassigning closes the
-- row instead of deleting it, so "who worked on this" is always answerable.
CREATE TABLE IF NOT EXISTS assignment (
  id           TEXT PRIMARY KEY,
  actor_id     TEXT NOT NULL REFERENCES actor (id) ON DELETE CASCADE,
  -- Exactly one of these is set.
  work_item_id TEXT REFERENCES work_item (id) ON DELETE CASCADE,
  feature_id   TEXT REFERENCES feature (id) ON DELETE CASCADE,
  assigned_at  INTEGER NOT NULL,
  released_at  INTEGER,
  CHECK ((work_item_id IS NULL) <> (feature_id IS NULL))
);

CREATE INDEX IF NOT EXISTS assignment_open ON assignment (actor_id, released_at);
CREATE INDEX IF NOT EXISTS assignment_item ON assignment (work_item_id);

-- ---------------------------------------------------------------------------
-- Progress: an append-only event log. Progress itself is derived, never stored,
-- so it can never disagree with the items it describes.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS event (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- feature | work_item | document | assignment | project
  entity       TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  -- created | moved | assigned | released | revised | merged | commented
  action       TEXT NOT NULL,
  actor_id     TEXT REFERENCES actor (id) ON DELETE SET NULL,
  -- JSON payload: previous status, new revision, etc.
  detail       TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL,
  -- Lets a feature database's events be traced back after a merge.
  origin       TEXT NOT NULL DEFAULT 'project'
);

CREATE INDEX IF NOT EXISTS event_entity ON event (entity, entity_id, created_at);
CREATE INDEX IF NOT EXISTS event_recent ON event (created_at);

-- ---------------------------------------------------------------------------
-- Merge bookkeeping: which feature databases have been folded in, and how far.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS merge_log (
  id           TEXT PRIMARY KEY,
  feature_id   TEXT NOT NULL REFERENCES feature (id) ON DELETE CASCADE,
  merged_at    INTEGER NOT NULL,
  -- Highest feature-side event id folded in, so a re-merge is idempotent.
  last_event   INTEGER NOT NULL DEFAULT 0,
  -- Counts for a human-readable report.
  items_added  INTEGER NOT NULL DEFAULT 0,
  events_added INTEGER NOT NULL DEFAULT 0
);

-- Project-level defaults: the answers to "how should work happen here".
CREATE TABLE IF NOT EXISTS project_default (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Technologies the project uses. One row per technology.
CREATE TABLE IF NOT EXISTS technology (
  id           TEXT PRIMARY KEY,
  -- language | framework | database | infrastructure | tool | other
  category     TEXT NOT NULL,
  name         TEXT NOT NULL,
  version      TEXT NOT NULL DEFAULT '',
  -- Why this project uses it; feeds the generated documentation.
  rationale    TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  UNIQUE (category, name)
);

-- Coding conventions: naming, structure, testing, review expectations.
CREATE TABLE IF NOT EXISTS convention (
  id           TEXT PRIMARY KEY,
  -- style | testing | structure | review | security | other
  category     TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);

-- A feature's specification, split from the feature row so it can be versioned
-- and revised without touching lifecycle state.
CREATE TABLE IF NOT EXISTS feature_spec (
  feature_id   TEXT PRIMARY KEY REFERENCES feature (id) ON DELETE CASCADE,
  -- What the feature must do, in prose.
  requirements TEXT NOT NULL DEFAULT '',
  -- How anyone can tell it works.
  acceptance   TEXT NOT NULL DEFAULT '',
  -- Out of scope, so scope creep is visible.
  exclusions   TEXT NOT NULL DEFAULT '',
  updated_at   INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Teams: a group of agents assembled to deliver one feature.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  -- What this team is for; surfaced when choosing a team for a feature.
  purpose      TEXT NOT NULL DEFAULT '',
  -- active | archived
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- A member of a team: a role the agent plays, not a person.
CREATE TABLE IF NOT EXISTS team_member (
  id           TEXT PRIMARY KEY,
  team_id      TEXT NOT NULL REFERENCES team (id) ON DELETE CASCADE,
  -- product | architect | engineer | designer | qa | reviewer
  role         TEXT NOT NULL,
  -- The agent's display name within this team.
  name         TEXT NOT NULL,
  -- What this member is responsible for; feeds the brief they receive.
  responsibility TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS team_member_team ON team_member (team_id);

-- ---------------------------------------------------------------------------
-- Infrastructure: what the project needs to run.
--
-- Distinct from the technology table on purpose. A technology is what the code is
-- written with; an infrastructure requirement is a thing that must be running —
-- a database, an identity provider, a queue. It carries whether it is
-- containerised, because that decides who starts it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS infra_requirement (
  id           TEXT PRIMARY KEY,
  -- database | identity | cache | queue | storage | observability | other
  kind         TEXT NOT NULL,
  -- What supplies it: sqlite-local, postgres-docker, keycloak-docker, oauth-external…
  provider     TEXT NOT NULL,
  -- Human label used in generated documentation.
  label        TEXT NOT NULL DEFAULT '',
  -- Whether it runs in a container on this host.
  containerised INTEGER NOT NULL DEFAULT 0,
  -- Image reference when containerised, e.g. quay.io/keycloak/keycloak:26.4
  image        TEXT NOT NULL DEFAULT '',
  -- Host port the service answers on, when relevant.
  port         INTEGER,
  -- Free-form configuration the provider needs (JSON), e.g. realm, db name.
  settings     TEXT NOT NULL DEFAULT '{}',
  -- required | optional
  necessity    TEXT NOT NULL DEFAULT 'required',
  created_at   INTEGER NOT NULL,
  UNIQUE (kind, provider)
);

-- ---------------------------------------------------------------------------
-- Workflows: the ordered stages a feature moves through.
--
-- Modelled on a real R&D pipeline (requirement → PRD → design → architecture →
-- tech spec → development → QA → acceptance), but every stage is editable:
-- a team owns its workflow, and a workflow is a template a feature is run
-- against. Stage membership is what makes a pipeline, not a hard-coded list.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workflow (
  id           TEXT PRIMARY KEY,
  team_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  -- What this workflow is for.
  purpose      TEXT NOT NULL DEFAULT '',
  -- full | medium | lite | patch - the tier this workflow represents.
  tier         TEXT NOT NULL DEFAULT 'full',
  -- How many stages may run concurrently where the pipeline allows it.
  concurrency  INTEGER NOT NULL DEFAULT 3,
  is_default   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS workflow_team ON workflow (team_id);

-- One ordered stage in a workflow.
CREATE TABLE IF NOT EXISTS workflow_stage (
  id           TEXT PRIMARY KEY,
  workflow_id  TEXT NOT NULL REFERENCES workflow (id) ON DELETE CASCADE,
  -- requirement | prd | design | architecture | techspec | development | qa | acceptance
  kind         TEXT NOT NULL,
  -- Overrides the kind's default label when a team names a stage differently.
  name         TEXT NOT NULL DEFAULT '',
  position     INTEGER NOT NULL,
  -- Whether this stage can run beside its neighbours.
  parallel     INTEGER NOT NULL DEFAULT 0,
  -- Who owns it: a role from team_member, or empty when the whole team acts.
  role         TEXT NOT NULL DEFAULT '',
  -- What must be true before the stage is finished. Rendered into the brief.
  exit_criteria TEXT NOT NULL DEFAULT '',
  -- Overrides the built-in instruction for this stage. Empty means "use the
  -- default", so a workflow stores only what a team actually customised and a
  -- later improvement to the defaults still reaches every workflow.
  prompt       TEXT NOT NULL DEFAULT '',
  -- Overrides the built-in deliverable line, likewise empty when unchanged.
  deliverable  TEXT NOT NULL DEFAULT '',
  -- Free-form note shown on the node in the pipeline graph.
  notes        TEXT NOT NULL DEFAULT '',
  -- Model route for the subagent running this stage. Empty inherits the parent,
  -- which is the common case; a cheap model for mechanical stages and a
  -- stronger one for architecture is the reason these exist.
  model        TEXT NOT NULL DEFAULT '',
  provider     TEXT NOT NULL DEFAULT '',
  -- low | medium | high, adapter-owned. Empty inherits.
  reasoning    TEXT NOT NULL DEFAULT '',
  -- Whether the stage may be skipped when its condition does not apply.
  optional     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS workflow_stage_order ON workflow_stage (workflow_id, position);

-- ---------------------------------------------------------------------------
-- Team member capabilities: what each role may do, so a workflow stage can
-- name a role and mean something specific.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS member_capability (
  id           TEXT PRIMARY KEY,
  member_id    TEXT NOT NULL REFERENCES team_member (id) ON DELETE CASCADE,
  -- plan | design | implement | review | test | accept | document
  capability   TEXT NOT NULL,
  UNIQUE (member_id, capability)
);

`
