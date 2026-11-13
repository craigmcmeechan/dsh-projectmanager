/**
 * stages — interface.
 * Split out of stages.ts by the module-structure refactor.
 */
/**
 * Stage prompts: what each role is told to do.
 *
 * Ported and adapted from a real multi-agent R&D pipeline (dsh-plugin-teamflow,
 * MIT). The structure that made it work is kept:
 *
 *   - every stage states its role and its single deliverable;
 *   - every stage ends in a **verdict line** a parser can read, not prose;
 *   - every stage names its exit criteria, so "done" is checkable rather than
 *     felt;
 *   - QA may reject and loop, but only a bounded number of times.
 *
 * Deliberately dropped: token metering, run journals, document archiving, and
 * the Chinese/English locale matrix. Those belong to that plugin's operational
 * concerns, not to the pipeline's shape.
 */

/** One stage's instruction set. */
export interface StagePrompt {
  /** The role the agent adopts. */
  role: string
  /** The one deliverable this stage produces. */
  deliverable: string
  /** What must be true before the stage counts as finished. */
  exitCriteria: string
  /** The instruction body, given to the agent running the stage. */
  prompt: string
}