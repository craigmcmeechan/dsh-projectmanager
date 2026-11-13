/**
 * ProjectDetail — module.
 * Split out of client/ProjectDetail.tsx by the module-structure refactor.
 */
export const TABS = ['Overview', 'Technologies', 'Infrastructure', 'Teams', 'Features', 'Documentation'] as const
/** Defaults worth asking for up front, with hints that explain the consequence. */
export const DEFAULT_FIELDS: Array<{ key: string; label: string; placeholder: string; hint: string }> = [
  { key: 'language', label: 'Primary language', placeholder: 'TypeScript', hint: 'The language most code is written in.' },
  { key: 'runtime', label: 'Runtime', placeholder: 'Node 24', hint: 'What the code runs on.' },
  { key: 'licence', label: 'Licence', placeholder: 'MIT', hint: 'Applied to new files and the repository.' },
  { key: 'branchModel', label: 'Branch model', placeholder: 'main + feature branches', hint: 'How work reaches the main branch.' },
  { key: 'reviewPolicy', label: 'Review policy', placeholder: 'One approving review required', hint: 'What must happen before a merge.' },
  { key: 'testPolicy', label: 'Testing policy', placeholder: 'Unit tests for every new module', hint: 'The minimum evidence a change works.' },
  { key: 'commitStyle', label: 'Commit style', placeholder: 'Conventional Commits', hint: 'Format for commit messages.' },
]
/** Roles a team can be made of, with what each is responsible for. */
export const ROLES: Array<{ role: string; label: string; responsibility: string }> = [
  { role: 'product', label: 'Product', responsibility: 'Defines the requirement and accepts the result.' },
  { role: 'architect', label: 'Architect', responsibility: 'Owns structure, interfaces, and technical risk.' },
  { role: 'engineer', label: 'Engineer', responsibility: 'Implements the feature and its tests.' },
  { role: 'designer', label: 'Designer', responsibility: 'Owns the interface and interaction design.' },
  { role: 'qa', label: 'QA', responsibility: 'Verifies against acceptance criteria and files defects.' },
  { role: 'reviewer', label: 'Reviewer', responsibility: 'Reviews for correctness, clarity, and consistency.' },
]