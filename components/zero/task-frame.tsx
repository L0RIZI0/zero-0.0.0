"use client"

import { motion } from "motion/react"
import { X, Check, Calendar, Flag, Hash } from "lucide-react"
import type { Entity, TaskPriority } from "@/lib/zero/types"
import { getSpace } from "@/lib/zero/data"
import { layerTransition, taskLayoutId, taskTitleId, glyphId, contentTransition } from "@/lib/zero/motion"
import { NodeGlyph } from "./node-glyph"
import { useState } from "react"
import { cn } from "@/lib/utils"

const priorityLabel: Record<TaskPriority, string> = {
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
  task: Entity
  isActive: boolean
  onClose: () => void
}) {
  const [done, setDone] = useState(!!task.completed)
  // The task's origin parent provides the contextual accent; its parent plus
  // any tagged spaces make up the membership line.
  const primarySpaceId = task.parentId ?? "s_root"
  const primarySpace = getSpace(primarySpaceId)
  const accent = primarySpace?.accent ?? "var(--accent)"
  const spaceNames = [primarySpaceId, ...task.taggedSpaceIds]
    .map((id) => getSpace(id)?.title)
    .filter(Boolean) as string[]

  return (
    <motion.div
      layoutId={taskLayoutId(task.id)}
      transition={layerTransition}
      style={{ borderRadius: 4 }}
      className="relative flex h-full w-full flex-col overflow-hidden border border-border bg-secondary/40 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)]"
    >
      {/* Title band — only the active (frontmost) frame paints its header.
          Parent frames recede behind the opaque active layer, so rendering
          their checkbox / metadata / close button would bleed through. */}
      {isActive && (
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3">
          <div className="flex min-w-0 items-start gap-3">
            <button
              type="button"
              aria-label={done ? "Mark task incomplete" : "Mark task complete"}
              onClick={() => setDone((d) => !d)}
              className="group/check relative mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[4px] text-foreground transition-colors hover:bg-foreground/5"
            >
              {/* The kind glyph IS the checkbox — it travels here from the list
                  row / dock card via the shared glyphId and scales up with the
                  title. It fills + shows a check once the task is done (no second
                  nested square). */}
              <motion.span
                layoutId={glyphId(task.id)}
                transition={layerTransition}
                className="flex h-[22px] w-[22px] items-center justify-center"
              >
                <NodeGlyph kind="task" filled={done} strokeWidth={1.75} />
              </motion.span>
              {done && (
                <Check className="absolute h-3 w-3 text-background" strokeWidth={3} />
              )}
            </button>
            <div className="flex min-w-0 flex-col">
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
                  {priorityLabel[task.priority ?? "medium"]}
                </span>
                {(task.tags ?? []).map((t) => (
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
            className="-mr-2 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Transparent middle — the persistent frontmost content renders over it. */}
      <div className="min-h-0 flex-1" aria-hidden />
    </motion.div>
  )
}
