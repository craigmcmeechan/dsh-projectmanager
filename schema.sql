-- Projects: a Project groups Workspaces and owns its own development record.
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
-- A document has one row per revision; `current_rev` on document points at the
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
