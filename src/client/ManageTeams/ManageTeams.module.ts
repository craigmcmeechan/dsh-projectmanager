/**
 * ManageTeams — module.
 * Split out of client/ManageTeams.tsx by the module-structure refactor.
 */
/** Roles and the capabilities each usually holds. */
export const ROLES: Array<{ role: string; label: string; capabilities: string[] }> = [
  { role: 'product', label: 'Product', capabilities: ['plan', 'accept', 'document'] },
  { role: 'architect', label: 'Architect', capabilities: ['plan', 'design', 'review'] },
  { role: 'engineer', label: 'Engineer', capabilities: ['implement', 'document'] },
  { role: 'designer', label: 'Designer', capabilities: ['design', 'document'] },
  { role: 'qa', label: 'QA', capabilities: ['test', 'review'] },
  { role: 'reviewer', label: 'Reviewer', capabilities: ['review', 'accept'] },
]
/** Everything a member can be granted. */
export const CAPABILITIES = ['plan', 'design', 'implement', 'review', 'test', 'accept', 'document']
/** Stage kinds, in the order a full pipeline runs them. */
export const STAGE_KINDS = [
  'requirement',
  'prd',
  'design',
  'architecture',
  'techspec',
  'development',
  'qa',
  'acceptance',
]
/** Pipeline tiers, from lightest to fullest. */
export const TIERS: Array<{ tier: string; label: string; description: string }> = [
  { tier: 'patch', label: 'patch', description: 'Mechanical change: implement and verify.' },
  { tier: 'lite', label: 'lite', description: 'Small feature: requirement, build, verify.' },
  { tier: 'medium', label: 'medium', description: 'Adds PRD and tech spec.' },
  { tier: 'full', label: 'full', description: 'The whole pipeline, including design and acceptance.' },
]