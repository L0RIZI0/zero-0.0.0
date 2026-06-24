"use client"

import { cn } from "@/lib/utils"

/** The node kinds Zero can create, each with its own silhouette. */
export type NodeKind = "task" | "space" | "event" | "instant" | "resource" | "community"

export const NODE_KIND_META: Record<
  NodeKind,
  { label: string; description: string }
> = {
  task: { label: "Task", description: "A single thing to do" },
  space: { label: "Space", description: "A context that holds things" },
  resource: { label: "Resource", description: "A reference, tool, or material to draw on" },
  event: { label: "Event", description: "Something over a span of time" },
  instant: { label: "Instant", description: "Something at a precise moment" },
  community: { label: "Community", description: "A place to gather people and discussions" },
}

/**
 * A crisp geometric silhouette for a node kind:
 *  - task      → square
 *  - space     → hexagon
 *  - resource  → square rotated 45° (a diamond)
 *  - event     → triangle pointing up
 *  - instant   → triangle pointing down (a single point in time)
 *  - community → regular pentagon (a gathering)
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
      {/* Resource — the task square rotated 45° into a diamond. Its diagonal
          spans the same 15px as the square's side, so the two read as the same
          mark in two orientations. */}
      {kind === "resource" && <polygon points="12,3.4 20.6,12 12,20.6 3.4,12" {...common} />}
      {kind === "event" && <polygon points="12,4 20.5,19 3.5,19" {...common} />}
      {/* Instant — the event triangle mirrored to point downward, marking a
          single point in time rather than a span. */}
      {kind === "instant" && <polygon points="3.5,5 20.5,5 12,20" {...common} />}
      {/* Community — a regular pentagon (point up), centered at (12,12) with a
          ~10px circumradius: a gathering of people/discussions. */}
      {kind === "community" && (
        <polygon points="12,2 21.5,8.9 17.9,20.1 6.1,20.1 2.5,8.9" {...common} />
      )}
    </svg>
  )
}
