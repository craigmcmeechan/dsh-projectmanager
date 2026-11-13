/**
 * Inspecting a project template repository.
 *
 * A template points at a git repository; that repository may carry a
 * `project details` folder describing how a project of that shape is set up.
 * This module answers one question — *what is in that folder* — without
 * touching the project being created.
 *
 * ## Why a shallow clone into a temp directory
 *
 * Reading a remote repository requires fetching it. A shallow, single-branch
 * clone into a temporary directory is the smallest operation that answers the
 * question, and it is deleted immediately afterwards. Nothing from the template
 * is ever written into a project here: scaffolding is future work, and this
 * check must not become an accidental half-implementation of it.
 *
 * A local path is read in place instead, which is what makes templates testable
 * without a network.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TemplateInspection, TemplateSetup } from './store.types.ts'

const run = promisify(execFile)

/** Same promise-shaped runner, kept separately so the git helper reads plainly. */
const run2 = promisify(execFile)

/**
 * The folder a template repository uses for its setup information.
 *
 * Fixed, not configurable: a per-template name would mean every consumer had to
 * be told where to look. Hyphenated to match the rest of the repository layout.
 */
export const DETAILS_FOLDER = 'project-details'

/** The descriptor file that folder may carry. */
export const DETAILS_FILE = 'project.setup.json'

/** Bound on how much of the tree is walked, so a huge repo cannot stall this. */
const MAX_FILES = 200

/** Refuse a path that could escape the clone root. */
function safeJoin(root: string, child: string): string | undefined {
  const normalised = child.replaceAll('\\', '/').replace(/^\/+/, '')
  if (normalised.split('/').includes('..')) return undefined
  return join(root, normalised)
}

/** Whether a string looks like a URL rather than a local path. */
export function isRemoteRepo(repo: string): boolean {
  return /^(https?|ssh|git):\/\//.test(repo) || /^[\w.-]+@[\w.-]+:/.test(repo)
}

/**
 * List files under a directory, bounded and relative.
 * @param root - directory to walk.
 * @param limit - maximum entries to return.
 */
async function listFiles(root: string, limit: number): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    if (out.length >= limit) return
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // An unreadable subdirectory is not fatal; its absence is reported by the
      // file list simply not containing it.
      return
    }
    for (const entry of entries) {
      if (out.length >= limit) return
      const rel = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), rel)
      } else if (entry.isFile()) {
        out.push(rel)
      }
    }
  }
  await walk(root, '')
  return out.sort()
}

/**
 * Parse a setup descriptor, preserving unknown keys.
 *
 * Unknown keys are kept rather than dropped so a template written for a newer
 * plugin still round-trips through an older one.
 * @param text - the raw JSON.
 * @returns the setup, or a warning describing why it could not be read.
 */
export function parseSetup(text: string): { setup?: TemplateSetup; warning?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { warning: `${DETAILS_FILE} is not valid JSON: ${(error as Error).message}` }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { warning: `${DETAILS_FILE} must contain a JSON object` }
  }
  return { setup: parsed as TemplateSetup }
}

/**
 * Inspect a directory for the details folder.
 * @param root - the repository root on disk.
 * @param detailsPath - folder name to look for, relative to the root.
 */
async function inspectDirectory(root: string, detailsPath: string): Promise<TemplateInspection> {
  const target = safeJoin(root, detailsPath)
  if (target === undefined) {
    return { found: false, files: [], warnings: [], error: `"${detailsPath}" is not a usable path` }
  }

  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(target)
  } catch {
    return {
      found: false,
      files: [],
      warnings: [],
      error: `no "${detailsPath}" folder at the repository root`,
    }
  }
  if (!info.isDirectory()) {
    return { found: false, files: [], warnings: [], error: `"${detailsPath}" exists but is not a folder` }
  }

  const files = await listFiles(target, MAX_FILES)
  const warnings: string[] = []
  let setup: TemplateSetup | undefined

  const setupPath = join(target, DETAILS_FILE)
  try {
    const text = await readFile(setupPath, 'utf8')
    const parsed = parseSetup(text)
    if (parsed.warning !== undefined) warnings.push(parsed.warning)
    if (parsed.setup !== undefined) setup = parsed.setup
  } catch {
    // A details folder without a descriptor is valid: it may hold only notes.
    warnings.push(`no ${DETAILS_FILE} in "${detailsPath}"; the folder is still usable`)
  }

  return {
    found: true,
    files,
    warnings,
    ...(setup === undefined ? {} : { setup }),
  }
}

