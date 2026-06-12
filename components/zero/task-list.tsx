"use client"

import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Check, Plus, Pin, Trash2, Ban, RotateCcw } from "lucide-react"
import {
  getContextItems,
  getOpenTaskCount,
  isPinned,
  pinItem,
  deleteEntity,
  setEventCancelled,
  type ContextItem,
} from "@/lib/zero/data"
import type { Entity, TaskPriority } from "@/lib/zero/types"
import { useZeroNav } from "@/lib/zero/nav-store"
import {
  layerTransition,
  taskLayoutId,
  taskTitleId,
  spaceLayoutId,
  spaceTitleId,
  eventRowLayoutId,
  eventRowTitleId,
  instantRowLayoutId,
  instantRowTitleId,
  glyphId,
} from "@/lib/zero/motion"
import { NodeGlyph } from "./node-glyph"
import { CreateWindow } from "./create-window"
import { ContextMenu, type ContextMenuState } from "./context-menu"
import { cn } from "@/lib/utils"

const priorityDot: Record<TaskPriority, string> = {
  high: "bg-accent",
  medium: "bg-foreground/40",
  low: "bg-foreground/20",
}

/**
 * Shared leading glyph box for every row, so the task square, event triangle,
 * and space hexagon all read at the same 16px size and weight. The square is
 * rendered very slightly paler than the others, per the unified treatment.
 */
const GLYPH_BOX = "flex h-4 w-4 shrink-0 items-center justify-center"

/**
 * Trailing detail showing how many open (incomplete) DIRECT child tasks live
 * inside a space — a number followed by the task square glyph (e.g. "4 ■").
 * Child spaces/events and deeper descendants are intentionally not counted.
 * Renders nothing when there are none.
 */
function OpenTaskCount({ spaceId }: { spaceId: string }) {
  const { dataVersion } = useZeroNav()
  const count = useMemo(() => getOpenTaskCount(spaceId), [spaceId, dataVersion])
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

function TaskRow({
  task,
  onContext,
}: {
  task: Entity
  onContext: (e: React.MouseEvent) => void
}) {
  const [done, setDone] = useState(!!task.completed)
  const { openTask, stack } = useZeroNav()

  // This row stays mounted while its window is open, and it carries the shared
  // taskLayoutId. If it kept that layoutId while the frame is also open, TWO
  // elements would own the same layoutId and Framer's frame-expand morph breaks
  // (the frame opens with no chrome). So while open, swap in an inert
  // placeholder so the layoutId lives only on the active frame. (The dock's
  // PinnedCard is different — it unmounts on open and uses no layoutId at all.)
  if (stack.includes(task.id)) {
    return (
      <li>
        <div
          aria-hidden
          className="h-[42px] w-full rounded-sm border border-dashed border-border/60 bg-secondary/30"
        />
      </li>
    )
  }

  return (
    <li>
      <motion.div
        layoutId={taskLayoutId(task.id)}
        transition={layerTransition}
        style={{ borderRadius: 4 }}
        onContextMenu={onContext}
        whileHover={{
          scale: 1.02,
          boxShadow: "0 12px 28px -10px rgba(0,0,0,0.28)",
        }}
        className="group flex w-full items-center gap-3 border border-border bg-card-solid px-2.5 py-2 text-left"
      >
        <button
          type="button"
          aria-label={done ? "Mark task incomplete" : "Mark task complete"}
          onClick={(e) => {
            e.stopPropagation()
            setDone((d) => !d)
          }}
          className={cn(GLYPH_BOX, "relative text-foreground")}
        >
          <motion.span
            layoutId={glyphId(task.id)}
            transition={layerTransition}
            className="flex items-center justify-center"
          >
            <NodeGlyph kind="task" filled={done} strokeWidth={2} />
          </motion.span>
          {done && (
            <Check
              className="absolute h-2.5 w-2.5 text-background"
              strokeWidth={3.5}
            />
          )}
        </button>

        <button
          type="button"
          onClick={() => openTask(task.id)}
          className="flex min-w-0 flex-1 flex-col text-left"
        >
          <motion.span
            layoutId={taskTitleId(task.id)}
            transition={layerTransition}
            className={cn(
              "truncate text-[13px] tracking-tight transition-colors",
              done ? "text-muted-foreground/60 line-through" : "text-foreground",
            )}
          >
            {task.title}
          </motion.span>
          {task.tags && task.tags.length > 0 && (
            <span className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
              {task.tags.map((t) => `#${t}`).join("  ")}
            </span>
          )}
        </button>

        {task.dueDate && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
            {task.dueDate}
          </span>
        )}
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", priorityDot[task.priority ?? "medium"])} />
      </motion.div>
    </li>
  )
}

