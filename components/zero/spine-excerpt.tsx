"use client"

import { useRef } from "react"
import { AnimatePresence, motion, type Transition } from "motion/react"
import { NodeGlyph, type NodeKind } from "./node-glyph"
import {
  getOpenTaskCount,
  getDoneTaskCount,
  getClosedTaskCount,
  getCancelledTaskCount,
  getOpenEventCount,
  getCancelledEventCount,
  getCancelledInstantCount,
} from "@/lib/zero/data"
import { useZeroNav } from "@/lib/zero/nav-store"
import { cn } from "@/lib/utils"

/**
 * The spine EXCERPT — a compact summary of what an entity holds, shown at the TOP of a
 * side spine (currently the left/Resources spine). It surfaces a set of MUTUALLY
 * EXCLUSIVE tallies (matching the glyph states) so the counts read consistently
 * across the app:
 *
 *   • open tasks       — outline square        + incomplete, un-closed child tasks
 *   • done tasks       — outline square + check + done-but-not-closed child tasks
 *   • closed tasks     — filled square          + closed-but-not-cancelled child tasks
 *   • cancelled tasks  — struck-through square  + cancelled child tasks
 *   • open events      — outline triangle       + un-closed child events
 *   • cancelled events — struck-through triangle + cancelled child events
 *   • cancelled instants — struck-through triangle (inverted) + cancelled child instants
 *
 * Events show only their OPEN and CANCELLED states; instants show only CANCELLED —
 * the rest are intentionally omitted (this list is being tuned).
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

  const openTasks = getOpenTaskCount(entityId)
  const doneTasks = getDoneTaskCount(entityId)
  const closedTasks = getClosedTaskCount(entityId)
  const cancelledTasks = getCancelledTaskCount(entityId)
  const openEvents = getOpenEventCount(entityId)
  const cancelledEvents = getCancelledEventCount(entityId)
  const cancelledInstants = getCancelledInstantCount(entityId)

  // Build the active tallies as a keyed list so AnimatePresence can animate each
  // counter in/out individually as its count crosses zero. Order is stable — task
  // states first (open → done → closed → cancelled), then events (open → cancelled),
  // then cancelled instants — so counters slot into consistent vertical positions.
  const allCounters: {
    id: string
    kind: NodeKind
    count: number
    filled: boolean
    checked: boolean
    struck: boolean
  }[] = [
    { id: "task-open", kind: "task", count: openTasks, filled: false, checked: false, struck: false },
    { id: "task-done", kind: "task", count: doneTasks, filled: false, checked: true, struck: false },
    { id: "task-closed", kind: "task", count: closedTasks, filled: true, checked: false, struck: false },
    { id: "task-cancelled", kind: "task", count: cancelledTasks, filled: false, checked: false, struck: true },
    { id: "event-open", kind: "moment", count: openEvents, filled: false, checked: false, struck: false },
    { id: "event-cancelled", kind: "moment", count: cancelledEvents, filled: false, checked: false, struck: true },
    { id: "instant-cancelled", kind: "instant", count: cancelledInstants, filled: false, checked: false, struck: true },
  ]
  const counters = allCounters.filter((c) => c.count > 0)

  return (
    <div className="flex flex-col items-center overflow-hidden">
      <AnimatePresence initial={false}>
        {counters.map((c) => (
          <Counter
            key={c.id}
            count={c.count}
            kind={c.kind}
            filled={c.filled}
            checked={c.checked}
            struck={c.struck}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}

/**
 * One tally — glyph FIRST, then the number ("[glyph] n"). `filled` fills the glyph
 * (closed tasks); `checked` shows the done checkmark on an outline glyph (done tasks).
 * Enters/exits VERTICALLY (height + fade + slight y slide) so counters appearing or
 * disappearing from the stack animate rather than pop. The inter-row spacing is an
 * ANIMATED `marginBottom` (not a static `pb-2`) so it collapses TOGETHER with the
 * height on exit — otherwise the un-animated padding would linger until unmount and
 * make the remaining counters jump up by that gap at the end of the animation.
 */
function Counter({
  count,
  kind,
  filled = false,
  checked = false,
  struck = false,
}: {
  count: number
  kind: NodeKind
  filled?: boolean
  checked?: boolean
  struck?: boolean
}) {
  return (
    <motion.span
      layout
      initial={{ opacity: 0, height: 0, marginBottom: 0, y: -4 }}
      animate={{ opacity: 1, height: "auto", marginBottom: 8, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, y: -4 }}
      transition={COUNTER_TRANSITION}
      className={cn(
        // Opaque grey (see `--excerpt-ink`) rather than `text-muted-foreground/70`:
        // same visual tone, but no sub-1 opacity, so overlapping glyph strokes (the
        // checkmark crossing the square) no longer render a darker tip.
        "flex items-center gap-1 overflow-hidden text-[10px] leading-none text-excerpt-ink",
      )}
    >
      <span className="flex h-2.5 w-2.5 items-center justify-center">
        <NodeGlyph kind={kind} filled={filled} showCheck={checked} struck={struck} strokeWidth={1.5} />
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
    <span className="relative inline-grid h-2.5 items-center overflow-hidden font-medium leading-none tabular-nums">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          className="col-start-1 row-start-1 leading-none"
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
