"use client"

import { useRef, useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react"
import { panelSlideTransition, MORPH_SECONDS, MORPH_EASE } from "@/lib/zero/motion"
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
  excerpt,
  open,
  onOpenChange,
  focused = true,
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
  /** Optional summary pinned to the TOP of the rail (e.g. the entity excerpt
   *  counters). Stays visible whether the panel is open or collapsed, and is
   *  horizontally centered on the rail so it aligns with the vertical label below. */
  excerpt?: React.ReactNode
  /** Controlled open state. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Whether this panel's entity is the FOCUSED front view. When false (an ancestor
   *  with one or more children open), the open-state collapse chevron is hidden — the
   *  rail stays a clickable close-area but shows no glyph until the entity is refocused. */
  focused?: boolean
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

  // Animate the rail WIDTH change. `railWidth` = the window's visible edge bleed, which
  // flips from the full width (uncovered leaf/home) to a narrow peek the moment a child
  // opens and this window becomes a covered ancestor. The label is centered within this
  // width, so a raw width jump snapped the label toward the edge. Tweening the width over
  // the SAME timing as the window morph (MORPH_SECONDS + MORPH_EASE) makes the label glide
  // to its ancestor position IN STEP with the incoming child's morph instead of jumping —
  // and MORPH_EASE's slow lead-in means the rail holds and then slides out roughly as the
  // covering window arrives, which is the "wait for the window to reach it" feel. Only
  // `width` transitions (height/others stay instant). No animation on first mount (a CSS
  // transition fires only on subsequent value changes).
  const widthTransition = `width ${MORPH_SECONDS}s cubic-bezier(${MORPH_EASE.join(",")})`

  // PEEK MODE: the panel is open AND its entity is a covered ancestor (a child is
  // focused). The child's AssetPanel/OutputPanel collapses its resources into small
  // losanges on this window's peek strip.
  const peek = open && !focused
  // The content inset (`--panel-edge-inset`, the scroller `pl`/`pr`) is FROZEN at the
  // open rail width during peek. It's a CSS custom property, which is NOT smoothly
  // animatable — so letting it follow `railWidth` (which shrinks to the bleed the moment
  // a child opens) made the whole panel content JUMP left. Freezing it means zero layout
  // change on peek-in; the losanges instead travel purely via transform (measured against
  // this constant inset in asset-panel), which is smooth. `RAIL_OPEN_W` matches the
  // focused-open bleed (EntityBody's PANEL_RAIL_W), so freezing = no change at the flip.
  const RAIL_OPEN_W = 48
  const contentInset = peek ? RAIL_OPEN_W : railWidth

  return (
    <div ref={rootRef} className="relative h-full" style={{ width: railWidth, transition: widthTransition }}>
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
        style={{ width: railWidth + panelWidth + 48, transition: widthTransition }}
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
                // NO backgroundColor: the panel is TRANSPARENT. Previously it was painted
                // with the window's `surface` colour, but that colour went STALE after a
                // child closed (the panel kept the child's surface, showing as a wrong-tone
                // rectangle). Since the panel now SQUEEZES the View aside into its own
                // dedicated empty column (EntityBody animates the View padding), it needs no
                // fill — the uniform app background shows through and always reads correctly.
                // Exposed to the asset rows so their connector hairlines can reach the
                // window edge from inside the content inset. FROZEN in peek (see above).
                ["--panel-edge-inset" as string]: `${contentInset}px`,
              }}
            >
            {/* No inner divider in EITHER theme: the squeeze gives the panel its own
                dedicated column, so it reads as separate from the View without any
                border or shadow. (Kept the empty branch removed entirely.) */}
            {/* The HORIZONTAL panel title was REMOVED entirely per user — an open panel
                shows no title label at all; identity is carried by the entity's own
                header + the vertical rail label when collapsed. */}
            <div
              className={cn(
                // Symmetric `py-8`: keeps the centered list balanced while clearing the
                // horizontal title at the top so a tall/scrolled list starts below it.
                "min-h-0 flex-1 overflow-y-auto no-scrollbar px-2 py-8",
                side === "left" ? "pl-[var(--panel-edge-inset)]" : "pr-[var(--panel-edge-inset)]",
              )}
              style={{
                // Visible in peek so the collapsed losanges paint onto the narrow peek
                // strip without horizontal clipping; normal auto-scroll otherwise.
                overflow: peek ? "visible" : undefined,
              }}
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
        className={cn(
          "absolute inset-0 z-20 flex flex-col items-center justify-center gap-2",
          // In PEEK the rail sits ON TOP of the peek losanges (z-20, sibling of the panel
          // clip) and would intercept their hover — the losange's own z-30 is trapped
          // inside the panel's local stacking context, below this rail. So drop the rail's
          // pointer events in peek: hover falls THROUGH to the losanges behind it. The
          // rail's toggle isn't needed on a covered ancestor anyway (focus is on the
          // child); it's restored the moment the entity is refocused (peek → false).
          peek ? "pointer-events-none" : "pointer-events-auto",
        )}
      >
        <span
          className="flex flex-col items-center gap-2"
          style={{ transform: `translateY(${railShift}px) scale(${railScale})` }}
        >
          {open ? (
            /* OPEN: the vertical label + panel-toggle icon are hidden. A single collapse
               chevron pointing at the window edge indicates the rail still closes the
               panel — but only while this entity is the FOCUSED front view. Once one or
               more children are open (this becomes an ancestor), the chevron FADES OUT
               (it stays mounted so the opacity can transition, rather than unmounting and
               vanishing instantly); the rail stays clickable but glyph-less until the
               entity is refocused. A longer 500ms fade makes the appearance/disappearance
               gentle rather than a snap. */
            <CollapseChevron
              className={cn(
                "h-4 w-4 transition-opacity duration-500",
                !focused
                  ? "text-muted-foreground opacity-0"
                  : railHover
                    ? "text-foreground opacity-100"
                    : "text-muted-foreground opacity-45",
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

      {/* EXCERPT — pinned to the TOP of the rail, centered on `railWidth` so it lines up
          with the vertical label directly below it. Rendered AFTER the rail button so it
          paints above, but `pointer-events-none` lets clicks fall through to the button
          (the whole rail stays a forgiving toggle target). Unlike the label, it stays
          visible whether the panel is open or collapsed — so when the panel expands and
          squeezes the View aside, the counters remain in place at the top-left of the
          View. Nudged horizontally by `railShift`-free centering; it uses the rail's own
          width for centering (matching the label). */}
      {excerpt && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center pt-3">
          {excerpt}
        </div>
      )}
    </div>
  )
}
