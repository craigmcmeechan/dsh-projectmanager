/**
 * PipelineGraph — component.
 * Split out of client/PipelineGraph.tsx by the module-structure refactor.
 */
import type { WorkflowStage } from '../profile-api/index.ts'
import { STATE_COLORS, NODE_W, NODE_H, GAP_X, MARGIN } from './PipelineGraph.module.ts'
import type { PipelineGraphProps } from './PipelineGraph.interface.ts'

/**
 * Render the workflow as a left-to-right node graph.
 *
 * Parallel stages are drawn on a second row with a fork and join, because a
 * parallel stage runs *during* its neighbour rather than after it — drawing them
 * in one line would misrepresent the order.
 * @param props - stages, their states, and selection.
 */
export function PipelineGraph({ stages, states, onSelect, selectedId }: PipelineGraphProps) {
  if (stages.length === 0) {
    return (
      <p style={{ fontSize: 13, opacity: 0.7, margin: 0 }}>
        No stages yet. Add one to shape the pipeline.
      </p>
    )
  }

  // Lay out in two lanes: the main line and a parallel lane beneath it.
  interface Placed {
    stage: WorkflowStage
    x: number
    y: number
    lane: 0 | 1
  }

  const placed: Placed[] = []
  let laneCursor = 0
  let parallelOpen = false

  for (const stage of stages) {
    if (stage.parallel) {
      // Parallel stages sit on the lower lane at the current x, and the upper
      // lane advances past them so the join is visible.
      placed.push({ stage, x: MARGIN + laneCursor * (NODE_W + GAP_X), y: MARGIN + NODE_H + 26, lane: 1 })
      parallelOpen = true
      laneCursor += 1
    } else {
      placed.push({ stage, x: MARGIN + laneCursor * (NODE_W + GAP_X), y: MARGIN, lane: 0 })
      laneCursor += 1
      if (parallelOpen) parallelOpen = false
    }
  }

  const width = MARGIN * 2 + laneCursor * (NODE_W + GAP_X) - GAP_X
  const height = parallelOpen ? MARGIN * 2 + NODE_H * 2 + 26 : MARGIN * 2 + NODE_H

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <svg
        width={Math.max(width, 200)}
        height={height}
        role="img"
        aria-label={`Pipeline with ${stages.length} stages`}
        style={{ display: 'block' }}
      >
        {/* Connectors first, so nodes paint over them. */}
        {placed.map((entry, index) => {
          const next = placed[index + 1]
          if (next === undefined) return null
          const x1 = entry.x + NODE_W
          const y1 = entry.y + NODE_H / 2
          const x2 = next.x
          const y2 = next.y + NODE_H / 2
          // A lane change draws an elbow; a straight run draws a line.
          const path =
            y1 === y2
              ? `M ${x1} ${y1} L ${x2} ${y2}`
              : `M ${x1} ${y1} C ${x1 + 20} ${y1}, ${x2 - 20} ${y2}, ${x2} ${y2}`
          return (
            <path
              key={`edge-${entry.stage.id}`}
              d={path}
              fill="none"
              stroke="var(--dsw-alias-border-l4, #cbd5e1)"
              strokeWidth={1.5}
              markerEnd="url(#pm-arrow)"
            />
          )
        })}

        <defs>
          <marker id="pm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--dsw-alias-border-l4, #cbd5e1)" />
          </marker>
        </defs>

        {placed.map((entry) => {
          const state = states?.[entry.stage.id] ?? 'pending'
          const palette = STATE_COLORS[state]
          const selected = entry.stage.id === selectedId
          const label = entry.stage.name || entry.stage.kind
          return (
            <g
              key={entry.stage.id}
              transform={`translate(${entry.x}, ${entry.y})`}
              onClick={() => onSelect?.(entry.stage.id)}
              style={{ cursor: onSelect === undefined ? 'default' : 'pointer' }}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={palette.fill}
                stroke={selected ? 'var(--dsw-alias-interactive-bg-active, #2563eb)' : palette.stroke}
                strokeWidth={selected ? 2.5 : 1.5}
              />
              <text x={10} y={20} fontSize={12} fontWeight={600} fill={palette.text}>
                {label.length > 15 ? `${label.slice(0, 14)}…` : label}
              </text>
              <text x={10} y={36} fontSize={10} fill={palette.text} opacity={0.75}>
                {entry.stage.role || 'whole team'}
                {state === 'pending' ? '' : ` · ${state}`}
              </text>
            </g>
          )
        })}
      </svg>

      {stages.some((stage) => stage.parallel) ? (
        <p style={{ fontSize: 11, opacity: 0.6, margin: '4px 0 0' }}>
          Lower lane runs in parallel with the step above it.
        </p>
      ) : null}
    </div>
  )
}