"use client"

import { useRef, useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react"
import { panelSlideTransition } from "@/lib/zero/motion"
import { cn } from "@/lib/utils"

/**
 * A side "shortcut" living at the window's left/right edge. The shortcut RAIL is a
 * transparent strip spanning the header bottom → window bottom, so hovering anywhere
 * near the edge lights its vertical label and clicking anywhere on it toggles the
 * panel — a big, forgiving target that never moves.
 *
 * Opening slides in an OPAQUE panel (window-surface coloured) spanning from the VISUAL
 * header bottom to the window bottom (the slot is offset to the header bottom), and
 * reaching from the window edge to `railWidth + panelWidth`. Its content column keeps a
 * `railWidth` inset so the resource icons stay exactly where they were, while the
 * per-row connector hairlines run out to the very window edge (behind the transparent
 * rail). The list is vertically centered within that band.
 *
 * Fully CONTROLLED: the parent (EntityBody) owns open state via the panel-store, so it
 * survives remounts and the nav layer can auto-collapse it.
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
  surface,
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
  /** Width (px) of the shortcut rail sliver — the window's visible edge strip and the
   *  inset the panel content keeps so its icons stay put. */
  railWidth: number
  /** Width (px) the panel adds BEYOND the rail (icons + labels area). */
  panelWidth: number
  /** Recessed scale for a covered ancestor's rail label (1 = full, uncovered). */
  railScale?: number
  /** Vertical px nudge aligning the rail label with the FRAME center (aesthetic). */
  railShift?: number
  /** Window background colour — the panel uses it so it reads as the window surface. */
  surface?: string
}) {
  const OpenIcon = side === "left" ? PanelLeftClose : PanelRightClose
  const ClosedIcon = side === "left" ? PanelLeftOpen : PanelRightOpen
  const ToggleIcon = open ? OpenIcon : ClosedIcon
  // Chevron shown IN PLACE OF the vertical label while open — points toward the window
  // edge (the collapse direction) to signal the rail still closes the panel.
  const CollapseChevron = side === "left" ? ChevronLeft : ChevronRight
  const label = collapsedTitle ?? title

  // Hover handled via React state (not Tailwind `group-hover:`) — the CSS hover
  // variant is gated behind `@media (hover: hover)` in Tailwind v4 and didn't fire
  // reliably here. State-driven opacity always works.
  const [railHover, setRailHover] = useState(false)
  // Rail label opacity: fully HIDDEN when open (the horizontal panel title names it;
  // the rail stays a clickable close-area), bright on hover, faint when idle/closed.
  const labelOpacity = open ? "opacity-0" : railHover ? "opacity-100" : "opacity-35"

  // PERSISTENT: an open panel stays open until explicitly closed via its rail (the
  // chevron toggle below). It is NOT dismissed by clicking elsewhere on the View —
  // the panel now squeezes the View aside rather than floating over it, so an outside
  // click should interact with that content, not close the panel. (The nav layer still
  // folds a parent's panels when you dive into a child; see collapseEntityPanels.)
  const rootRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={rootRef} className="relative h-full" style={{ width: railWidth }}>
      {/* CLIP — a non-transformed container anchored at the window EDGE. Its outer edge
          sits exactly at the edge so the panel, which slides in from fully OUTSIDE the
          window, is never visible past it (the entity window frame itself allows content
          to bleed, so without this the sliding panel shows outside the window). It
          extends `panelWidth + SHADOW_BLEED` inward — enough to hold the open panel and
          its inner drop-shadow uncut — and is `pointer-events-none`/transparent so it
          affects nothing else. The rail is a SIBLING (outside this clip) so it stays
          fully visible. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-y-0 overflow-hidden",
          side === "left" ? "left-0" : "right-0",
        )}
        style={{ width: railWidth + panelWidth + 48 }}
      >
        {/* PANEL — opaque overlay, window-surface coloured, spanning the full window
            height and reaching from the window EDGE (left:0) to railWidth+panelWidth.
            No rounding; a single border on the inner (View-facing) edge only. */}
        <AnimatePresence initial={false}>
          {open && (
            <motion.section
              key="panel"
              aria-label={title}
              // SLIDE + FADE. The panel travels its full width (so it lives fully off the
              // window edge when closed and glides in/out from the side) AND fades, giving
              // a soft apparition/disappearance rather than a hard edge-pop. The opacity
              // rides a slightly quicker leading curve (0.4s) so the fade reads clearly
              // within the now-longer 0.55s slide.
              initial={{ x: side === "left" ? -(railWidth + panelWidth) : railWidth + panelWidth, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: side === "left" ? -(railWidth + panelWidth) : railWidth + panelWidth, opacity: 0 }}
              transition={{ ...panelSlideTransition, opacity: { duration: 0.4, ease: "easeOut" } }}
              className={cn(
                // No shadow: the panel now SQUEEZES the View aside (EntityBody animates
                // the View's padding), so it occupies its own dedicated column and needs
                // no drop-shadow to lift off the content. Dark mode keeps a thin inner
                // edge line (below); light mode needs no separator at all.
                "pointer-events-auto absolute inset-y-0 flex min-h-0 flex-col",
                side === "left" ? "left-0" : "right-0",
              )}
              style={{
                width: railWidth + panelWidth,
                backgroundColor: surface,
                // Exposed to the asset rows so their connector hairlines can reach the
                // window edge from inside the content inset.
                ["--panel-edge-inset" as string]: `${railWidth}px`,
              }}
            >
            {/* Inner (View-facing) divider — spans the panel's full height, which now
                runs exactly header-bottom → window-bottom (the slot is offset to the
                header bottom), so the border never touches the header. */}
            <span
              aria-hidden
              className={cn(
                // Inner (View-facing) edge line. DARK mode only — whiter than the
                // standard `border` token so it reads against the dark surface. In
                // LIGHT mode it's transparent: the squeeze gives the panel its own
                // column, so no separator (border OR shadow) is needed.
                "pointer-events-none absolute inset-y-0 w-px bg-transparent dark:bg-foreground/25",
                side === "left" ? "right-0" : "left-0",
              )}
            />
            {/* HORIZONTAL title — pinned near the top of the panel (just below the header
                bottom). Its inset (`px-3` outer + `px-2` inner span = ~20px) lines the
                text up with the window HEADER content (avatar/name at paddingLeft 20),
                not the list-item icons. Softened; surface-backed so it stays legible
                over the top of a tall, scrolled list. */}
            <div
              className={cn(
                "pointer-events-none absolute top-3 z-10 flex items-center px-3",
                side === "left" ? "left-0" : "right-0",
              )}
            >
              <span
                className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-foreground opacity-60"
                style={{ backgroundColor: surface }}
              >
                {label}
                {typeof count === "number" ? ` (${count})` : ""}
              </span>
            </div>
            <div
              className={cn(
                // Symmetric `py-8`: keeps the centered list balanced while clearing the
                // horizontal title at the top so a tall/scrolled list starts below it.
                "min-h-0 flex-1 overflow-y-auto no-scrollbar px-2 py-8",
                side === "left" ? "pl-[var(--panel-edge-inset)]" : "pr-[var(--panel-edge-inset)]",
              )}
            >
              {/* `min-h-full` + `justify-center`: a short list centers in the panel;
                  a tall one grows past the container and scrolls naturally (no
                  top-clipping, unlike `justify-center` directly on the scroll box). */}
              <div className="flex min-h-full flex-col justify-center">{children}</div>
            </div>
          </motion.section>
        )}
        </AnimatePresence>
      </div>

      {/* SHORTCUT rail — a FULL-HEIGHT (inset-0) transparent strip. Clicking anywhere
          toggles; hovering anywhere lights the label. `z-20` keeps it above the panel
          (so its edge strip stays clickable) and above an ancestor's opaque spine
          cover. The label is vertically centered (nudged to frame center by
          railShift) and kept when open. */}
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
        className="pointer-events-auto absolute inset-0 z-20 flex flex-col items-center justify-center gap-2"
      >
        <span
          className="flex flex-col items-center gap-2"
          style={{ transform: `translateY(${railShift}px) scale(${railScale})` }}
        >
          {open ? (
            /* OPEN: the vertical label + panel-toggle icon are hidden (the horizontal
               panel title carries the identity); a single collapse chevron pointing at
               the window edge indicates the rail still closes the panel. */
            <CollapseChevron
              className={cn(
                "h-4 w-4 transition-opacity duration-200",
                railHover ? "text-foreground opacity-100" : "text-muted-foreground opacity-45",
              )}
            />
          ) : (
            <>
              <ToggleIcon
                className={cn(
                  "h-3 w-3 transition-opacity duration-200",
                  railHover ? "text-foreground opacity-100" : "text-muted-foreground opacity-35",
                )}
              />
              <span
                className={cn(
                  "text-[10px] font-medium uppercase tracking-[0.14em] text-foreground transition-opacity duration-200",
                  labelOpacity,
                )}
                style={{ writingMode: "vertical-rl" }}
              >
                {label}
                {typeof count === "number" ? ` (${count})` : ""}
              </span>
            </>
          )}
        </span>
      </button>
    </div>
  )
}
