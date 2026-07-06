"use client"

import { useRef } from "react"
import { AnimatePresence, motion, type Transition } from "motion/react"
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
/** Framer transition for a counter entering/leaving the vertical stack. */
const COUNTER_TRANSITION: Transition = { duration: 0.26, ease: [0.22, 1, 0.36, 1] }

export function SpineExcerpt({ entityId }: { entityId: string }) {
  // Re-read the tallies whenever data mutates (task toggled, child added, etc.).
  const { dataVersion } = useZeroNav()
  void dataVersion

  const open = getOpenTaskCount(entityId)
  const done = getDoneTaskCount(entityId)
  const closed = getClosedTaskCount(entityId)

  // Build the active tallies as a keyed list so AnimatePresence can animate each
  // counter in/out individually as its count crosses zero. Order is stable
  // (open → done → closed) so counters slot into a consistent vertical position.
  const counters = [
    { id: "open", count: open, filled: false, checked: false },
    { id: "done", count: done, filled: false, checked: true },
    { id: "closed", count: closed, filled: true, checked: false },
  ].filter((c) => c.count > 0)

  return (
    <div className="flex flex-col items-center overflow-hidden">
      <AnimatePresence initial={false}>
        {counters.map((c) => (
          <Counter key={c.id} count={c.count} kind="task" filled={c.filled} checked={c.checked} />
        ))}
      </AnimatePresence>
    </div>
  )
}

/**
 * One tally — glyph FIRST, then the number ("[glyph] n"). `filled` fills the glyph
 * (closed tasks); `checked` shows the done checkmark on an outline glyph (done tasks).
 * Enters/exits VERTICALLY (height + fade + slight y slide) so counters appearing or
 * disappearing from the stack animate rather than pop. `pb-2` provides the inter-row
 * spacing AS PART OF the animated height, so the gap collapses cleanly on exit.
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
    <motion.span
      layout
      initial={{ opacity: 0, height: 0, y: -4 }}
      animate={{ opacity: 1, height: "auto", y: 0 }}
      exit={{ opacity: 0, height: 0, y: -4 }}
      transition={COUNTER_TRANSITION}
      className={cn("flex items-center gap-1 overflow-hidden pb-2 text-[10px] text-muted-foreground/70")}
    >
      <span className="flex h-2.5 w-2.5 items-center justify-center">
        <NodeGlyph kind={kind} filled={filled} showCheck={checked} strokeWidth={1.5} />
      </span>
      <DigitRoll value={count} />
    </motion.span>
  )
}

/** Framer transition for the digit roll (a touch snappier than the row enter/exit). */
const DIGIT_TRANSITION: Transition = { duration: 0.22, ease: [0.22, 1, 0.36, 1] }

/**
 * A single number that ROLLS when it changes: on INCREMENT the new value fades up
 * from below while the old one exits upward; on DECREMENT the direction reverses
 * (new fades down from above, old exits downward). Direction is derived from the
 * previous render's value. Uses a fixed-height clipped box so the vertical slide is
 * masked to just the digit's line.
 */
function DigitRoll({ value }: { value: number }) {
  const prev = useRef(value)
  const dir = value > prev.current ? 1 : value < prev.current ? -1 : 0
  prev.current = value
  // dir === 1 (increment): enter from below (+y), exit upward (−y).
  // dir === -1 (decrement): enter from above (−y), exit downward (+y).
  const enterFrom = dir >= 0 ? 6 : -6
  const exitTo = dir >= 0 ? -6 : 6

  return (
    <span className="relative inline-grid h-[1.2em] items-center overflow-hidden font-medium tabular-nums">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          className="col-start-1 row-start-1"
          initial={{ opacity: 0, y: enterFrom }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: exitTo }}
          transition={DIGIT_TRANSITION}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
