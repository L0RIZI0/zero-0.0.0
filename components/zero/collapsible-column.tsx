"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * A borderless, vertically-stacked side column that can collapse to a thin rail.
 * Used for Assets (left) and Outputs (right) flanking the Tasks list.
 */
export function CollapsibleColumn({
  title,
  side,
  count,
  children,
  defaultOpen = true,
}: {
  title: string
  side: "left" | "right"
  count?: number
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  const OpenIcon = side === "left" ? PanelLeftClose : PanelRightClose
  const ClosedIcon = side === "left" ? PanelLeftOpen : PanelRightOpen

  if (!open) {
    return (
      <div
        className={cn(
          "flex w-9 shrink-0 flex-col items-center gap-3 pt-1",
          side === "right" && "order-last",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Expand ${title}`}
          className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
        >
          <ClosedIcon className="h-4 w-4" />
        </button>
        <span
          className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70"
          style={{ writingMode: "vertical-rl" }}
        >
          {title}
          {typeof count === "number" ? `  ${count}` : ""}
        </span>
      </div>
    )
  }

  return (
    <section
      aria-label={title}
      className={cn("flex min-h-0 w-[230px] shrink-0 flex-col", side === "right" && "order-last")}
    >
      <div className="mb-1 flex items-center justify-between px-1">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {title}
          {typeof count === "number" && (
            <span className="text-muted-foreground/60">{count}</span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={`Collapse ${title}`}
          className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground/70 transition-colors hover:bg-secondary/70 hover:text-foreground"
        >
          <OpenIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1 no-scrollbar">
        <AnimatePresence initial={false}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}
