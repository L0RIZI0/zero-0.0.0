"use client"

import { motion } from "motion/react"
import { X, Check, Calendar, Flag, Hash } from "lucide-react"
import type { Task } from "@/lib/zero/types"
import { getSpace } from "@/lib/zero/data"
import { layerTransition, taskLayoutId, contentTransition } from "@/lib/zero/motion"
import { ContextBody } from "./context-body"
import { useState } from "react"
import { cn } from "@/lib/utils"

const priorityLabel: Record<Task["priority"], string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
}

export function TaskFrame({
  task,
  onClose,
}: {
  task: Task
  onClose: () => void
}) {
  const [done, setDone] = useState(task.completed)
  // The task's primary space provides contextual accent + resources.
  const primarySpaceId = task.spaceIds[task.spaceIds.length - 1] ?? "s_root"
  const primarySpace = getSpace(primarySpaceId)
  const accent = primarySpace?.accent ?? "var(--accent)"

  return (
    <motion.div
      layoutId={taskLayoutId(task.id)}
      transition={layerTransition}
      style={{ borderRadius: 4 }}
      className="relative flex h-full w-full flex-col overflow-hidden border border-border bg-background shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)]"
    >
      {/* Frame header. The task title now lives in the top-left PathStack, so
          the header keeps only the completion toggle and close affordance. */}
      <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3">
        <button
          type="button"
          aria-label={done ? "Mark task incomplete" : "Mark task complete"}
          onClick={() => setDone((d) => !d)}
          className={cn(
            "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[4px] border transition-colors",
            done
              ? "border-foreground bg-foreground text-background"
              : "border-foreground/25 text-transparent hover:border-foreground/50",
          )}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </button>

        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${task.title}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...contentTransition, delay: 0.1 }}
        className="flex min-h-0 flex-1 flex-col gap-4 px-6 pb-4"
      >
        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-2">
          {task.dueDate && (
            <span className="flex items-center gap-1.5 rounded-sm border border-border bg-card/50 px-2.5 py-1.5 text-[12px] text-foreground">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              {task.dueDate}
            </span>
          )}
          <span className="flex items-center gap-1.5 rounded-sm border border-border bg-card/50 px-2.5 py-1.5 text-[12px] text-foreground">
            <Flag className="h-3.5 w-3.5" style={{ color: accent }} />
            {priorityLabel[task.priority]}
          </span>
          {task.tags.map((t) => (
            <span
              key={t}
              className="flex items-center gap-1 rounded-sm border border-border bg-card/50 px-2.5 py-1.5 text-[12px] text-muted-foreground"
            >
              <Hash className="h-3 w-3" />
              {t}
            </span>
          ))}
        </div>

        {/* A task is itself a context: same working surface as a space. */}
        <ContextBody
          nodeId={primarySpaceId}
          accent={typeof accent === "string" ? accent : undefined}
        />
      </motion.div>
    </motion.div>
  )
}
