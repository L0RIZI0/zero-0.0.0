"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react"
import { panelTransition } from "@/lib/zero/motion"
import { cn } from "@/lib/utils"

/**
 * A borderless side column that lives inside its slot. Collapsing it swaps the
 * full panel for a thin rail (aligned to the outer screen edge) with a quick
 * crossfade.
 *
 * Fully CONTROLLED: the parent (EntityBody) owns the open state — via the
 * reactive panel-store — so the open panel OVERLAYS the center column (the
 * do-list never reflows) and the nav layer can auto-collapse the panels when a
 * child window opens.
 */
export function CollapsibleColumn({
  title,
  collapsedTitle,
  side,
  count,
  children,
  open,
  onOpenChange,
}: {
  title: string
  /** Short label shown on the vertical rail when collapsed (e.g. "In" / "Out").
   *  Falls back to the full `title` when omitted. The open panel uses `title`. */
  collapsedTitle?: string
  side: "left" | "right"
  count?: number
  children: React.ReactNode
  /** Controlled open state. */
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const OpenIcon = side === "left" ? PanelLeftClose : PanelRightClose
  const ClosedIcon = side === "left" ? PanelLeftOpen : PanelRightOpen

  // Hover handled via React state (not Tailwind `group-hover:`) — the CSS hover
  // variant is gated behind `@media (hover: hover)` in Tailwind v4 and didn't
  // fire reliably here. State-driven opacity always works, like the close button.
  const [railHover, setRailHover] = useState(false)

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
              // so its inner list SCROLLS instead of growing the row.
              "flex min-h-0 flex-1 flex-col",
              // Pull the whole open panel outward so it hugs the screen edge.
              side === "left" ? "-ml-4" : "-mr-4",
            )}
          >
            <div
              className={cn(
                "mb-1 flex items-center gap-1.5 px-1",
                side === "left" ? "justify-start" : "justify-end",
              )}
            >
              {side === "left" && (
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  aria-label={`Collapse ${title}`}
                  className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground/70 transition-colors hover:bg-secondary/70 hover:text-foreground"
                >
                  <OpenIcon className="h-3.5 w-3.5" />
                </button>
              )}
              <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {title}
                {typeof count === "number" && <span className="text-muted-foreground/60">{count}</span>}
              </h2>
              {side === "right" && (
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
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
                side === "left" && "-ml-6 pl-6",
              )}
            >
              {children}
            </div>
          </motion.section>
        ) : (
          <motion.div
            key="closed"
            // The rail is centered on the window edge by its PanelSlot overlay
            // (anchored to the frame center), so it just crossfades here.
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={panelTransition}
            onPointerEnter={() => setRailHover(true)}
            onPointerLeave={() => setRailHover(false)}
            className={cn(
              // flex-1 + justify-center centers the rail VERTICALLY in its column.
              // It hugs the outer screen edge (-ml-5 / -mr-5, past the body px-6).
              // `relative z-10` lifts it ABOVE the window's opaque spine cover
              // (z-8) so an ancestor spine's real (clickable) IN/OUT rail stays
              // visible + reachable over the vertical-header strip / right peek.
              // Dimmed children rest at reduced opacity and return to full on
              // hover via `railHover` state (the motion.div animates its own
              // opacity to 1, so the resting dim lives on the inner content).
              "relative z-10 flex flex-1 flex-col items-center justify-center gap-2",
              side === "left" ? "-ml-5 self-start" : "-mr-5 self-end",
            )}
          >
            {/* Icon + vertical label render as ONE contiguous vertical line and the
                whole group is centered on the column (which now spans the full
                window body), so the shortcut sits centered on the window's
                left/right border. */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenChange(true)
              }}
              aria-label={`Expand ${title}`}
              // No hover background/box — the icon just brightens (opacity)
              // exactly like the label below it.
              className={cn(
                "flex items-center justify-center text-muted-foreground transition-opacity duration-200",
                railHover ? "text-foreground opacity-100" : "opacity-35",
              )}
            >
              <ClosedIcon className="h-3 w-3" />
            </button>
            <span
              className={cn(
                "text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70 transition-opacity duration-200",
                railHover ? "opacity-100" : "opacity-35",
              )}
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
