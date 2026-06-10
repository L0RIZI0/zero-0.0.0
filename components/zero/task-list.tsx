"use client"

import { useEffect, useMemo, useState } from "react"
import { motion } from "motion/react"
import { Check } from "lucide-react"
import { getSpaceTasks } from "@/lib/zero/data"
import type { Task, TaskPriority } from "@/lib/zero/types"
import { useZeroNav } from "@/lib/zero/nav-store"
import { layerTransition, taskLayoutId, taskTitleId } from "@/lib/zero/motion"
import { cn } from "@/lib/utils"

const priorityDot: Record<TaskPriority, string> = {
  high: "bg-accent",
  medium: "bg-foreground/40",
  low: "bg-foreground/20",
}

function TaskRow({ task }: { task: Task }) {
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
        className="group flex w-full items-center gap-3 border border-border bg-card/50 px-2.5 py-2 text-left transition-colors hover:border-foreground/20 hover:bg-card"
      >
        <button
          type="button"
          aria-label={done ? "Mark task incomplete" : "Mark task complete"}
          onClick={(e) => {
            e.stopPropagation()
            setDone((d) => !d)
          }}
          className={cn(
            "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] border transition-colors",
            done
              ? "border-foreground bg-foreground text-background"
              : "border-foreground/25 text-transparent group-hover:border-foreground/50",
          )}
        >
          <Check className="h-3 w-3" strokeWidth={3} />
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

export function TaskList({ spaceId }: { spaceId: string }) {
  const tasks = useMemo(() => getSpaceTasks(spaceId), [spaceId])
  const [filter, setFilter] = useState<"open" | "all">("open")

  // Reset filter view when the space changes.
  useEffect(() => setFilter("open"), [spaceId])

  const shown = filter === "open" ? tasks.filter((t) => !t.completed) : tasks
  const openCount = tasks.filter((t) => !t.completed).length

  return (
    <section aria-label="Tasks" className="flex min-h-0 flex-col">
      <div className="relative mb-1 flex items-center justify-center px-1">
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

      <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1 no-scrollbar">
        {shown.length === 0 ? (
          <li className="px-2 py-6 text-center text-[12px] text-muted-foreground/60">
            Nothing open in this context.
          </li>
        ) : (
          shown.map((t) => <TaskRow key={t.id} task={t} />)
        )}
      </ul>
    </section>
  )
}
