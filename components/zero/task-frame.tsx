"use client"

import { motion } from "motion/react"
import { X, Check, Calendar, Flag, Hash } from "lucide-react"
import type { Task } from "@/lib/zero/types"
import { getSpace } from "@/lib/zero/data"
import { layerTransition, taskLayoutId, taskTitleId, contentTransition } from "@/lib/zero/motion"
import { useState } from "react"
import { cn } from "@/lib/utils"

const priorityLabel: Record<Task["priority"], string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
}

/**
 * A Task window — chrome only. Like SpaceFrame, it paints the bordered frame and
 * owns the title band (checkbox + title + meta), leaving the middle transparent
 * so the persistent frontmost content reads in front of it. A task has no
 * spaces dock, so its bottom band is minimal.
 */
export function TaskFrame({
  task,
  isActive,
  onClose,
}: {
  task: Task
  isActive: boolean
  onClose: () => void
}) {
  const [done, setDone] = useState(task.completed)
  // The task's primary space provides contextual accent.
  const primarySpaceId = task.spaceIds[task.spaceIds.length - 1] ?? "s_root"
  const primarySpace = getSpace(primarySpaceId)
  const accent = primarySpace?.accent ?? "var(--accent)"
  const spaceNames = task.spaceIds
    .map((id) => getSpace(id)?.name)
    .filter(Boolean) as string[]

  return (
    <motion.div
      layoutId={taskLayoutId(task.id)}
      transition={layerTransition}
      style={{ borderRadius: 4 }}
      className="relative flex h-full w-full flex-col overflow-hidden border border-border bg-secondary/40 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)]"
    >
      {/* Title band */}
      <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            aria-label={done ? "Mark task incomplete" : "Mark task complete"}
            onClick={() => setDone((d) => !d)}
            className={cn(
              "mt-1 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[4px] border transition-colors",
              done
                ? "border-foreground bg-foreground text-background"
                : "border-foreground/25 text-transparent hover:border-foreground/50",
            )}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </button>
          <div className="flex min-w-0 flex-col">
            {isActive && (
              <motion.h2
                layoutId={taskTitleId(task.id)}
                transition={layerTransition}
                className={cn(
                  "text-pretty text-[22px] font-medium leading-tight tracking-tight",
                  done ? "text-muted-foreground/60 line-through" : "text-foreground",
                )}
              >
                {task.title}
              </motion.h2>
            )}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ ...contentTransition, delay: 0.08 }}
              className="mt-1 flex flex-wrap items-center gap-2"
            >
              <span className="truncate text-[12.5px] text-muted-foreground">
                {spaceNames.join(" · ")}
              </span>
              {task.dueDate && (
                <span className="flex items-center gap-1.5 rounded-sm border border-border bg-card/50 px-2 py-1 text-[11.5px] text-foreground">
                  <Calendar className="h-3 w-3 text-muted-foreground" />
                  {task.dueDate}
                </span>
              )}
              <span className="flex items-center gap-1.5 rounded-sm border border-border bg-card/50 px-2 py-1 text-[11.5px] text-foreground">
                <Flag className="h-3 w-3" style={{ color: accent }} />
                {priorityLabel[task.priority]}
              </span>
              {task.tags.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-1 rounded-sm border border-border bg-card/50 px-2 py-1 text-[11.5px] text-muted-foreground"
                >
                  <Hash className="h-3 w-3" />
                  {t}
                </span>
              ))}
            </motion.div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${task.title}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Transparent middle — the persistent frontmost content renders over it. */}
      <div className="min-h-0 flex-1" aria-hidden />
    </motion.div>
  )
}
