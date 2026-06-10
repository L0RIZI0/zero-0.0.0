"use client"

import { motion, AnimatePresence } from "motion/react"
import { getSpace, getTask } from "@/lib/zero/data"
import { isTaskId, useZeroNav } from "@/lib/zero/nav-store"
import { contentTransition, layerTransition, spaceTitleId, taskTitleId } from "@/lib/zero/motion"
import { cn } from "@/lib/utils"

/**
 * The navigation path, shown as a vertical indented stack directly under the
 * user identity in the top-left — each opened Space/Task keeps its title
 * visible, indented one step deeper than its parent, so the whole dive is
 * legible at a glance. Replaces the old horizontal breadcrumb.
 */
export function PathStack() {
  const { stack, goToDepth } = useZeroNav()

  // Depth 0 is Space 0 (the user identity itself, shown in the header).
  if (stack.length <= 1) return null

  return (
    <nav aria-label="Open path" className="flex flex-col gap-0.5 px-5 pb-2 pt-0.5">
      <AnimatePresence initial={false}>
        {stack.map((nodeId, depth) => {
          if (depth === 0) return null
          const isTask = isTaskId(nodeId)
          const node = isTask ? getTask(nodeId) : getSpace(nodeId)
          const label = isTask
            ? (node as ReturnType<typeof getTask>)?.title
            : (node as ReturnType<typeof getSpace>)?.name
          if (!label) return null
          const accent = (node && "accent" in node ? node.accent : undefined) as
            | string
            | undefined
          const isLast = depth === stack.length - 1
          const titleLayoutId = isTask ? taskTitleId(nodeId) : spaceTitleId(nodeId)

          return (
            <motion.div
              key={nodeId}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={contentTransition}
              style={{ paddingLeft: (depth - 1) * 16 }}
              className="flex items-center"
            >
              <span
                aria-hidden
                className="mr-2 h-3 w-[3px] shrink-0 rounded-full"
                style={{ backgroundColor: accent ?? "var(--border)" }}
              />
              <motion.button
                type="button"
                layoutId={titleLayoutId}
                transition={layerTransition}
                onClick={() => goToDepth(depth)}
                className={cn(
                  "max-w-[240px] truncate rounded-md py-0.5 text-left tracking-tight transition-colors",
                  isLast
                    ? "text-[13px] font-medium text-foreground"
                    : "text-[12.5px] text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </motion.button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </nav>
  )
}
