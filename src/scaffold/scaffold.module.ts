/**
 * scaffold — module.
 * Split out of scaffold.ts by the module-structure refactor.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProjectDatabase } from '../db/index.ts'
import type { ProjectConfig } from './scaffold.interface.ts'

/** Directories created by {@link bootstrapProject}. */
const LAYOUT = ['docs', 'docs/decisions', 'features', '.dsh_project', '.dsh_project/versions']
/** Validate a project name for use as a directory and repository name. */
export function validateProjectName(name: string): string | undefined {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'A project name is required.'
  if (trimmed.length > 80) return 'A project name must be at most 80 characters.'
  // Display names may contain spaces and most punctuation; the directory and
  // repository slug derived from the name is separately validated below.
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(trimmed)) {
    return 'Start with a letter or digit; use letters, digits, spaces, dots, hyphens, and underscores.'
  }
  const slug = slugify(trimmed)
  if (slug.length === 0) return 'The name must contain at least one letter or digit.'
  // GitHub accepts these in a repository name; keeping the slug inside them
  // means the same string can name the folder and the remote repository.
  if (!/^[A-Za-z0-9._-]+$/.test(slug)) {
    return 'The derived name is not a valid repository name.'
  }
  return undefined
}
/** Convert a project name to a filesystem- and git-safe slug. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
/** The initial specification document written at bootstrap. */
function initialSpec(config: ProjectConfig): string {
  return `# ${config.name}

${config.description || 'No description yet.'}

## Context

What problem does this project solve, and for whom?

## Goals

- 

## Non-goals

- 

## Requirements

### Functional

- 

### Non-functional

- 

## Constraints

- 

## Decision log

Record significant decisions in \`docs/decisions/\` as numbered ADRs.

## Open questions

- 
`
}
/**
 * Create the project layout, database, and initial documents.
 *
 * Idempotent: running it against an existing project directory adds what is
 * missing without touching existing files or database rows.
 * @param root - absolute project directory.
 * @param input - project identity.
 * @returns the config written, and whether this call created the project.
 */
export function bootstrapProject(
  root: string,
  input: {
    name: string
    description: string
    mode: 'local' | 'remote'
    remote?: ProjectConfig['remote']
    /** Per-provider credential overrides; absent inherits the machine's. */
    credentials?: ProjectConfig['credentials']
  },
): { config: ProjectConfig; created: boolean } {
  const configPath = join(root, '.dsh_project', 'config.json')
  const already = existsSync(configPath)

  for (const dir of LAYOUT) mkdirSync(join(root, dir), { recursive: true, mode: 0o755 })

  for (const file of ['features/.gitkeep', 'docs/decisions/.gitkeep']) {
    const path = join(root, file)
    if (!existsSync(path)) writeFileSync(path, '', 'utf8')
  }

  const readmePath = join(root, 'README.md')
  if (!existsSync(readmePath)) {
    writeFileSync(
      readmePath,
      `# ${input.name}\n\n${input.description}\n\n` +
        `## Layout\n\n` +
        `| Path | Purpose |\n| --- | --- |\n` +
        `| \`docs/\` | Specification documents and decision records |\n` +
        `| \`docs/decisions/\` | Architecture decision records |\n` +
        `| \`features/\` | Per-feature databases for work in progress |\n` +
        `| \`.dsh_project/\` | Project database and configuration |\n\n` +
        `This project is managed by the DSH Projects plugin.\n`,
      'utf8',
    )
  }

  // .gitignore keeps derived state out of version control.
  const ignorePath = join(root, '.gitignore')
  if (!existsSync(ignorePath)) {
    writeFileSync(ignorePath, '.dsh_project/*.db\n.dsh_project/*.db-*\nfeatures/*.db\nfeatures/*.db-*\n', 'utf8')
  }

  const config: ProjectConfig = {
    version: 1,
    name: input.name,
    description: input.description,
    mode: input.mode,
    root,
    createdAt: already ? readConfig(root)?.createdAt ?? Date.now() : Date.now(),
    ...(input.remote === undefined ? {} : { remote: input.remote }),
    // Only written when the project actually overrides something: an absent
    // block means "inherit the machine's credentials", and writing `{}` would
    // be ambiguous.
    ...(input.credentials === undefined ? {} : { credentials: input.credentials }),
  }
  writeFileSync(configPath, `${JSON.stringify(config, undefined, 2)}\n`, { mode: 0o600 })

  // Seed the database and the initial specification.
  const db = new ProjectDatabase(join(root, '.dsh_project', 'project.db'))
  try {
    db.setMeta('name', config.name)
    db.setMeta('description', config.description)
    db.setMeta('mode', config.mode)
    db.setMeta('schema_version', '1')
    if (db.getMeta('bootstrapped_at') === undefined) {
      db.setMeta('bootstrapped_at', String(Date.now()))
    }
    const documents = db.listDocuments('spec')
    if (documents.length === 0) {
      db.createDocument({
        kind: 'spec',
        slug: 'spec',
        title: `${config.name} specification`,
        body: initialSpec(config),
        author: 'dsh-projects',
      })
    }
    // Mirror every current document to markdown for reading and committing.
    mirrorDocuments(root, db)
  } finally {
    db.close()
  }

  return { config, created: !already }
}
/** Read a project's descriptor, if present. */
export function readConfig(root: string): ProjectConfig | undefined {
  const path = join(root, '.dsh_project', 'config.json')
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ProjectConfig
  } catch {
    return undefined
  }
}
/**
 * Write every current document to its markdown path.
 *
 * The database stays authoritative; these files exist so a human (and git) can
 * read the specification without the app running.
 */
export function mirrorDocuments(root: string, db: ProjectDatabase): void {
  for (const header of db.listDocuments()) {
    const full = db.getDocument(header.id)
    if (full === undefined) continue
    const target =
      full.kind === 'spec'
        ? join(root, 'docs', `${full.slug}.md`)
        : full.kind === 'adr'
          ? join(root, 'docs', 'decisions', `${full.slug}.md`)
          : join(root, 'docs', `${full.kind}s`, `${full.slug}.md`)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, full.body, 'utf8')

    // Keep a per-revision snapshot so rollback does not need the database.
    const versionDir = join(root, '.dsh_project', 'versions', full.slug)
    mkdirSync(versionDir, { recursive: true })
    writeFileSync(join(versionDir, `${full.revision}.md`), full.body, 'utf8')
  }
}