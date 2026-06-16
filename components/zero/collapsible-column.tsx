"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react"
import { panelTransition } from "@/lib/zero/motion"
import { cn } from "@/lib/utils"

/**
 * Module-level memory of each panel's open/closed state, keyed by
 * `${entityId}:${side}`. EntityBody (and therefore every CollapsibleColumn) is
 * re-rendered — and can be re-mounted — whenever the window stack changes, e.g.
 * when a child window opens and the parent reflows to a spine. A plain local
 * useState would reset to `defaultOpen` on each remount, which is why an
 * expanded Inputs/Outputs panel snapped shut the moment a child opened. Holding
 * the state outside React preserves the user's choice across those remounts.
 */
const panelOpenState = new Map<string, boolean>()

/**
 * A borderless side column that lives inside a fixed-width slot. Collapsing it
 * swaps the full panel for a thin rail (aligned to the outer screen edge) with
 * a quick crossfade — the slot width never changes, so the center Tasks column
 * (and its centered TASKS label) stays put when a panel opens or closes.
 */
export function CollapsibleColumn({
  title,
  collapsedTitle,
  side,
  count,
  children,
  defaultOpen = true,
  storeKey,
}: {
  title: string
  /** Short label shown on the vertical rail when collapsed (e.g. "In" / "Out").
   *  Falls back to the full `title` when omitted. The open panel always uses the
   *  full `title`. */
  collapsedTitle?: string
  side: "left" | "right"
  count?: number
  children: React.ReactNode
  defaultOpen?: boolean
  /** Stable identity for remembering open/closed across remounts (see
   *  `panelOpenState`). Usually `${entityId}:${side}`. */
  storeKey?: string
}) {
  const [open, setOpenState] = useState(() => (storeKey ? panelOpenState.get(storeKey) ?? defaultOpen : defaultOpen))
  const setOpen = (next: boolean) => {
    if (storeKey) panelOpenState.set(storeKey, next)
    setOpenState(next)
  }

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
            className={cn(
              // `flex-1 min-h-0` makes the panel fill the column's (stable) height
              // so its inner list SCROLLS. Without it the section sized to its
              // content, the tall list grew the whole columns row, and the
              // opposite side's centered rail got pushed down with it.
              "flex min-h-0 flex-1 flex-col",
              // Pull the whole open panel outward so it hugs the screen edge
              // (its header label + the per-row continuity rails sit as close to
              // the edge as the collapsed rail does — bleeding is fine).
              side === "left" ? "-ml-4" : "-mr-4",
            )}
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
              // flex-1 + justify-center makes the rail span the full column height
              // and sit at its VERTICAL MIDDLE (it used to bunch up just under the
              // dock). Hugs the outer screen edge of its slot, pulled a further
              // 20px outward (past the body's px-6) so it sits as close to the
              // edge as the timeline chrome — the left (Inputs) rail lines up
              // under the timeline's LYQ… zoom selectors and the right (Outputs)
              // rail mirrors it.
              "flex flex-1 flex-col items-center justify-center gap-3",
              side === "left" ? "-ml-5 self-start" : "-mr-5 self-end",
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
              {collapsedTitle ?? title}
              {typeof count === "number" ? `  ${count}` : ""}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
