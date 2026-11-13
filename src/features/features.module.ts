/**
 * features — module.
 * Split out of features.ts by the module-structure refactor.
 */
import { execFile } from 'node:child_process'
import { existsSync, copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ProjectDatabase } from '../db/index.ts'
import type { FeatureWorkspace, MergeReport } from './features.interface.ts'

const run = promisify(execFile)
/** Failure with a code the UI can branch on. */
export class FeatureError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'FeatureError'
  }
}
/** Run git in a directory and return stdout. */
async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer: 8 * 1024 * 1024 })
    return stdout.trim()
  } catch (error) {
    const detail = error as { stderr?: string; message?: string }
    throw new FeatureError('git-failed', detail.stderr?.trim() || detail.message || 'git failed')
  }
}
/** Whether a directory is inside a git work tree. */
export async function isGitRepository(dir: string): Promise<boolean> {
  try {
    await git(dir, ['rev-parse', '--is-inside-work-tree'])
    return true
  } catch {
    return false
  }
}
/**
 * Create a worktree and database for a feature.
 *
 * The worktree lives beside the project (not inside it) so `git status` in the
 * project stays clean and a recursive scan cannot wander into a second checkout.
 * @param projectRoot - the project directory.
 * @param slug - feature slug, also the branch name suffix.
 * @param base - commit-ish to branch from; defaults to HEAD.
 */
export async function createFeatureWorkspace(
  projectRoot: string,
  slug: string,
  base = 'HEAD',
): Promise<FeatureWorkspace> {
  if (!(await isGitRepository(projectRoot))) {
    throw new FeatureError(
      'not-a-repository',
      'This project directory is not a git repository. Initialise one before creating features.',
    )
  }

  const branch = `feature/${slug}`
  const existing = await git(projectRoot, ['branch', '--list', branch])
  if (existing.length > 0) {
    throw new FeatureError('branch-exists', `branch ${branch} already exists`)
  }

  const worktreeRoot = join(projectRoot, '.dsh_project', 'worktrees')
  mkdirSync(worktreeRoot, { recursive: true })
  const path = join(worktreeRoot, slug)
  if (existsSync(path)) throw new FeatureError('path-exists', `${path} already exists`)

  const baseCommit = await git(projectRoot, ['rev-parse', base])
  await git(projectRoot, ['worktree', 'add', '-b', branch, path, baseCommit])

  // The feature database starts as a copy of the project's current state so the
  // board and documents are available offline; merge later takes the diff.
  const featureDbPath = join(projectRoot, 'features', `${slug}.db`)
  const projectDb = join(projectRoot, '.dsh_project', 'project.db')
  if (existsSync(projectDb) && !existsSync(featureDbPath)) {
    copyFileSync(projectDb, featureDbPath)
    // WAL sidecars are not copied by design: the copy is a snapshot, and a
    // stale -wal would make SQLite replay journals that do not belong to it.
  }

  return { path, branch, dbPath: featureDbPath }
}
/** Remove a worktree, keeping the branch and its commits. */
export async function removeFeatureWorkspace(projectRoot: string, slug: string): Promise<void> {
  const path = join(projectRoot, '.dsh_project', 'worktrees', slug)
  if (!existsSync(path)) return
  await git(projectRoot, ['worktree', 'remove', path])
}
/**
 * Merge a feature database into the project database.
 *
 * Idempotent: `merge_log.last_event` bounds the event replay, and item inserts
 * use `INSERT OR IGNORE` on their preserved ids.
 * @param projectRoot - project directory.
 * @param featureId - feature row id in the project database.
 * @param slug - feature slug, locating the feature database.
 */
export function mergeFeature(
  projectRoot: string,
  featureId: string,
  slug: string,
): MergeReport {
  const featureDbPath = join(projectRoot, 'features', `${slug}.db`)
  if (!existsSync(featureDbPath)) {
    throw new FeatureError('no-feature-database', `no database at ${featureDbPath}`)
  }

  const project = new ProjectDatabase(join(projectRoot, '.dsh_project', 'project.db'))
  const feature = new ProjectDatabase(featureDbPath)
  const byColumn: Record<string, number> = {}
  let itemsAdded = 0
  let eventsAdded = 0

  try {
    const since = project.lastMergedEvent(featureId)

    // Work items: preserve ids so assignments and events keep pointing at them.
    for (const item of feature.listWorkItems()) {
      if (project.importWorkItem(item, featureId)) {
        itemsAdded += 1
        byColumn[item.status] = (byColumn[item.status] ?? 0) + 1
      }
    }

    // Events: replay beyond the last merged id, tagged with their origin.
    let highest = since
    for (const event of feature.eventsSince(since)) {
      project.importEvent(event, `feature:${slug}`)
      eventsAdded += 1
      highest = Math.max(highest, event.id)
    }

    project.recordMerge(featureId, highest, itemsAdded, eventsAdded)
    project.updateFeature(featureId, { status: 'merged', mergedAt: Date.now() })
    project.recordEvent('feature', featureId, 'merged', undefined, { itemsAdded, eventsAdded })
  } finally {
    project.close()
    feature.close()
  }

  return { featureId, itemsAdded, eventsAdded, byColumn }
}