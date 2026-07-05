"use client"

import { NodeGlyph } from "./node-glyph"
import { getOpenTaskCount, getDoneTaskCount } from "@/lib/zero/data"
import { useZeroNav } from "@/lib/zero/nav-store"
import { cn } from "@/lib/utils"

/**
 * The spine EXCERPT — a compact summary of what an entity holds, shown at the TOP of a
 * side spine (currently the left/Resources spine). It surfaces the same tallies used
 * elsewhere (dock cards, space rows) so the counts read consistently across the app:
 *
 *   • open tasks   — outline task glyph + count of incomplete child tasks
 *   • done tasks   — filled task glyph + count of completed child tasks
 *
 * All three come from the SAME `getChildren` listing as the do-list/dock (origin +
 * tagged), so the excerpt reflects whatever is browsable inside the entity — whether
 * those items live in the do-list or the dock. Shown for EVERY entity (leaf or
 * ancestor). Each counter mounts only when its count > 0, so an empty entity shows
 * nothing (matching the dock-card convention of hiding zero tallies).
 *
 * Presentational + read-only: it re-reads on `dataVersion` and never mutates state.
 */
export function SpineExcerpt({ entityId }: { entityId: string }) {
  // Re-read the tallies whenever data mutates (task toggled, child added, etc.).
  const { dataVersion } = useZeroNav()
  void dataVersion

  const open = getOpenTaskCount(entityId)
  const done = getDoneTaskCount(entityId)

  if (open === 0 && done === 0) return null

  return (
    <div className="flex flex-col items-center gap-2">
      {open > 0 && <Counter count={open} kind="task" />}
      {done > 0 && <Counter count={done} kind="task" filled />}
    </div>
  )
}

/** One glyph + number tally, styled to match the dock-card / row open-task counter. */
function Counter({
  count,
  kind,
  filled = false,
}: {
  count: number
  kind: "task"
  filled?: boolean
}) {
  return (
    <span className={cn("flex items-center gap-1 text-[10px] text-muted-foreground/70")}>
      <span className="font-medium tabular-nums">{count}</span>
      <span className="flex h-2.5 w-2.5 items-center justify-center">
        <NodeGlyph kind={kind} filled={filled} strokeWidth={1.5} />
      </span>
    </span>
  )
}