/**
 * Inspect a template repository for its details folder.
 *
 * @param repo - clone URL or local path.
 * @param detailsPath - folder to look for, relative to the repository root.
 * @param ref - branch, tag, or commit; absent uses the repository default.
 * @returns what was found. A failure is reported in `error`, never thrown.
 */
export async function inspectTemplate(
  repo: string,
  detailsPath = DETAILS_FOLDER,
  ref?: string,
): Promise<TemplateInspection> {
  const trimmed = repo.trim()
  if (trimmed.length === 0) {
    return { found: false, files: [], warnings: [], error: 'no repository given' }
  }

  // A local directory is inspected in place: no network, no temp copy.
  if (!isRemoteRepo(trimmed)) {
    try {
      const info = await stat(trimmed)
      if (!info.isDirectory()) {
        return { found: false, files: [], warnings: [], error: 'that path is not a directory' }
      }
    } catch {
      return { found: false, files: [], warnings: [], error: 'no directory at that path' }
    }
    return inspectDirectory(trimmed, detailsPath)
  }

  let work: string | undefined
  try {
    work = await mkdtemp(join(tmpdir(), 'dsh-template-'))
    const args = ['clone', '--depth', '1', '--single-branch']
    if (ref !== undefined && ref.trim().length > 0) args.push('--branch', ref.trim())
    args.push(trimmed, work)
    await run('git', args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })
    return await inspectDirectory(work, detailsPath)
  } catch (error) {
    const detail = error as { stderr?: string; message?: string; code?: string }
    return {
      found: false,
      files: [],
      warnings: [],
      error:
        detail.code === 'ENOENT'
          ? 'the git command is not installed on this host'
          : (detail.stderr ?? detail.message ?? 'clone failed').trim().split('\n').slice(-1)[0] ??
            'clone failed',
    }
  } finally {
    // Always remove the clone: a template inspection must leave nothing behind.
    if (work !== undefined) await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Create a new template workspace on disk.
 *
 * The folder name is derived from the title and the details folder is always
 * `project-details`: a template's shape is fixed, and a per-template details
 * folder would mean every consumer had to be told where to look. This is
 * deliberately not configurable.
 *
 * Contents written:
 *
 *   - `<title-slug>/project-details/project.setup.json` — the machine-readable setup
 *   - `<title-slug>/project-details/README.md` — notes for whoever fills it in
 *   - `<title-slug>/AGENTS.md` — instructions for agents working in this template
 *   - `<title-slug>/README.md` — what the template is
 *
 * Then `git init` and one initial commit, so the template is a real repository
 * from the first moment rather than a directory someone has to initialise.
 *
 * @param parent - directory the new workspace is created inside.
 * @param name - template title; slugified for the folder name.
 * @param repo - a source repository this template came from, recorded in the setup.
 * @returns the created path, or the reason it could not be created.
 */
export async function createTemplateWorkspace(
  parent: string,
  name: string,
  repo = '',
): Promise<{ path?: string; folder?: string; error?: string }> {
  const folder = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  if (folder.length === 0) return { error: 'that name produces an empty folder name' }

  const root = join(parent, folder)
  try {
    // `recursive: false` on purpose: an existing directory would silently merge
    // two templates, so a collision must be reported rather than absorbed.
    await mkdir(root, { recursive: false })
  } catch (error) {
    const code = (error as { code?: string }).code
    return {
      error:
        code === 'EEXIST'
          ? `a folder named "${folder}" already exists at ${parent}`
          : `could not create ${root}: ${(error as Error).message}`,
    }
  }

  const details = join(root, DETAILS_FOLDER)

  try {
    await mkdir(details, { recursive: true })

    const setup: Record<string, unknown> = {
      kind: 'project-template',
      name: name.trim(),
      detailsFolder: DETAILS_FOLDER,
      ...(repo.trim().length === 0 ? {} : { sourceRepository: repo.trim() }),
      createdAt: new Date().toISOString(),
    }
    await writeFile(join(details, DETAILS_FILE), `${JSON.stringify(setup, undefined, 2)}\n`, 'utf8')

    await writeFile(
      join(details, 'README.md'),
      `# ${name.trim()} — project details\n\n` +
        `How a project made from this template should be set up.\n\n` +
        `- \`${DETAILS_FILE}\` records the machine-readable setup.\n` +
        `- Add any notes this template needs beside it.\n`,
      'utf8',
    )

    // AGENTS.md at the root: agents working inside a project made from this
    // template read it first, so the conventions belong here rather than buried
    // in the details folder.
    await writeFile(
      join(root, 'AGENTS.md'),
      `# AGENTS.md — ${name.trim()}\n\n` +
        `Instructions for agents working in a project created from this template.\n\n` +
        `## Setup\n\n` +
        `The machine-readable setup for this template lives in \`${DETAILS_FOLDER}/${DETAILS_FILE}\`.\n` +
        `Read it before changing project structure.\n\n` +
        `## Conventions\n\n` +
        `- Describe the layout, toolchain, and commands a project of this shape expects.\n` +
        `- Note anything that must not be changed, and why.\n`,
      'utf8',
    )

    await writeFile(
      join(root, 'README.md'),
      `# ${name.trim()}\n\n` +
        `A project template. The \`${DETAILS_FOLDER}\` folder describes how a project of this shape is set up.\n`,
      'utf8',
    )

    // The release script enforces the rule that every commit bumps the version
    // and records it: a rule written only in prose is a rule that decays.
    await mkdir(join(root, 'scripts'), { recursive: true })
    await writeFile(join(root, 'scripts', 'release.mjs'), RELEASE_SCRIPT, 'utf8')
    await writeFile(join(details, 'release-process.md'), RELEASE_DOC, 'utf8')

    // A changelog and a version, so every template starts at a known point and
    // its history has somewhere to be recorded from the first commit.
    await writeFile(
      join(root, 'CHANGELOG.md'),
      renderChangelog(
        name.trim(),
        TEMPLATE_INITIAL_VERSION,
        [
          { kind: 'Added', text: `the \`${folder}\` project template.` },
          { kind: 'Added', text: '`project-details/project.setup.json`, describing how a project of this shape is set up.' },
          { kind: 'Added', text: '`AGENTS.md` with instructions for agents working in a project made from this template.' },
          { kind: 'Added', text: '`README.md` describing the template.' },
          { kind: 'Added', text: 'This changelog, and a `package.json` carrying the template version.' },
        ],
        new Date(),
      ),
      'utf8',
    )
    await writeFile(
      join(root, 'package.json'),
      `${JSON.stringify({ name: folder, version: TEMPLATE_INITIAL_VERSION, private: true }, undefined, 2)}\n`,
      'utf8',
    )

    // Ignore build and dependency noise so the initial commit holds only what
    // the template author wrote.
    await writeFile(
      join(root, '.gitignore'),
      'node_modules/\ndist/\n.turbo/\n*.log\n',
      'utf8',
    )
  } catch (error) {
    // A half-written template is worse than none: remove what was made.
    await rm(root, { recursive: true, force: true }).catch(() => {})
    return { error: `could not write the template files: ${(error as Error).message}` }
  }

  // Initialise the repository and make one commit. A template that is not a
  // repository cannot be cloned, which is the whole point of it.
  const committed = await initialiseRepository(root, name.trim())
  if (committed !== undefined) {
    // Keep the files: the operator can commit by hand, and deleting their work
    // over a missing git identity would be worse than a warning.
    return { path: root, folder, error: committed }
  }

  return { path: root, folder }
}

/**
 * The release script written into every template.
 *
 * `node scripts/release.mjs patch "Describe the change"` bumps the version,
 * prepends a changelog entry, stages everything it touched, and commits. It
 * exists so "bump the version and update the changelog on every commit" is
 * enforced by a command rather than remembered.
 */
const RELEASE_SCRIPT = `#!/usr/bin/env node
/**
 * Record a release: bump the version, add a changelog entry, commit both.
 *
 * Usage: node scripts/release.mjs <patch|minor|major> "What changed"
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const [part, ...rest] = process.argv.slice(2)
const message = rest.join(' ').trim()
if (!['patch', 'minor', 'major'].includes(part ?? '')) {
  console.error('usage: node scripts/release.mjs <patch|minor|major> "What changed"')
  process.exit(1)
}
if (message.length === 0) {
  console.error('a changelog entry describing the change is required')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const [major, minor, patch] = String(pkg.version).split('.').map(Number)
const next =
  part === 'major' ? major + 1 + '.0.0'
    : part === 'minor' ? major + '.' + (minor + 1) + '.0'
      : major + '.' + minor + '.' + (patch + 1)

pkg.version = next
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n')

const today = new Date().toISOString().slice(0, 10)
const existing = readFileSync('CHANGELOG.md', 'utf8')
const heading = '## [' + next + '] - ' + today
// Insert the new section above the first existing version heading.
const at = existing.indexOf('## [')
const entry = heading + '\\n\\n- ' + message + '\\n\\n'
writeFileSync(
  'CHANGELOG.md',
  at === -1 ? existing.trimEnd() + '\\n\\n' + entry : existing.slice(0, at) + entry + existing.slice(at),
)

execFileSync('git', ['add', '--all'], { stdio: 'inherit' })
// The -c flags scope the identity to this commit: a fresh machine may have
// no user.email, and a release must not fail after it already edited files.
execFileSync(
  'git',
  ['-c', 'user.name=DSH Project Manager', '-c', 'user.email=project-manager@localhost',
    'commit', '-m', 'chore(release): v' + next + ' — ' + message],
  { stdio: 'inherit' },
)
console.log('Released v' + next)
`

/** Documentation of the release rule, written into the template's details folder. */
const RELEASE_DOC = `# Release process

Every commit that changes the template bumps its version and records the change.

\`\`\`sh
node scripts/release.mjs patch "Describe what changed"
\`\`\`

That script:

1. increments the version in \`package.json\` (\`patch\`, \`minor\`, or \`major\`);
2. prepends a dated entry to \`CHANGELOG.md\`;
3. stages both and commits \`chore(release): v<version> — <message>\`.

The version lives in \`package.json\` and the changelog follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).
`

/** Version a new template starts at. */
export const TEMPLATE_INITIAL_VERSION = '0.1.0'

/**
 * Render a CHANGELOG.md from a version and a list of entries.
 *
 * Keep a Changelog ordering, newest first. The creation entry is recorded as
 * "Added" because a template's first commit adds everything it contains.
 *
 * @param title - the template's title.
 * @param version - the version this section describes.
 * @param entries - one line per change, already worded for the reader.
 * @param date - the section's date.
 */
export function renderChangelog(
  title: string,
  version: string,
  entries: Array<{ kind: string; text: string }> | string[],
  date: Date,
): string {
  const day = date.toISOString().slice(0, 10)
  const lines = entries.map((entry) =>
    typeof entry === 'string' ? `- ${entry}` : `- **${entry.kind}** ${entry.text}`,
  )
  return `# Changelog\n\nAll notable changes to the ${title} project template.\n\n` +
    `The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),\n` +
    `and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).\n\n` +
    `## [${version}] - ${day}\n\n` +
    (lines.length === 0 ? `- Initial template scaffold.\n` : `${lines.join('\n')}\n`)
}

/**
 * Bump a semantic version.
 *
 * `major` resets the lower parts; `minor` resets the patch; `patch` changes only
 * the last part. A pre-release suffix is dropped, because a release that is
 * being recorded in a changelog is no longer a pre-release.
 * @param version - the current version, e.g. `0.1.0`.
 * @param part - which part to increment.
 */
export function bumpVersion(version: string, part: 'major' | 'minor' | 'patch'): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (match === null) return TEMPLATE_INITIAL_VERSION
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (part === 'major') return `${major + 1}.0.0`
  if (part === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/**
 * `git init` plus one initial commit in a directory.
 *
 * Uses a local identity when git has none configured: a fresh VPS often has no
 * `user.email`, and `git commit` would otherwise fail with an opaque error. The
 * local identity is scoped to this repository via `-c`, so the machine's global
 * configuration is not touched.
 *
 * @param root - directory to initialise.
 * @param title - template title, used in the commit message.
 * @returns undefined on success, or why it failed.
 */
async function initialiseRepository(root: string, title: string): Promise<string | undefined> {
  const run = (args: string[]): Promise<{ stdout: string; stderr: string }> =>
    run2('git', args, { cwd: root, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }) as Promise<{
      stdout: string
      stderr: string
    }>
  try {
    await run(['init', '--initial-branch=main'])
    await run(['add', '--all'])
    await run([
      '-c',
      'user.name=DSH Project Manager',
      '-c',
      'user.email=project-manager@localhost',
      'commit',
      '-m',
      `chore: scaffold ${title} project template`,
    ])
    return undefined
  } catch (error) {
    const detail = error as { stderr?: string; message?: string; code?: string }
    if (detail.code === 'ENOENT') return 'the git command is not installed on this host'
    const line = (detail.stderr ?? detail.message ?? 'git failed').trim().split('\n').filter(Boolean).at(-1)
    return `git could not initialise the repository: ${line ?? 'unknown error'}`
  }
}
