"use client"

import { NodeGlyph } from "./node-glyph"
import { getOpenTaskCount, getDoneTaskCount, getClosedTaskCount } from "@/lib/zero/data"
import { useZeroNav } from "@/lib/zero/nav-store"
import { cn } from "@/lib/utils"

/**
 * The spine EXCERPT — a compact summary of what an entity holds, shown at the TOP of a
 * side spine (currently the left/Resources spine). It surfaces the three MUTUALLY
 * EXCLUSIVE task tallies (matching the glyph states) so the counts read consistently
 * across the app:
 *
 *   • open tasks   — outline glyph      + count of incomplete, un-closed child tasks
 *   • done tasks   — outline + check    + count of done-but-not-closed child tasks
 *   • closed tasks — filled glyph       + count of closed (archived) child tasks
 *
 * All come from the SAME `getChildren` listing as the do-list/dock (origin + tagged),
 * so the excerpt reflects whatever is browsable inside the entity. Shown for EVERY
 * entity (leaf or ancestor). Each counter mounts only when its count > 0, so an empty
 * entity shows nothing (matching the dock-card convention of hiding zero tallies).
 *
 * Presentational + read-only: it re-reads on `dataVersion` and never mutates state.
 */
export function SpineExcerpt({ entityId }: { entityId: string }) {
  // Re-read the tallies whenever data mutates (task toggled, child added, etc.).
  const { dataVersion } = useZeroNav()
  void dataVersion

  const open = getOpenTaskCount(entityId)
  const done = getDoneTaskCount(entityId)
  const closed = getClosedTaskCount(entityId)

  if (open === 0 && done === 0 && closed === 0) return null

  return (
    <div className="flex flex-col items-center gap-2">
      {open > 0 && <Counter count={open} kind="task" />}
      {done > 0 && <Counter count={done} kind="task" checked />}
      {closed > 0 && <Counter count={closed} kind="task" filled />}
    </div>
  )
}

/**
 * One tally — glyph FIRST, then the number ("[glyph] n"). `filled` fills the glyph
 * (closed tasks); `checked` shows the done checkmark on an outline glyph (done tasks).
 */
function Counter({
  count,
  kind,
  filled = false,
  checked = false,
}: {
  count: number
  kind: "task"
  filled?: boolean
  checked?: boolean
}) {
  return (
    <span className={cn("flex items-center gap-1 text-[10px] text-muted-foreground/70")}>
      <span className="flex h-2.5 w-2.5 items-center justify-center">
        <NodeGlyph kind={kind} filled={filled} showCheck={checked} strokeWidth={1.5} />
      </span>
      <span className="font-medium tabular-nums">{count}</span>
    </span>
  )
}
