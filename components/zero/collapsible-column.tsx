"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react"
import { panelTransition } from "@/lib/zero/motion"
import { cn } from "@/lib/utils"

/**
 * A borderless side column that lives inside a fixed-width slot. Collapsing it
 * swaps the full panel for a thin rail (aligned to the outer screen edge) with
 * a quick crossfade — the slot width never changes, so the center Tasks column
 * (and its centered TASKS label) stays put when a panel opens or closes.
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
    <div className={cn("relative flex min-h-0 w-full flex-col", side === "right" && "order-last")}>
      <AnimatePresence mode="wait" initial={false}>
        {open ? (
          <motion.section
            key="open"
            aria-label={title}
            initial={{ opacity: 0, x: side === "left" ? -8 : 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: side === "left" ? -8 : 8 }}
            transition={panelTransition}
            className="flex min-h-0 flex-col"
          >
            <div
              className={cn(
                "mb-1 flex items-center gap-1.5 px-1",
                // Inputs: icon + label grouped on the left.
                // Outputs: label + icon grouped on the right.
                side === "left" ? "justify-start" : "justify-end",
              )}
            >
              {side === "left" && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={`Collapse ${title}`}
                  className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground/70 transition-colors hover:bg-secondary/70 hover:text-foreground"
                >
                  <OpenIcon className="h-3.5 w-3.5" />
                </button>
              )}
              <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {title}
                {typeof count === "number" && (
                  <span className="text-muted-foreground/60">{count}</span>
                )}
              </h2>
              {side === "right" && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={`Collapse ${title}`}
                  className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground/70 transition-colors hover:bg-secondary/70 hover:text-foreground"
                >
                  <OpenIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div
              className={cn(
                "min-h-0 flex-1 overflow-y-auto pr-1 no-scrollbar",
                // Left (Inputs) column bleeds its scroll box to the viewport
                // edge so the per-row continuity rails aren't clipped. pl-6
                // keeps the content visually in place while -ml-6 extends the
                // box leftward into Space 0's surface.
                side === "left" && "-ml-6 pl-6",
              )}
            >
              {children}
            </div>
          </motion.section>
        ) : (
          <motion.div
            key="closed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={panelTransition}
            className={cn(
              "flex flex-col items-center gap-3 pt-1",
              // Rail hugs the outer screen edge of its fixed slot.
              side === "left" ? "self-start" : "self-end",
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
