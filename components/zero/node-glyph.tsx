"use client"

import { cn } from "@/lib/utils"

/** The three node kinds Zero can create, each with its own silhouette. */
export type NodeKind = "task" | "space" | "event"

export const NODE_KIND_META: Record<
  NodeKind,
  { label: string; description: string }
> = {
  task: { label: "Task", description: "A single thing to do" },
  space: { label: "Space", description: "A context that holds things" },
  event: { label: "Event", description: "Something at a point in time" },
}

/**
 * A crisp geometric silhouette for a node kind:
 *  - task  → square
 *  - space → hexagon
 *  - event → triangle pointing up
 * Rendered as an inline SVG so it scales and inherits color via `currentColor`.
 */
export function NodeGlyph({
  kind,
  className,
  filled = false,
  strokeWidth = 1.75,
}: {
  kind: NodeKind
  className?: string
  filled?: boolean
  strokeWidth?: number
}) {
  const common = {
    fill: filled ? "currentColor" : "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinejoin: "miter" as const,
    strokeLinecap: "square" as const,
    vectorEffect: "non-scaling-stroke" as const,
  }

  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-full w-full", className)}
      aria-hidden="true"
    >
      {kind === "task" && <rect x="4.5" y="4.5" width="15" height="15" {...common} />}
      {/* Hexagon scaled up ~8% from center (12,12): a regular hexagon reads
          optically smaller than the square/triangle at equal bounds, so this
          nudge harmonizes their perceived size. */}
      {kind === "space" && (
        <polygon points="12,2.3 20.6,7.1 20.6,16.9 12,21.7 3.4,16.9 3.4,7.1" {...common} />
      )}
      {kind === "event" && <polygon points="12,4 20.5,19 3.5,19" {...common} />}
    </svg>
  )
}
