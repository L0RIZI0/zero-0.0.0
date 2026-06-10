"use client"

import { Fragment } from "react"
import { ChevronRight } from "lucide-react"
import { getSpace, getTask } from "@/lib/zero/data"
import { isTaskId, useZeroNav } from "@/lib/zero/nav-store"
import { cn } from "@/lib/utils"

export function BreadcrumbPath() {
  const { stack, goToDepth } = useZeroNav()

  return (
    <nav aria-label="Space path" className="flex items-center gap-1 px-5 pb-2">
      {stack.map((nodeId, depth) => {
        const label = isTaskId(nodeId)
          ? getTask(nodeId)?.title
          : depth === 0
            ? "Space 0"
            : getSpace(nodeId)?.name
        if (!label) return null
        const isLast = depth === stack.length - 1
        return (
          <Fragment key={nodeId}>
            <button
              type="button"
              onClick={() => goToDepth(depth)}
              className={cn(
                "max-w-[180px] truncate rounded-md px-1.5 py-0.5 text-[12.5px] tracking-tight transition-colors",
                isLast
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
            {!isLast && (
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}
