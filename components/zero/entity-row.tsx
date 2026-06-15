"use client"

import { useMemo, useState } from "react"
import { motion } from "motion/react"
import { Check } from "lucide-react"
import { getOpenTaskCount, type ContextItem } from "@/lib/zero/data"
import type { TaskPriority } from "@/lib/zero/types"
import { useZeroNav, useRowSelection } from "@/lib/zero/nav-store"
import { MORPH_SOURCE_ATTR, MORPH_WHERE_ATTR } from "@/lib/zero/motion"
import { NodeGlyph } from "./node-glyph"
import { cn } from "@/lib/utils"

/** Shared leading glyph box, so every kind's silhouette reads at one size. */
const GLYPH_BOX = "flex h-4 w-4 shrink-0 items-center justify-center"

const priorityDot: Record<TaskPriority, string> = {
  high: "bg-accent",
  medium: "bg-foreground/40",
  low: "bg-foreground/20",
}

function fmtTime(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  const ampm = h >= 12 ? "pm" : "am"
  const hr = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, "0")}${ampm}`
}

/** A precise moment for an instant — always includes seconds. */
function fmtMoment(min: number, seconds: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  const ampm = h >= 12 ? "pm" : "am"
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:${String(m).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${ampm}`
}

/**
 * Trailing detail showing how many open (incomplete) DIRECT child tasks live
 * inside an entity — a number followed by the task square glyph (e.g. "4 ■").
 * Renders nothing when there are none.
 */
function OpenTaskCount({ entityId }: { entityId: string }) {
  const { dataVersion } = useZeroNav()
  const count = useMemo(() => getOpenTaskCount(entityId), [entityId, dataVersion])
  if (count === 0) return null
  return (
    <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground/70">
      <span className="font-medium tabular-nums">{count}</span>
      <span className="flex h-2.5 w-2.5 items-center justify-center">
        <NodeGlyph kind="task" strokeWidth={1.5} />
      </span>
    </span>
  )
}

/**
 * ONE row for ANY entity kind in the DO list — there are no per-kind row
 * components anymore. Everything is shared; `kind` only changes a few details:
 *
 *   - task    → leading glyph doubles as a completion toggle; trailing shows the
 *               due label + priority dot; title strikes through when done.
 *   - space   → a thin left accent strip; trailing shows the open-task count.
 *   - event   → trailing shows the open-task count + the time range.
 *   - instant → trailing shows the open-task count + the precise moment.
 *
 * The row is the morph SOURCE: it tags itself with `data-morph-source={id}` so
 * the opening window can measure its box and grow out of it (and shrink back
 * into it on close). Events/instants also exist on the timeline, so they add
 * `data-morph-where="row"` to disambiguate which copy was clicked.
 */
export function EntityRow({
  item,
  onContext,
}: {
  item: ContextItem
  onContext: (e: React.MouseEvent) => void
}) {
  const { open } = useZeroNav()
  const e = item.entity
  const kind = e.kind
  const isTask = kind === "task"
  const isSpace = kind === "space"
  const isTimed = kind === "event" || kind === "instant"
  const cancelled = !!e.cancelled
  const [done, setDone] = useState(!!e.completed)
  const { lift, hoverProps, ref } = useRowSelection("list", e.id)

  const accent = isSpace ? e.accent ?? "var(--muted-foreground)" : null
  const hasRange = typeof e.start === "number" && typeof e.end === "number"
  const hasMoment = typeof e.at === "number"

  // Timed entities live in two places at once (this row AND a timeline marker),
  // so opening from here records source "row" to morph from the right one.
  const openThis = () => open(e.id, isTimed ? "row" : undefined)

  return (
    <li>
      <motion.div
        ref={ref as React.Ref<HTMLDivElement>}
        {...{ [MORPH_SOURCE_ATTR]: e.id, ...(isTimed ? { [MORPH_WHERE_ATTR]: "row" } : {}) }}
        role="button"
        aria-label={`Open ${e.title}`}
        onClick={openThis}
        onContextMenu={onContext}
        {...hoverProps}
        style={{ borderRadius: 4 }}
        animate={{ scale: lift ? 1.02 : 1 }}
        className={cn(
          "group relative flex w-full cursor-pointer items-center gap-3 overflow-hidden border border-border bg-card-solid px-2.5 py-2 text-left",
          cancelled && "opacity-50",
        )}
      >
        {accent && (
          <span className="absolute left-0 top-0 h-full w-[3px]" style={{ backgroundColor: accent }} />
        )}

        {/* Task glyph doubles as the completion toggle (a single square). */}
        {isTask && (
          <button
            type="button"
            aria-label={done ? "Mark task incomplete" : "Mark task complete"}
            onClick={(ev) => {
              ev.stopPropagation()
              setDone((d) => !d)
            }}
            className={cn(GLYPH_BOX, "relative text-foreground")}
          >
            <NodeGlyph kind="task" filled={done} strokeWidth={2} />
            {done && <Check className="absolute h-2.5 w-2.5 text-background" strokeWidth={3.5} />}
          </button>
        )}

        {/* Open region — the whole row opens (handler is on the row container so
            the hover scale-spring can never swallow the click); this is just a
            non-interactive layout wrapper for the glyph, title, and detail. */}
        <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {!isTask && (
            <span className={cn(GLYPH_BOX, "text-foreground")}>
              <NodeGlyph kind={kind} />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span
              className={cn(
                "truncate text-[13px] tracking-tight transition-colors",
                isTask && done
                  ? "text-muted-foreground/60 line-through"
                  : cancelled
                    ? "text-foreground line-through"
                    : "text-foreground",
              )}
            >
              {e.title}
            </span>
            {isTask && e.tags && e.tags.length > 0 && (
              <span className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                {e.tags.map((t) => `#${t}`).join("  ")}
              </span>
            )}
          </span>

          {!isTask && <OpenTaskCount entityId={e.id} />}
          {hasRange && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
              {fmtTime(e.start!)}
              {"\u2013"}
              {fmtTime(e.end!)}
            </span>
          )}
          {kind === "instant" && hasMoment && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
              {fmtMoment(e.at!, e.seconds ?? 0)}
            </span>
          )}
        </div>

        {/* Task-only trailing: due label + priority dot. */}
        {isTask && e.dueDate && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">{e.dueDate}</span>
        )}
        {isTask && (
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", priorityDot[e.priority ?? "medium"])} />
        )}
      </motion.div>
    </li>
  )
}