/** An event surfaced in the task list — opens as its own window. An event lives
 *  in two places at once (this row AND its timeline marker), so it can morph
 *  from EITHER: this row carries its own row-specific layoutId and opens with
 *  source "row", so the window grows from here when clicked here (and the
 *  timeline keeps its marker). While the window is open from the row, the row
 *  releases its layoutId to the frame (placeholder swap) so only one element
 *  owns it. Detail line shows the open-subtask count AND the time range. */
function EventRow({
  item,
  onContext,
}: {
  item: ContextItem
  onContext: (e: React.MouseEvent) => void
}) {
  const { open, stack, openSourceOf } = useZeroNav()
  const event = item.event!
  const hasRange = typeof event.start === "number" && typeof event.end === "number"
  const cancelled = !!event.cancelled

  // When opened FROM this row, hand the row layoutId to the frame so the morph
  // reads as the row growing into the window. (If it was opened from the
  // timeline instead, the row stays put and the timeline owns the morph.)
  if (stack.includes(event.id) && openSourceOf(event.id) === "row") {
    return (
      <li>
        <div
          aria-hidden
          className="h-[42px] w-full rounded-sm border border-dashed border-border/60 bg-secondary/30"
        />
      </li>
    )
  }

  return (
    <li>
      <motion.button
        type="button"
        layoutId={eventRowLayoutId(event.id)}
        transition={layerTransition}
        onClick={() => open(event.id, "row")}
        onContextMenu={onContext}
        style={{ borderRadius: 4 }}
        whileHover={{ scale: 1.02, boxShadow: "0 12px 28px -10px rgba(0,0,0,0.28)" }}
        className={cn(
          "group flex w-full items-center gap-3 border border-border bg-card-solid px-2.5 py-2 text-left",
          cancelled && "opacity-50",
        )}
      >
        <span className={cn(GLYPH_BOX, "text-foreground")}>
          <NodeGlyph kind="event" />
        </span>
        <motion.span
          layoutId={eventRowTitleId(event.id)}
          transition={layerTransition}
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] tracking-tight text-foreground",
            cancelled && "line-through",
          )}
        >
          {event.title}
        </motion.span>
        <OpenTaskCount spaceId={event.id} />
        {hasRange && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
            {fmtTime(event.start!)}
            {"\u2013"}
            {fmtTime(event.end!)}
          </span>
        )}
      </motion.button>
    </li>
  )
}

/** An instant surfaced in the task list — like an event row, but it marks a
 *  single point in time, so its detail shows one precise moment (down to the
 *  second). Like events, it can morph from EITHER this row or its timeline
 *  marker depending on where it's opened from. */
