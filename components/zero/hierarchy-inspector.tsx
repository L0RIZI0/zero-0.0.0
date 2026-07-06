"use client"

import { useZeroNav } from "@/lib/zero/nav-store"
import { useDebugView } from "@/lib/zero/debug-view"
import { entities } from "@/lib/zero/data"
import { isClosed } from "@/lib/zero/kinds"
import { NODE_KIND_META, NodeGlyph } from "./node-glyph"
import type { Entity } from "@/lib/zero/types"

/**
 * Dev-only HIERARCHY inspector (`§ 4`).
 *
 * Renders the WHOLE containment tree of the logged user — from the root (the Soul,
 * `parentId: null`) down through the Individual (entity0 = home) and every space to
 * all the leaves (tasks / moments / instants). Unlike the do-list's `getChildren`
 * (which hides the structural soul/individual kinds), this walks the raw ORIGIN
 * tree via `parentId` so the identity triad and every leaf are visible — it is a
 * debug X-ray of the real structure, not a browsable listing.
 *
 * LAYOUT — a left→right node-edge tree in the spirit of Obsidian's graph: depth maps
 * to an X column, and each parent's children are stacked as a VERTICAL column to its
 * right (so a branch of leaves reads as one tidy columned list), linked by smooth
 * curved connectors. The parent is centered vertically against its child block.
 *
 * Read-only: re-reads on `dataVersion` and never mutates. Recurrence occurrences
 * (`seriesId != null`) are materialized timeline instances, not structural nodes,
 * so they're excluded to keep the tree the true containment skeleton. Renders
 * nothing in production. Mirrors the §3 inspector's chrome/style.
 */

const ROW_H = 30 // vertical slot per leaf (also the min gap between siblings)
const COL_W = 184 // horizontal distance between depth columns
const NODE_W = 148 // width of a node pill (label truncates within this)
const PAD = 16 // inner padding around the whole diagram

type PositionedNode = { entity: Entity; x: number; y: number; depth: number; hasChildren: boolean }
type Edge = { id: string; x1: number; y1: number; x2: number; y2: number }

type Layout = { nodes: PositionedNode[]; edges: Edge[]; width: number; height: number }

function buildLayout(): Layout {
  // Group every structural entity under its origin parent, preserving insertion
  // (creation) order — the same order `entities` already holds.
  const byParent = new Map<string | null, Entity[]>()
  for (const e of entities) {
    if (e.seriesId != null) continue // skip recurrence occurrences
    const list = byParent.get(e.parentId)
    if (list) list.push(e)
    else byParent.set(e.parentId, [e])
  }

  const nodes: PositionedNode[] = []
  const edges: Edge[] = []
  let cursorY = PAD // running vertical position for the next leaf slot
  let maxDepth = 0

  // Returns the node's center Y. Leaves consume one ROW_H slot; parents center
  // on the span of their children.
  const place = (entity: Entity, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth)
    const x = PAD + depth * COL_W
    const children = byParent.get(entity.id) ?? []

    let y: number
    if (children.length === 0) {
      y = cursorY + ROW_H / 2
      cursorY += ROW_H
    } else {
      const childYs = children.map((c) => place(c, depth + 1))
      y = (childYs[0] + childYs[childYs.length - 1]) / 2
      // Connectors run from this node's right edge to each child's left edge.
      const x1 = x + NODE_W
      const x2 = PAD + (depth + 1) * COL_W
      for (let i = 0; i < children.length; i++) {
        edges.push({ id: `${entity.id}->${children[i].id}`, x1, y1: y, x2, y2: childYs[i] })
      }
    }

    nodes.push({ entity, x, y, depth, hasChildren: children.length > 0 })
    return y
  }

  for (const root of byParent.get(null) ?? []) place(root, 0)

  const width = PAD * 2 + maxDepth * COL_W + NODE_W
  const height = Math.max(cursorY + PAD, ROW_H + PAD * 2)
  return { nodes, edges, width, height }
}

/** Smooth Obsidian-style S-curve between two points with horizontal tangents. */
function edgePath(e: Edge): string {
  const midX = (e.x1 + e.x2) / 2
  return `M ${e.x1} ${e.y1} C ${midX} ${e.y1}, ${midX} ${e.y2}, ${e.x2} ${e.y2}`
}

export function HierarchyInspector() {
  const { hierarchy: visible } = useDebugView()
  // Re-read the tree whenever entity data mutates (create / delete / re-parent).
  const { dataVersion } = useZeroNav()
  void dataVersion

  if (process.env.NODE_ENV === "production" || !visible) return null

  const { nodes, edges, width, height } = buildLayout()

  return (
    <div
      className="fixed left-3 top-3 z-[9999] flex max-h-[85vh] max-w-[92vw] select-none flex-col overflow-hidden rounded-md border border-border bg-card/90 font-mono text-xs text-card-foreground shadow-lg backdrop-blur"
      role="status"
      aria-label="Hierarchy inspector"
    >
      <div className="flex items-center justify-between gap-6 border-b border-border px-3 py-2">
        <span className="font-bold">{"Hierarchy · root → leaves"}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">{nodes.length} nodes</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ width, height }}>
          {/* Edges behind the nodes. */}
          <svg
            className="pointer-events-none absolute inset-0"
            width={width}
            height={height}
            aria-hidden
          >
            {edges.map((e) => (
              <path
                key={e.id}
                d={edgePath(e)}
                fill="none"
                stroke="var(--border)"
                strokeWidth={1.5}
              />
            ))}
          </svg>

          {/* Node pills. */}
          {nodes.map(({ entity, x, y, hasChildren }) => {
            const closed = isClosed(entity)
            const cancelled = !!entity.cancelled
            return (
              <div
                key={entity.id}
                className="absolute flex items-center gap-1.5 rounded-md border border-border bg-background/85 px-2 py-1 leading-none shadow-sm"
                style={{ left: x, top: y, width: NODE_W, transform: "translateY(-50%)" }}
                title={`${entity.title} · ${NODE_KIND_META[entity.kind].label}`}
              >
                <span className="shrink-0 text-foreground">
                  <NodeGlyph
                    kind={entity.kind}
                    filled={closed}
                    struck={cancelled}
                    className="h-3.5 w-3.5"
                    strokeWidth={1.75}
                  />
                </span>
                <span
                  className={`truncate ${cancelled ? "text-muted-foreground line-through" : hasChildren ? "font-semibold text-foreground" : "text-card-foreground"}`}
                >
                  {entity.title}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
        <span className="text-[10px] text-muted-foreground">{"§4 hide"}</span>
        <span className="text-[10px] text-muted-foreground">{"origin tree"}</span>
      </div>
    </div>
  )
}
