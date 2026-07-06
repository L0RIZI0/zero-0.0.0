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
 * Read-only: re-reads on `dataVersion` and never mutates. Recurrence occurrences
 * (`seriesId != null`) are materialized timeline instances, not structural nodes,
 * so they're excluded to keep the tree the true containment skeleton. Renders
 * nothing in production. Mirrors the §3 inspector's chrome/style.
 */
type Row = { entity: Entity; depth: number }

function buildRows(): Row[] {
  // Group every structural entity under its origin parent, preserving insertion
  // (creation) order — the same order `entities` already holds.
  const byParent = new Map<string | null, Entity[]>()
  for (const e of entities) {
    if (e.seriesId != null) continue // skip recurrence occurrences
    const list = byParent.get(e.parentId)
    if (list) list.push(e)
    else byParent.set(e.parentId, [e])
  }

  const rows: Row[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const e of byParent.get(parentId) ?? []) {
      rows.push({ entity: e, depth })
      walk(e.id, depth + 1)
    }
  }
  walk(null, 0) // roots = the parentId:null nodes (the Soul)
  return rows
}

export function HierarchyInspector() {
  const { hierarchy: visible } = useDebugView()
  // Re-read the tree whenever entity data mutates (create / delete / re-parent).
  const { dataVersion } = useZeroNav()
  void dataVersion

  if (process.env.NODE_ENV === "production" || !visible) return null

  const rows = buildRows()

  return (
    <div
      className="fixed left-3 top-3 z-[9999] flex max-h-[80vh] w-80 select-none flex-col overflow-hidden rounded-md border border-border bg-card/90 font-mono text-xs text-card-foreground shadow-lg backdrop-blur"
      role="status"
      aria-label="Hierarchy inspector"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-bold">{"Hierarchy · root → leaves"}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">{rows.length} nodes</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <ul className="flex flex-col gap-0.5">
          {rows.map(({ entity, depth }) => {
            const closed = isClosed(entity)
            const cancelled = !!entity.cancelled
            return (
              <li
                key={entity.id}
                className="flex items-center gap-1.5 whitespace-nowrap leading-none"
                style={{ paddingLeft: depth * 14 }}
              >
                {/* Depth guide: a faint tick so nesting reads at a glance. */}
                {depth > 0 && <span className="text-muted-foreground/40" aria-hidden>{"·"}</span>}
                <span className="shrink-0 text-foreground">
                  <NodeGlyph
                    kind={entity.kind}
                    filled={closed}
                    struck={cancelled}
                    className="h-3.5 w-3.5"
                    strokeWidth={1.75}
                  />
                </span>
                <span className={`truncate ${cancelled ? "text-muted-foreground line-through" : ""}`} title={entity.title}>
                  {entity.title}
                </span>
                <span className="ml-auto shrink-0 pl-2 text-[9px] uppercase tracking-wide text-muted-foreground/70">
                  {NODE_KIND_META[entity.kind].label}
                </span>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
        <span className="text-[10px] text-muted-foreground">{"§4 hide"}</span>
        <span className="text-[10px] text-muted-foreground">{"origin tree"}</span>
      </div>
    </div>
  )
}