function InstantRow({
  item,
  onContext,
}: {
  item: ContextItem
  onContext: (e: React.MouseEvent) => void
}) {
  const { open, stack, openSourceOf } = useZeroNav()
  const instant = item.entity
  const hasMoment = typeof instant.at === "number"
  const cancelled = !!instant.cancelled

  if (stack.includes(instant.id) && openSourceOf(instant.id) === "row") {
    return (
      <li>
        <div
          aria-hidden
          className="h-[42px] w-full rounded-sm border border-dashed border-border/60 bg-secondary/30"
        />
      </li>
    )
  }

  return (
    <li>
      <motion.button
        type="button"
        layoutId={instantRowLayoutId(instant.id)}
        transition={layerTransition}
        onClick={() => open(instant.id, "row")}
        onContextMenu={onContext}
        style={{ borderRadius: 4 }}
        whileHover={{ scale: 1.02, boxShadow: "0 12px 28px -10px rgba(0,0,0,0.28)" }}
        className={cn(
          "group flex w-full items-center gap-3 border border-border bg-card-solid px-2.5 py-2 text-left",
          cancelled && "opacity-50",
        )}
      >
        <span className={cn(GLYPH_BOX, "text-foreground")}>
          <NodeGlyph kind="instant" />
        </span>
        <motion.span
          layoutId={instantRowTitleId(instant.id)}
          transition={layerTransition}
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] tracking-tight text-foreground",
            cancelled && "line-through",
          )}
        >
          {instant.title}
        </motion.span>
        <OpenTaskCount spaceId={instant.id} />
        {hasMoment && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
            {fmtMoment(instant.at!, instant.seconds ?? 0)}
          </span>
        )}
      </motion.button>
    </li>
  )
}

/** A child space surfaced in the task list — hexagon glyph, dives in on click.
 *  Carries the shared space layoutId so the row's border frame expands into the
 *  opened window (same morph as the pinned SPACES-dock card). */
