"use client"

import { motion } from "motion/react"
import { X, Check, Calendar, Flag, Hash } from "lucide-react"
import type { Entity, TaskPriority } from "@/lib/zero/types"
import { getSpace } from "@/lib/zero/data"
import { layerTransition, taskLayoutId, taskTitleId, glyphId, contentTransition } from "@/lib/zero/motion"
import { NodeGlyph } from "./node-glyph"
import { EntityBody } from "./entity-body"
import { useState } from "react"
import { cn } from "@/lib/utils"

const priorityLabel: Record<TaskPriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
}

/**
 * A Task window. In the nested-doll stack every window renders the same compact
 * header (glyph + title + close) so each ancestor's header peeks above its
 * children, replacing the breadcrumb. The header is intentionally small (title
 * ~14px, near the DO-list row's font) so the row → header shared-element morph
 * barely scales and reads clean. The body renders below, full opacity.
 */
export function TaskFrame({
  task,
  depth,
  isTop,
  onCloseTo,
}: {
  task: Entity
  depth: number
  isTop: boolean
  onCloseTo: (targetTopIndex: number) => void
}) {
  const [done, setDone] = useState(!!task.completed)
  // Shared morph ids — the frame and its origin row own the same layoutIds, so
  // open/close is one continuous layout animation. Window geometry is static per
  // depth (see LayerDepthContainer), so the morph projects cleanly.
  const bodyMorphId = taskLayoutId(task.id)
  const titleMorphId = taskTitleId(task.id)
  const glyphMorphId = glyphId(task.id)

  const primarySpaceId = task.parentId ?? "s_root"
  const primarySpace = getSpace(primarySpaceId)
  const accent = primarySpace?.accent ?? "var(--accent)"
  const spaceNames = [primarySpaceId, ...task.taggedSpaceIds]
    .map((id) => getSpace(id)?.title)
    .filter(Boolean) as string[]

  return (
    <motion.div
      layoutId={bodyMorphId}
      transition={layerTransition}
      style={{ borderRadius: 4 }}
      className="relative flex h-full w-full flex-col overflow-hidden border border-border bg-card shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)]"
    >
      {/* Compact nav-bar header — always rendered so this window's title peeks
          above its children. `pointer-events:auto` re-enables interaction even
          when this is an ancestor window (its container is inert), so its close
          button still cascades the stack back to this level. */}
      <div
        className="relative flex min-h-[40px] items-center gap-2 px-3"
        style={{ pointerEvents: "auto" }}
      >
        <button
          type="button"
          aria-label={done ? "Mark task incomplete" : "Mark task complete"}
          onClick={() => setDone((d) => !d)}
          className="group/check relative flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-foreground transition-colors hover:bg-foreground/5"
        >
          <motion.span
            layoutId={glyphMorphId}
            transition={layerTransition}
            className="flex h-[18px] w-[18px] items-center justify-center"
          >
            <NodeGlyph kind="task" filled={done} strokeWidth={1.75} />
          </motion.span>
          {done && <Check className="absolute h-2.5 w-2.5 text-background" strokeWidth={3} />}
        </button>

        <motion.h2
          layoutId={titleMorphId}
          transition={layerTransition}
          className={cn(
            // whitespace-nowrap is REQUIRED: shares taskTitleId with the row's
            // truncated (nowrap) span; allowing wrap mid-morph rewraps text and
            // orphans fragments that read as ghosts.
            "min-w-0 flex-1 truncate whitespace-nowrap text-sm font-medium leading-tight tracking-tight",
            done ? "text-muted-foreground/60 line-through" : "text-foreground",
          )}
        >
          {task.title}
        </motion.h2>

        <button
          type="button"
          onClick={() => onCloseTo(depth - 1)}
          aria-label={`Close ${task.title}`}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Meta line — only the top window shows it (ancestors are covered below
          their header peek). Fades in after the morph settles. */}
      {isTop && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...contentTransition, delay: 0.08 }}
          className="flex flex-wrap items-center gap-2 px-3 pb-2"
        >
          <span className="truncate text-[12.5px] text-muted-foreground">{spaceNames.join(" · ")}</span>
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
      )}

      {/* Body renders at full opacity so that on close the body — and the row
          morphing within it — stays fully visible as the window shrinks. */}
      <EntityBody nodeId={task.id} />
    </motion.div>
  )
}
