"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react"
import { panelSlideTransition } from "@/lib/zero/motion"
import { cn } from "@/lib/utils"

/**
 * A side "shortcut" that lives at the window's left/right edge. The shortcut RAIL
 * (icon + vertical label) is ALWAYS visible and stays in place; clicking it toggles
 * an opaque PANEL that slides in over the View from that edge. Clicking the rail
 * again closes it — the shortcut never moves, so open/close is a single target.
 *
 * The panel is an OVERLAY (absolute, pointer-events re-enabled) that sits beside the
 * rail and covers the View content; it never reflows the center column. Fully
 * CONTROLLED: the parent (EntityBody) owns the open state via the reactive
 * panel-store, so it survives remounts and the nav layer can auto-collapse it.
 */
export function CollapsibleColumn({
  title,
  collapsedTitle,
  side,
  count,
  children,
  open,
  onOpenChange,
  railWidth,
  panelWidth,
  railScale = 1,
  railShift = 0,
}: {
  title: string
  /** Short label shown on the vertical rail. Falls back to `title` when omitted. */
  collapsedTitle?: string
  side: "left" | "right"
  count?: number
  children: React.ReactNode
  /** Controlled open state. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Width (px) of the persistent shortcut rail — the window's visible edge sliver. */
  railWidth: number
  /** Width (px) of the opaque panel that slides in beside the rail. */
  panelWidth: number
  /** Recessed scale for a covered ancestor's rail sliver (1 = full, uncovered). */
  railScale?: number
  /** Vertical px offset that centers the rail on the FRAME (not the body) center.
   *  Applied to the rail ONLY — the panel fills the full body height regardless. */
  railShift?: number
}) {
  const OpenIcon = side === "left" ? PanelLeftClose : PanelRightClose
  const ClosedIcon = side === "left" ? PanelLeftOpen : PanelRightOpen
  const ToggleIcon = open ? OpenIcon : ClosedIcon
  const label = collapsedTitle ?? title

  // Hover handled via React state (not Tailwind `group-hover:`) — the CSS hover
  // variant is gated behind `@media (hover: hover)` in Tailwind v4 and didn't
  // fire reliably here. State-driven opacity always works, like the close button.
  const [railHover, setRailHover] = useState(false)
  const lit = railHover || open

  return (
    <div className="relative h-full" style={{ width: railWidth }}>
      {/* PANEL — opaque overlay that fills the body's FULL height (header bottom →
          window bottom) and extends over the View from just INSIDE the rail. Snappy
          slide in from the edge; square top/bottom so it reaches both edges flush. */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.section
            key="panel"
            aria-label={title}
            initial={{ opacity: 0, x: side === "left" ? -16 : 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: side === "left" ? -16 : 16 }}
            transition={panelSlideTransition}
            className={cn(
              "pointer-events-auto absolute inset-y-0 flex min-h-0 flex-col border-border bg-card shadow-xl",
              // Flush top & bottom; border + rounding only on the inner (View-facing) edge.
              side === "left" ? "rounded-r-lg border-y border-r" : "rounded-l-lg border-y border-l",
            )}
            style={{
              width: panelWidth,
              ...(side === "left" ? { left: railWidth } : { right: railWidth }),
            }}
          >
            <div
              className={cn(
                "flex shrink-0 items-center gap-1.5 px-3 pb-1 pt-3",
                side === "left" ? "justify-start" : "justify-end",
              )}
            >
              <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {title}
                {typeof count === "number" && <span className="text-muted-foreground/60">{count}</span>}
              </h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 no-scrollbar">{children}</div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* SHORTCUT rail — always in place, toggles the panel. Absolutely centered on the
          FRAME (top-1/2 + railShift), lifted `z-20` ABOVE the panel + any ancestor's
          opaque spine cover so it stays reachable. Icon flips (open⇄close) to signal
          state; the vertical label is HIDDEN while open (the panel header already names
          it), leaving just the icon as the close target. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpenChange(!open)
        }}
        onPointerEnter={() => setRailHover(true)}
        onPointerLeave={() => setRailHover(false)}
        aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
        aria-expanded={open}
        className="pointer-events-auto absolute inset-x-0 top-1/2 z-20 flex flex-col items-center justify-center gap-2"
        style={{ transform: `translateY(calc(-50% + ${railShift}px)) scale(${railScale})` }}
      >
        <ToggleIcon
          className={cn(
            "h-3 w-3 transition-opacity duration-200",
            lit ? "text-foreground opacity-100" : "text-muted-foreground opacity-35",
          )}
        />
        {!open && (
          <span
            className={cn(
              "text-[10px] font-medium uppercase tracking-[0.14em] transition-opacity duration-200",
              lit ? "text-foreground opacity-100" : "text-muted-foreground/70 opacity-35",
            )}
            style={{ writingMode: "vertical-rl" }}
          >
            {label}
            {typeof count === "number" ? `  ${count}` : ""}
          </span>
        )}
      </button>
    </div>
  )
}
