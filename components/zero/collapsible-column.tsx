"use client"

import { useRef, useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react"
import { panelSlideTransition, MORPH_SECONDS, MORPH_EASE, HEADER_H } from "@/lib/zero/motion"
import { cn } from "@/lib/utils"

/** How far UP the spine glyph/title slide when hiding. The crop box top sits on the
 *  View's top edge (= the header's BOTTOM edge), so anything above it is clipped; this
 *  distance (~a full header height) carries them up to the user AVATAR level inside the
 *  header before they vanish, instead of tucking just behind the edge. */
const SPINE_HIDE_Y = HEADER_H + 12

/**
 * A side "shortcut" living at the window's left/right edge. The shortcut RAIL is a
 * transparent strip spanning the header bottom → window bottom, so hovering anywhere
 * near the edge lights its vertical label and clicking anywhere on it toggles the
 * panel — a big, forgiving target that never moves.
 *
 * Opening slides in an OPAQUE panel (window-surface coloured) spanning from the VISUAL
 * header bottom to the window bottom (the slot is offset to the header bottom), and
 * reaching from the window edge to `spineWidth + panelWidth`. Its content column keeps a
 * `spineWidth` inset so the resource icons stay exactly where they were, while the
 * per-row connector hairlines run out to the very window edge (behind the transparent
 * spine). The list is vertically centered within that band.
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
  spineWidth,
  panelWidth,
  spineScale = 1,
  spineShift = 0,
  spineTitle,
  spineGlyph,
  surface,
  stripCollapse = false,
  forceExpanded = false,
  onSpineExpandToggle,
}: {
  title: string
  /** Short label shown on the vertical spine. Falls back to `title` when omitted. */
  collapsedTitle?: string
  side: "left" | "right"
  count?: number
  children: React.ReactNode
  /** Optional summary pinned to the TOP of the spine (e.g. the entity excerpt
   *  counters). Stays visible whether the panel is open or collapsed, and is
   *  horizontally centered on the spine so it aligns with the vertical label below. */
  excerpt?: React.ReactNode
  /** Controlled open state. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Whether this panel's entity is the FOCUSED front view. When false (an ancestor
   *  with one or more children open), the open-state collapse chevron is hidden — the
   *  spine stays a clickable close-area but shows no glyph until the entity is refocused. */
  focused?: boolean
  /** Width (px) of the shortcut spine sliver — the window's visible edge strip and the
   *  inset the panel content keeps so its icons stay put. */
  spineWidth: number
  /** Width (px) the panel adds BEYOND the spine (icons + labels area). */
  panelWidth: number
  /** Recessed scale for a covered ancestor's spine label (1 = full, uncovered). */
  spineScale?: number
  /** Vertical px nudge aligning the spine label with the FRAME center (aesthetic). */
  spineShift?: number
  /** When set, this is a covered SPACE ancestor: render its title ROTATED (reading
   *  bottom-to-top) at the top of the spine, directly below the glyph and ABOVE the
   *  excerpt. The title occupies real vertical layout height (writing-mode), so the
   *  excerpt flows naturally beneath it — no measurement/offset coordination. It slides
   *  in from the top + fades as a leaf becomes a spine, and the excerpt reflows down. */
  spineTitle?: string
  /** Optional GLYPH rendered at the very TOP of the spine, ABOVE the rotated title.
   *  Slides in with the same height-crop + translateY as the title (so it emerges from
   *  behind the View's top edge as a leaf becomes a spine). The caller owns its size +
   *  vertical padding so it lands the SAME size as / aligned with the covering child's
   *  header glyph (used by entity0/home to show the Individual's glyph). */
  spineGlyph?: React.ReactNode
  /** Window background colour — the panel uses it so it reads as the window surface. */
  surface?: string
  /** When true, the COLLAPSED state of this (focused) panel is the peek-LOSANGE strip
   *  rather than the vertical label — i.e. the losanges are the always-present collapsed
   *  affordance on the spine of a focused leaf. Collapsing morphs the open list INTO the
   *  losanges (the panel content stays mounted while collapsed and switches to strip mode);
   *  clicking the empty band re-expands. Only used on the LEFT Resources spine for now. */
  stripCollapse?: boolean
  /** COVERED-ANCESTOR spine-expand: force the FULL list (not the peek strip) even though
   *  this ancestor isn't focused. Set by EntityBody when the user has spine-expanded this
   *  ancestor (its covering child has slid right to uncover the panel). */
  forceExpanded?: boolean
  /** Toggle handler for a COVERED ANCESTOR's spine-expand: clicking the empty peek band of
   *  a covered stripCollapse ancestor calls this instead of `onOpenChange`, so the band
   *  drives the nav-store spine-expand (which squeezes the child) rather than the local
   *  panel-store open flag. Undefined on a focused leaf (there the band uses onOpenChange). */
  onSpineExpandToggle?: () => void
}) {
  const OpenIcon = side === "left" ? PanelLeftClose : PanelRightClose
  const ClosedIcon = side === "left" ? PanelLeftOpen : PanelRightOpen
  const ToggleIcon = open ? OpenIcon : ClosedIcon
  // Chevron shown IN PLACE OF the vertical label while open — points toward the window
  // edge (the collapse direction) to signal the spine still closes the panel.
  const CollapseChevron = side === "left" ? ChevronLeft : ChevronRight
  const label = collapsedTitle ?? title

  // Hover handled via React state (not Tailwind `group-hover:`) — the CSS hover
  // variant is gated behind `@media (hover: hover)` in Tailwind v4 and didn't fire
  // reliably here. State-driven opacity always works.
  const [spineHover, setRailHover] = useState(false)
  // Spine label opacity: fully HIDDEN when open (the horizontal panel title names it;
  // the spine stays a clickable close-area) OR in leaf-strip mode (the losanges are the
  // collapsed affordance — no vertical label), bright on hover, faint when idle/closed.
  const labelOpacity = open ? "opacity-0" : spineHover ? "opacity-100" : "opacity-35"

  // PERSISTENT: an open panel stays open until explicitly closed via its spine (the
  // chevron toggle below). It is NOT dismissed by clicking elsewhere on the View —
  // the panel now squeezes the View aside rather than floating over it, so an outside
  // click should interact with that content, not close the panel. (The nav layer still
  // folds a parent's panels when you dive into a child; see collapseEntityPanels.)
  const rootRef = useRef<HTMLDivElement>(null)

  // Animate the spine WIDTH change. `spineWidth` = the window's visible edge bleed, which
  // flips from the full width (uncovered leaf/home) to a narrow peek the moment a child
  // opens and this window becomes a covered ancestor. The label is centered within this
  // width, so a raw width jump snapped the label toward the edge. Tweening the width over
  // the SAME timing as the window morph (MORPH_SECONDS + MORPH_EASE) makes the label glide
  // to its ancestor position IN STEP with the incoming child's morph instead of jumping —
  // and MORPH_EASE's slow lead-in means the spine holds and then slides out roughly as the
  // covering window arrives, which is the "wait for the window to reach it" feel. Only
  // `width` transitions (height/others stay instant). No animation on first mount (a CSS
  // transition fires only on subsequent value changes).
  const widthTransition = `width ${MORPH_SECONDS}s cubic-bezier(${MORPH_EASE.join(",")})`

  // LEAF STRIP: the collapsed state of a FOCUSED, stripCollapse panel — the losanges are
  // the always-present collapsed affordance on this leaf's spine (no vertical label). The
  // panel content stays MOUNTED while collapsed (so the list⇄losanges morph runs); it's in
  // "strip" mode: only the losanges + hairlines show, the rest fades. Distinct from the
  // covered-ancestor peek below, but shares the same losange transform machinery.
  const leafStrip = stripCollapse && focused && !open
  // PEEK MODE: the losanges sit on the spine strip.
  //   • stripCollapse panel (Resources): the collapsed affordance is ALWAYS the losanges, so
  //     peek is EVERYTHING that isn't the focused-open full list — the focused-collapsed leaf
  //     AND any covered ancestor, whether open OR manually collapsed. (Keying off `open` here
  //     left a manually-collapsed ancestor with no losanges → it fell back to the vertical
  //     label, the unwanted 3rd state.)
  //   • non-stripCollapse panel (e.g. right Published): unchanged — peek only for a COVERED
  //     ANCESTOR whose panel is open (`open && !focused`).
  // `forceExpanded` (a spine-expanded covered ancestor) forces the FULL list — never the
  // peek strip — so its panel body shows in the gap the squeezed child opened.
  const peek = forceExpanded ? false : stripCollapse ? !(focused && open) : open && !focused
  // COVERED-ANCESTOR PEEK: a stripCollapse ancestor (not focused, so not a leaf strip). Its
  // spine band is the SPINE-EXPAND toggle target — clicking it expands/collapses this
  // ancestor's panel (squeezing the child), NOT the local open flag. True in BOTH its
  // collapsed peek and its `forceExpanded` full state (so the band can collapse it back).
  const coveredAncestorPeek = stripCollapse && !focused && !leafStrip
  // The content inset (`--panel-edge-inset`, the scroller `pl`/`pr`) is FROZEN at the
  // open spine width during peek. It's a CSS custom property, which is NOT smoothly
  // animatable — so letting it follow `spineWidth` (which shrinks to the bleed the moment
  // a child opens) made the whole panel content JUMP left. Freezing it means zero layout
  // change on peek-in; the losanges instead travel purely via transform (measured against
  // this constant inset in asset-panel), which is smooth. `SPINE_OPEN_W` matches the
  // focused-open bleed (EntityBody's PANEL_SPINE_W), so freezing = no change at the flip.
  const SPINE_OPEN_W = 48
  const contentInset = peek ? SPINE_OPEN_W : spineWidth

  return (
    <div ref={rootRef} className="relative h-full" style={{ width: spineWidth, transition: widthTransition }}>
      {/* CLIP — a non-transformed container anchored at the window EDGE. Its outer edge
          sits exactly at the edge so the panel, which slides in from fully OUTSIDE the
          window, is never visible past it (the entity window frame itself allows content
          to bleed, so without this the sliding panel shows outside the window). It
          extends `panelWidth + SHADOW_BLEED` inward — enough to hold the open panel and
          its inner drop-shadow uncut — and is `pointer-events-none`/transparent so it
          affects nothing else. The spine is a SIBLING (outside this clip) so it stays
          fully visible. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-y-0 overflow-hidden",
          side === "left" ? "left-0" : "right-0",
          // LEAF STRIP and COVERED-ANCESTOR PEEK: lift the clip ABOVE the spine button
          // (z-20) so the losanges (their tile is pointer-events-auto) sit on top and
          // intercept their own pointer events. The section itself is pointer-events-none in
          // these modes, so the EMPTY band area falls through to the spine button below → a
          // band click expands (leaf) or spine-expands the ancestor (covered ancestor).
          leafStrip || coveredAncestorPeek ? "z-40" : "z-0",
        )}
        style={{ width: spineWidth + panelWidth + 48, transition: widthTransition }}
      >
        {/* PANEL — opaque overlay, window-surface coloured, spanning the full window
            height and reaching from the window EDGE (left:0) to spineWidth+panelWidth.
            No rounding; a single border on the inner (View-facing) edge only. */}
        <AnimatePresence initial={false}>
          {/* Mount whenever open OR in any peek state. `peek` now includes a covered ancestor
              that was manually collapsed (open=false) — it must still mount to paint its peek
              losanges. `leafStrip ⊂ peek`, and non-stripCollapse peek implies open, so this is
              a safe superset of the old `(open || leafStrip)`. */}
          {(open || peek) && (
            <motion.section
              key="panel"
              aria-label={title}
              // SLIDE + FADE for a normal open/close. The panel travels its full width (so
              // it lives fully off the window edge when closed and glides in/out from the
              // side) AND fades. BUT in `stripCollapse` mode the panel NEVER slides off —
              // it stays mounted at x:0 in BOTH the open (full list) and collapsed (losange
              // strip) states; the open⇄collapsed change is carried entirely by the
              // list⇄losange morph inside AssetPanel (driven by `peek`), not by the panel
              // sliding. So pin x:0 / opacity:1 whenever stripCollapse.
              initial={
                stripCollapse
                  ? { x: 0, opacity: 1 }
                  : { x: side === "left" ? -(spineWidth + panelWidth) : spineWidth + panelWidth, opacity: 0 }
              }
              animate={{ x: 0, opacity: 1 }}
              exit={
                stripCollapse
                  ? { x: 0, opacity: 1 }
                  : { x: side === "left" ? -(spineWidth + panelWidth) : spineWidth + panelWidth, opacity: 0 }
              }
              transition={{ ...panelSlideTransition, opacity: { duration: 0.4, ease: "easeOut" } }}
              className={cn(
                // No shadow: the panel now SQUEEZES the View aside (EntityBody animates
                // the View's padding), so it occupies its own dedicated column and needs
                // no drop-shadow to lift off the content. Dark mode keeps a thin inner
                // edge line (below); light mode needs no separator at all.
                "absolute inset-y-0 flex min-h-0 flex-col",
                side === "left" ? "left-0" : "right-0",
                // LEAF STRIP and COVERED-ANCESTOR PEEK: transparent to pointer events so
                // clicks on the empty band fall through to the spine button (→ expand /
                // spine-expand). The losange tiles re-enable their own pointer events.
                // Otherwise (focused open panel) it is fully interactive.
                leafStrip || coveredAncestorPeek ? "pointer-events-none" : "pointer-events-auto",
              )}
              style={{
                width: spineWidth + panelWidth,
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
                header + the vertical spine label when collapsed. */}
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

      {/* SHORTCUT spine — a FULL-HEIGHT (inset-0) transparent strip. Clicking anywhere
          toggles; hovering anywhere lights the label. `z-20` keeps it above the panel
          (so its edge strip stays clickable) and above an ancestor's opaque spine
          cover. The label is vertically centered (nudged to frame center by
          spineShift) and kept when open. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          // COVERED-ANCESTOR PEEK: the band drives the nav-store SPINE-EXPAND (bloom the
          // full panel + squeeze the covering child), toggling on each click. Everywhere
          // else (focused leaf) it toggles the local panel-store open flag as before.
          if (coveredAncestorPeek) onSpineExpandToggle?.()
          else onOpenChange(!open)
        }}
        onPointerEnter={() => setRailHover(true)}
        onPointerLeave={() => setRailHover(false)}
        aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
        aria-expanded={open}
        className={cn(
          "absolute inset-0 z-20 flex flex-col items-center justify-center gap-2",
          // In the COVERED-ANCESTOR peek the spine sits ON TOP of the peek losanges (z-20,
          // sibling of the panel clip) and would intercept their hover — the losange's own
          // z-30 is trapped inside the panel's local stacking context, below this spine. So
          // drop the spine's pointer events there: hover falls THROUGH to the losanges. The
          // toggle isn't needed on a covered ancestor anyway (focus is on the child).
          // In LEAF STRIP the opposite: the spine button IS the expand target for the empty
          // band, so it MUST stay clickable — the clip is lifted to z-40 above it so the
          // losanges still win their own hits. So only disable for a NON-stripCollapse
          // covered-ancestor peek (e.g. right Published). A stripCollapse covered ancestor
          // (`coveredAncestorPeek`) NOW keeps the band clickable — it is the spine-expand
          // toggle — with its clip lifted to z-40 so the losanges still win their own hits.
          peek && !leafStrip && !coveredAncestorPeek ? "pointer-events-none" : "pointer-events-auto",
        )}
      >
        <span
          className={cn(
            "flex flex-col items-center gap-2 transition-opacity duration-200",
            // LEAF STRIP: the losanges ARE the collapsed affordance, so hide the toggle
            // glyph + vertical label entirely (the band stays a clickable expand target).
            leafStrip && "opacity-0",
          )}
          // `spineShift` re-centers the label on the body center. Applied INSTANTLY: leaf
          // and spine now share the same −headerH/2 shift, so it doesn't change on a
          // leaf↔spine flip — nothing to snap, no transition needed.
          style={{ transform: `translateY(${spineShift}px) scale(${spineScale})` }}
        >
          {open ? (
            /* OPEN: the vertical label + panel-toggle icon are hidden. A single collapse
               chevron pointing at the window edge indicates the spine still closes the
               panel — but only while this entity is the FOCUSED front view. Once one or
               more children are open (this becomes an ancestor), the chevron FADES OUT
               (it stays mounted so the opacity can transition, rather than unmounting and
               vanishing instantly); the spine stays clickable but glyph-less until the
               entity is refocused. A longer 500ms fade makes the appearance/disappearance
               gentle rather than a snap. */
            <CollapseChevron
              className={cn(
                "h-4 w-4 transition-opacity duration-500",
                !focused
                  ? "text-muted-foreground opacity-0"
                  : spineHover
                    ? "text-foreground opacity-100"
                    : "text-muted-foreground opacity-45",
              )}
            />
          ) : stripCollapse ? (
            /* STRIP-COLLAPSE: the collapsed affordance is the peek LOSANGES, so the spine
               shows NEITHER the toggle icon NOR the vertical label — ever. (Rendering them
               here would let the "RESOURCES (n)" label briefly FLASH during the collapse
               transition, since `open` flips false one frame before the parent span fades
               out.) The band stays a clickable expand target with no glyph. */
            null
          ) : (
            <>
              <ToggleIcon
                className={cn(
                  "h-3 w-3 transition-opacity duration-200",
                  spineHover ? "text-foreground opacity-100" : "text-muted-foreground opacity-35",
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

      {/* SPINE BAND — the entity's content summary, pinned to the TOP of the spine and
          centered on `spineWidth` (aligning with the vertical label below). Rendered AFTER
          the spine button so it paints above, but `pointer-events-none` lets clicks fall
          through to the toggle. Stays visible whether the panel is open or collapsed, so
          the counters remain in the View's top-left as the panel squeezes the View aside.

          A flex COLUMN pinned at `top-0`, which sits EXACTLY on the View's top edge (the
          body content top). The band itself has NO top padding, so the rotated title is
          FLUSH to that edge with no gap.

          As a leaf becomes a spine the rotated title SLIDES DOWN from BEHIND the View's top
          edge: its crop box (`overflow-hidden`, top pinned on the View edge) animates HEIGHT
          0→auto — which both reflows the excerpt DOWN by plain layout AND provides the crop —
          while the inner span animates translateY −100%→0 so the title travels down out of
          the hidden region above the edge and lands flush, cropped by that top edge the whole
          way (no fade). Reverse (spine→leaf): it slides back UP behind the edge and the
          excerpt pulls back up. The excerpt carries its OWN `pt-3`, constant in both states,
          so the leaf counters keep their spacing and nothing snaps on the flip. The glyph
          keeps its own (untouched) Flip morph in the header above; the horizontal title is
          left untouched there too. */}
      {(excerpt || spineTitle || spineGlyph) && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col items-center">
          {/* SPINE HEAD = glyph + rotated title as ONE block. A SINGLE crop box (top pinned
              on the View's top edge = header's bottom edge, overflow-hidden) animates HEIGHT
              0↔auto (which also reflows the excerpt), and a SINGLE inner layer slides+fades
              as a unit — so the title is never clipped by the glyph's box. Hidden state
              translates the whole block UP by SPINE_HIDE_Y (~header height → user-avatar
              level) so it tucks behind the header rather than just behind the dayline. */}
          <AnimatePresence initial={false}>
            {(spineGlyph || spineTitle) && (
              <motion.div
                key="spine-head"
                initial={{ height: 0 }}
                animate={{ height: "auto" }}
                exit={{ height: 0 }}
                transition={{ duration: MORPH_SECONDS, ease: MORPH_EASE }}
                // BOTTOM-anchored (`justify-end`): as the height animates 0↔auto, the block
                // sticks to the box's BOTTOM edge and any overflow is clipped at the TOP (the
                // header edge) only. Top-anchoring instead let the box's GROWING BOTTOM edge
                // slice through the block, cropping the bottom of the username mid-animation.
                className="flex flex-col items-center justify-end overflow-hidden"
              >
                <motion.div
                  initial={{ y: -SPINE_HIDE_Y, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -SPINE_HIDE_Y, opacity: 0 }}
                  transition={{ duration: MORPH_SECONDS, ease: MORPH_EASE }}
                  className="flex flex-col items-center"
                >
                  {spineGlyph}
                  {spineTitle && (
                    <span
                      // sideways-lr = upright, reading bottom-to-top. Regular 13px / medium
                      // weight to match the horizontal title.
                      className="inline-block whitespace-nowrap text-[13px] font-medium tracking-tight text-foreground"
                      style={{ writingMode: "sideways-lr" }}
                    >
                      {spineTitle}
                    </span>
                  )}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
          {excerpt && <div className="pt-3">{excerpt}</div>}
        </div>
      )}
    </div>
  )
}