function SpaceRow({
  item,
  onContext,
}: {
  item: ContextItem
  onContext: (e: React.MouseEvent) => void
}) {
  const { openSpace, stack } = useZeroNav()
  const space = item.space!
  const accent = space.accent ?? "var(--muted-foreground)"

  // While this space is open as a frame, release the shared layoutId to the
  // frame (see TaskRow note) via an inert placeholder so the morph stays clean.
  if (stack.includes(space.id)) {
    return (
      <li>
        <div
          aria-hidden
          className="h-[42px] w-full rounded-sm border border-dashed border-border/60 bg-secondary/30"
        />
      </li>
    )
  }

  return (
    <li>
      <motion.button
        type="button"
        layoutId={spaceLayoutId(space.id)}
        transition={layerTransition}
        onClick={() => openSpace(space.id)}
        onContextMenu={onContext}
        style={{ borderRadius: 4 }}
        whileHover={{ scale: 1.02, boxShadow: "0 12px 28px -10px rgba(0,0,0,0.28)" }}
        className="group relative flex w-full items-center gap-3 overflow-hidden border border-border bg-card-solid px-2.5 py-2 text-left"
      >
        <motion.span
          layoutId={`${spaceLayoutId(space.id)}-accent`}
          transition={layerTransition}
          className="absolute left-0 top-0 h-full w-[3px]"
          style={{ backgroundColor: accent }}
        />
        <motion.span
          layoutId={glyphId(space.id)}
          transition={layerTransition}
          className={cn(GLYPH_BOX, "text-foreground")}
        >
          <NodeGlyph kind="space" />
        </motion.span>
        <motion.span
          layoutId={spaceTitleId(space.id)}
          transition={layerTransition}
          className="min-w-0 flex-1 truncate text-[13px] tracking-tight text-foreground"
        >
          {space.title}
        </motion.span>
        <OpenTaskCount spaceId={space.id} />
      </motion.button>
    </li>
  )
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

export function TaskList({ spaceId }: { spaceId: string }) {
  const { dataVersion, notifyDataChanged } = useZeroNav()
  // Re-read whenever data mutates (new item created / pin changed) or context
  // changes. Pinned items are promoted to the SPACES row, so they're excluded
  // here.
  const items = useMemo(
    () => getContextItems(spaceId).filter((it) => !isPinned(spaceId, it.id)),
    [spaceId, dataVersion],
  )
  const [filter, setFilter] = useState<"open" | "all">("open")
  const [creating, setCreating] = useState(false)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  // Reset filter view when the context changes.
  useEffect(() => setFilter("open"), [spaceId])

  const shown = useMemo(
    () =>
      filter === "open"
        ? items.filter((it) => it.kind !== "task" || !it.task!.completed)
        : items,
    [items, filter],
  )
  const openCount = items.filter((it) => it.kind === "task" && !it.task!.completed).length

  const openMenu = (e: React.MouseEvent, item: ContextItem) => {
    e.preventDefault()
    e.stopPropagation()
    const canCancel = item.kind === "event" || item.kind === "instant"
    const isCancelled = !!item.entity.cancelled
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "Pin to Spaces",
          icon: <Pin className="h-3.5 w-3.5" />,
          onSelect: () => {
            pinItem(spaceId, item.id)
            notifyDataChanged()
          },
        },
        ...(canCancel
          ? [
              {
                label: isCancelled ? "Restore" : "Cancel",
                icon: isCancelled ? (
                  <RotateCcw className="h-3.5 w-3.5" />
                ) : (
                  <Ban className="h-3.5 w-3.5" />
                ),
                onSelect: () => {
                  setEventCancelled(item.id, !isCancelled)
                  notifyDataChanged()
                },
              },
            ]
          : []),
        {
          label: "Delete",
          icon: <Trash2 className="h-3.5 w-3.5" />,
          onSelect: () => {
            deleteEntity(item.id)
            notifyDataChanged()
          },
        },
      ],
    })
  }

  return (
    <section aria-label="Do list" className="flex min-h-0 flex-col">
      {/* The DO label is hidden; the Open/All filters stay pinned to the right
          on a short header row that keeps alignment with the INPUTS / OUTPUTS
          columns on each side. */}
      <div className="relative mb-1 flex h-5 items-center justify-end px-1">
        <div className="flex items-center gap-1">
          {(["open", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[11px] capitalize transition-colors",
                filter === f
                  ? "text-foreground"
                  : "text-muted-foreground/70 hover:text-foreground",
              )}
            >
              {f === "open" ? `Open ${openCount}` : "All"}
            </button>
          ))}
        </div>
      </div>

      {/* Keyed by context: switching nodes hard-swaps the list (instant, no
          cross-fade) while add/remove within a context still animates. The
          -mx-6/px-6 gutter cancels out visually but pushes the overflow clip
          rectangle outward, giving the hover scale (and its drop shadow) room
          so rows aren't cropped left/right by overflow-y's implicit x-clip. */}
      <ul
        key={spaceId}
        className="-mx-6 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-6 no-scrollbar"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {shown.length === 0 ? (
            <li
              key="empty"
              className="px-2 py-5 text-center text-[12px] text-muted-foreground/60"
            >
              Let&apos;s do
            </li>
          ) : (
            shown.map((it) =>
              it.kind === "task" ? (
                <TaskRow key={it.id} task={it.task!} onContext={(e) => openMenu(e, it)} />
              ) : it.kind === "space" ? (
                <SpaceRow key={it.id} item={it} onContext={(e) => openMenu(e, it)} />
              ) : it.kind === "event" ? (
                <EventRow
                  key={it.id}
                  item={it}
                  onContext={(e) => openMenu(e, it)}
                />
              ) : (
                <InstantRow
                  key={it.id}
                  item={it}
                  onContext={(e) => openMenu(e, it)}
                />
              ),
            )
          )}
        </AnimatePresence>
      </ul>

      <motion.button
        type="button"
        onClick={() => setCreating(true)}
        style={{ borderRadius: 4 }}
        whileHover={{
          scale: 1.02,
          boxShadow: "0 12px 28px -10px rgba(0,0,0,0.28)",
        }}
        className="mt-1.5 flex w-full items-center justify-center gap-1.5 border border-border bg-card-solid px-2.5 py-2 text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
        Add
      </motion.button>

      <AnimatePresence>
        {creating && (
          <CreateWindow spaceId={spaceId} onClose={() => setCreating(false)} />
        )}
      </AnimatePresence>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </section>
  )
}
