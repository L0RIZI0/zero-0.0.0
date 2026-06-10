"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react"
import { panelTransition } from "@/lib/zero/motion"
import { cn } from "@/lib/utils"

const OPEN_WIDTH = 230
const RAIL_WIDTH = 36

/**
 * A borderless, vertically-stacked side column that can collapse to a thin rail.
 * Used for Inputs (left) and Outputs (right) flanking the Tasks list. The width
 * animates smoothly so the center Tasks list slides rather than jumps.
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

  return (
    <motion.section
      aria-label={title}
      initial={false}
      animate={{ width: open ? OPEN_WIDTH : RAIL_WIDTH }}
      transition={panelTransition}
      className={cn(
        "relative flex min-h-0 shrink-0 flex-col overflow-hidden",
        side === "right" && "order-last",
      )}
    >
      <AnimatePresence initial={false} mode="wait">
        {open ? (
          <motion.div
            key="open"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={panelTransition}
            className="flex min-h-0 flex-1 flex-col"
            style={{ width: OPEN_WIDTH }}
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
              {children}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="rail"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={panelTransition}
            className={cn(
              "flex flex-col items-center gap-3 pt-1",
              side === "right" ? "ml-auto" : "mr-auto",
            )}
            style={{ width: RAIL_WIDTH }}
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
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}
