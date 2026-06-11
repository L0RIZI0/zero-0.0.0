"use client"

import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Check, Plus, Pin } from "lucide-react"
import { getContextItems, isPinned, pinItem, type ContextItem } from "@/lib/zero/data"
import type { Task, TaskPriority } from "@/lib/zero/types"
import { useZeroNav } from "@/lib/zero/nav-store"
import {
  layerTransition,
  taskLayoutId,
  taskTitleId,
  spaceLayoutId,
  spaceTitleId,
  panelTransition,
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

function TaskRow({
  task,
  onContext,
}: {
  task: Task
  onContext: (e: React.MouseEvent) => void
}) {
  const [done, setDone] = useState(task.completed)
  const { openTask, stack } = useZeroNav()

  // When this task is open as a window, render an inert placeholder so the
  // shared layoutId lives only on the active frame.
  const isOpen = stack.includes(task.id)
  if (isOpen) {
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
          <NodeGlyph kind="task" filled={done} strokeWidth={2} />
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
          {task.tags.length > 0 && (
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
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", priorityDot[task.priority])} />
      </motion.div>
    </li>
  )
}

/** An event surfaced in the task list — read-only row with a triangle glyph. */
function EventRow({
  item,
  onContext,
}: {
  item: ContextItem
  onContext: (e: React.MouseEvent) => void
}) {
  const { openSpace } = useZeroNav()
  const event = item.event!
  return (
    <li>
      <motion.button
        type="button"
        layout
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={panelTransition}
        onClick={() => openSpace(event.spaceId)}
        onContextMenu={onContext}
        style={{ borderRadius: 4 }}
        whileHover={{ scale: 1.02, boxShadow: "0 12px 28px -10px rgba(0,0,0,0.28)" }}
        className="group flex w-full items-center gap-3 border border-border bg-card-solid px-2.5 py-2 text-left"
      >
        <span className={cn(GLYPH_BOX, "text-foreground")}>
          <NodeGlyph kind="event" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] tracking-tight text-foreground">
          {event.title}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
          {fmtTime(event.start)}
        </span>
      </motion.button>
    </li>
  )
}

/** A child space surfaced in the task list — hexagon glyph, dives in on click. */
function SpaceRow({
  item,
  onContext,
}: {
  item: ContextItem
  onContext: (e: React.MouseEvent) => void
}) {
  const { openSpace } = useZeroNav()
  const space = item.space!
  return (
    <li>
      <motion.button
        type="button"
        layout
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={panelTransition}
        onClick={() => openSpace(space.id)}
        onContextMenu={onContext}
        style={{ borderRadius: 4 }}
        whileHover={{ scale: 1.02, boxShadow: "0 12px 28px -10px rgba(0,0,0,0.28)" }}
        className="group flex w-full items-center gap-3 border border-border bg-card-solid px-2.5 py-2 text-left"
      >
        <span className={cn(GLYPH_BOX, "text-foreground")}>
          <NodeGlyph kind="space" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] tracking-tight text-foreground">
          {space.name}
        </span>
        {space.childSpaceIds.length > 0 && (
          <span className="shrink-0 text-[11px] text-muted-foreground/70">
            {space.childSpaceIds.length} spaces
          </span>
        )}
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
      ],
    })
  }

  return (
    <section aria-label="Tasks" className="flex min-h-0 flex-col">
      {/* The TASKS label is centered above the list (aligned on the same row as
          the INPUTS / OUTPUTS headers on each side); the Open/All filters are
          pinned to the right without pushing the label off-center. */}
      <div className="relative mb-1 flex h-5 items-center justify-center px-1">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Tasks
        </h2>
        <div className="absolute right-1 flex items-center gap-1">
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
          -mx-2/px-2 gutter gives the hover scale room so rows aren't clipped
          horizontally by overflow-y's implicit overflow-x clip. */}
      <ul
        key={spaceId}
        className="-mx-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 no-scrollbar"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {shown.length === 0 ? (
            <li
              key="empty"
              className="px-2 py-5 text-center text-[12px] text-muted-foreground/60"
            >
              Nothing open in this context.
            </li>
          ) : (
            shown.map((it) =>
              it.kind === "task" ? (
                <TaskRow key={it.id} task={it.task!} onContext={(e) => openMenu(e, it)} />
              ) : it.kind === "space" ? (
                <SpaceRow key={it.id} item={it} onContext={(e) => openMenu(e, it)} />
              ) : (
                <EventRow key={it.id} item={it} onContext={(e) => openMenu(e, it)} />
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
