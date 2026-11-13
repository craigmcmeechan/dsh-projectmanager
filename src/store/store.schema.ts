/**
 * Schema for the plugin-wide store database.
 *
 * Kept as a literal here (not read from disk) for the same reason the project
 * database does: the package may be bundled, installed under `node_modules`, or
 * copied into a profile, and a relative file lookup would break in one of them.
 */
export const STORE_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- A container image a project may start. The reference column is unique: the same image
-- listed twice is a typo, not a feature.
CREATE TABLE IF NOT EXISTS docker_image (
  id          TEXT PRIMARY KEY,
  reference   TEXT NOT NULL UNIQUE,
  repository  TEXT NOT NULL,
  tag         TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT 'manual',
  latest      TEXT,
  checked_at  INTEGER,
  function_id TEXT,
  created_at  INTEGER NOT NULL
);

-- A function groups images by the job they do, and carries the DNS template
-- used to address a deployment of that job. The name is unique: two functions
-- called "Keycloak" would make the template ambiguous.
CREATE TABLE IF NOT EXISTS image_function (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL DEFAULT '',
  dns_template TEXT,
  port         INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- A remote server the plugin provisions and targets. The name column is unique because
-- it is what the DNS hostname is derived from, so two servers sharing a name
-- could not both be addressed.
CREATE TABLE IF NOT EXISTS remote_server (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  host              TEXT NOT NULL,
  user              TEXT NOT NULL,
  port              INTEGER NOT NULL DEFAULT 22,
  key_path          TEXT,
  password_disabled INTEGER NOT NULL DEFAULT 0,
  zone              TEXT,
  hostname          TEXT,
  default_workdir   TEXT,
  facts             TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- Credentials for this MACHINE. A project may override either block, and the
-- override lives in the project's own config.json rather than here, so a
-- machine credential is never silently mutated by a project.
--
-- Secrets are stored as-is in a 0600 file: this is the same trust boundary the
-- plugin's machine settings already use, and the browser never receives them.
CREATE TABLE IF NOT EXISTS machine_credential (
  provider   TEXT PRIMARY KEY,
  config     TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- A project template: a git repository whose 'project details' folder describes
-- how a project of that shape is set up.
--
-- The repo column is unique because two templates on one repository would be the same
-- template under two names.
CREATE TABLE IF NOT EXISTS project_template (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  description   TEXT NOT NULL DEFAULT '',
  repo          TEXT NOT NULL,
  ref           TEXT,
  -- The folder inside the repository that holds setup information. Stored per
  -- row because a repository may keep it somewhere other than the default.
  details_path  TEXT NOT NULL DEFAULT 'project details',
  -- Whether the last inspection found that folder, and what it held.
  details_found INTEGER NOT NULL DEFAULT 0,
  details_note  TEXT,
  inspected_at  INTEGER,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Plugin-wide key/value settings: the default file-store folder and anything
-- else that is one value for the whole installation rather than per project.
CREATE TABLE IF NOT EXISTS plugin_setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`
