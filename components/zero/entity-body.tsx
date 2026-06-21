"use client"

import { motion } from "motion/react"
import { getSpaceAssets } from "@/lib/zero/data"
import { panelTransition } from "@/lib/zero/motion"
import { usePanelOpen } from "@/lib/zero/panel-store"
import { Dock } from "./dock"
import { DoList } from "./do-list"
import { AssetPanel } from "./asset-panel"
import { OutputPanel } from "./output-panel"
import { CollapsibleColumn } from "./collapsible-column"
import { cn } from "@/lib/utils"

/** Width of a side panel when OPEN, and of the thin RAIL when collapsed. */
const PANEL_OPEN_W = 230
const PANEL_RAIL_W = 48

/**
 * An entity's working surface: its Tasks do-list + Dock (center), with the
 * Inputs / Outputs side panels OVERLAID on the left/right edges.
 *
 * Panels are an absolute overlay anchored to the FRAME's vertical center, not to
 * the body. `entity-node` measures the only thing that varies — the in-flow
 * header — and hands us `--rail-center-shift` (0 for floating/space headers,
 * `-headerH/2` for in-flow task/event headers). The overlay sits at
 * `calc(50% + var(--rail-center-shift))`, so the rails land on the true middle of
 * the window's left/right edges at ANY depth, and never jump when a child opens
 * and this window's ancestor rank (and header height) changes.
 *
 * Open panels OVERLAY the content — they do not reflow the center column — so the
 * do-list stays perfectly still whether the panels are open, closed, or mid-
 * animation. Panel state lives in the reactive panel-store so it survives the
 * remounts that happen as windows open/close, and so the nav layer can fold it.
 */
export function EntityBody({
  entityId,
  active = true,
  isRoot = false,
  closing = false,
  centerList = true,
  floatDock = false,
  railShift = 0,
  railBleedLeft = PANEL_RAIL_W,
  railBleedRight = PANEL_RAIL_W,
}: {
  entityId: string
  active?: boolean
  /** Forwarded to the DoList so it can keep its scroller clipped during this
   *  window's close morph (prevents the ADD row jumping up over the title). */
  closing?: boolean
  /** Vertical px offset that re-centers the rails on the FRAME center (0 when the
   *  body fills the frame; −headerH/2 for an in-flow header). ANIMATED, so the
   *  rails slide as a window's header changes (e.g. ancestor → spine). */
  railShift?: number
  /** Collapsed-rail width per side = the visible bleed strip of this window once a
   *  child covers it, so the rail centers within that sliver instead of clipping at
   *  the frame edge. Defaults to the full rail (leaf / home root, uncovered). */
  railBleedLeft?: number
  railBleedRight?: number
  /** Space-leaf only: float the Dock OUT of the do-list's flex column (absolute,
   *  into the hexagon's bottom triangle) so the do-list always fills the full
   *  central rectangle regardless of how many items are pinned. When false (home
   *  root, ancestors, task/event windows) the Dock stays in flow beneath the list. */
  floatDock?: boolean
  /** Vertically center the do-list within its column (forwarded to DoList). */
  centerList?: boolean
  /** The always-mounted home view. Its body has no in-flow header, so its rails
   *  center on the region directly (`--rail-center-shift` defaults to 0). Kept as
   *  a flag only to widen the central reading measure on the home view. */
  isRoot?: boolean
}) {
  const assetCount = getSpaceAssets(entityId).length
  const [inOpen, setInOpen] = usePanelOpen(`${entityId}:in`, false)
  const [outOpen, setOutOpen] = usePanelOpen(`${entityId}:out`, false)

  return (
    // Unpadded root: fills [data-body] EXACTLY and is the offset parent for the
    // panel overlays, so a panel's `top: 50%` resolves to the body's true vertical
    // center. The reading padding lives on the inner center column instead, so it
    // never skews where the rails sit.
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Center column — Tasks do-list ABOVE the Dock (pinned items). The list
          takes the remaining height (flex-1); the Dock sits beneath it. Capped for
          a comfortable reading measure and centered. Full width now: the side
          panels overlay it rather than stealing its space, so it never moves. */}
      <div className="flex min-h-[180px] min-w-0 flex-1 flex-col items-center px-6 pb-5 pt-4">
        <div className={cn("relative flex min-h-0 w-full flex-1 flex-col", isRoot ? "max-w-[70vw]" : "max-w-[720px]")}>
          {/* Do-list narrowed to 2/3 of the measure and centered for a tighter
              list; the Dock below keeps the full measure width. */}
          <div className="flex min-h-0 w-2/3 flex-1 flex-col self-center">
            <DoList contextId={entityId} active={active} closing={closing} centered={centerList} />
          </div>
          {floatDock ? (
            /* SPACE LEAF: pull the Dock OUT of the do-list flex column and pin it
               just below the central rectangle (top:100%), nudged down into the
               hexagon's bottom triangle. Freed of flex height, the do-list always
               spans the full central rectangle, so it centers identically whether
               or not items are pinned. The lift scales with the hexagon corner
               inset; no transforms (so GSAP Flip never sees it). */
            <div
              className="absolute inset-x-0 flex justify-center"
              style={{ top: "calc(100% - var(--hex-corner-inset-y, 0px) * 0.32)" }}
            >
              <div className="w-full">
                <Dock contextId={entityId} active={active} />
              </div>
            </div>
          ) : (
            <div className="pt-4">
              <Dock contextId={entityId} active={active} />
            </div>
          )}
        </div>
      </div>

      {/* Inputs — overlaid rail/panel hugging the LEFT edge, centered on the frame. */}
      <PanelSlot side="left" open={inOpen} shift={railShift} bleed={railBleedLeft}>
        <CollapsibleColumn
          title="Inputs"
          collapsedTitle="In"
          side="left"
          count={assetCount}
          open={inOpen}
          onOpenChange={setInOpen}
        >
          <AssetPanel spaceId={entityId} />
        </CollapsibleColumn>
      </PanelSlot>

      {/* Outputs — mirror of Inputs on the RIGHT edge. */}
      <PanelSlot side="right" open={outOpen} shift={railShift} bleed={railBleedRight}>
        <CollapsibleColumn
          title="Outputs"
          collapsedTitle="Out"
          side="right"
          count={0}
          open={outOpen}
          onOpenChange={setOutOpen}
        >
          <OutputPanel spaceId={entityId} />
        </CollapsibleColumn>
      </PanelSlot>
    </div>
  )
}

/**
 * Absolute overlay for one side panel, pinned to the window's left/right edge.
 *
 * Three things animate on the morph beat so the rail tracks the window smoothly
 * instead of snapping:
 *   • `shift` (translateY) re-centers the rail on the FRAME center as the header
 *     changes (e.g. ancestor → spine), via a dedicated node so it composes with
 *     the static `-translate-y-1/2` self-centering below.
 *   • collapsed `width` = the window's visible `bleed` sliver, so the rail SLIDES
 *     in from the frame edge and centers within the strip a covered ancestor
 *     exposes (no clipping) — widening back to the full rail / open panel.
 *   • `scale` gives a covered ancestor's rail a slight shrink for a recessed look.
 *
 * The wrapper is `pointer-events-none` so the do-list underneath stays interactive
 * wherever the panel is transparent; the panel itself re-enables pointer events.
 */
function PanelSlot({
  side,
  open,
  shift,
  bleed,
  children,
}: {
  side: "left" | "right"
  open: boolean
  shift: number
  bleed: number
  children: React.ReactNode
}) {
  // Shrink only a COLLAPSED rail that's narrower than the full width (a covered
  // ancestor); the open panel and uncovered (leaf/home) rails stay at scale 1.
  const collapsedScale = !open && bleed < PANEL_RAIL_W ? 0.85 : 1
  return (
    <div className={cn("pointer-events-none absolute top-1/2 z-10 hidden md:flex", side === "left" ? "left-0" : "right-0")}>
      <motion.div initial={false} animate={{ y: shift }} transition={panelTransition}>
        <div className="-translate-y-1/2">
          <motion.div
            className="pointer-events-auto flex min-h-0 flex-col"
            initial={false}
            animate={{ width: open ? PANEL_OPEN_W : bleed, scale: collapsedScale }}
            transition={panelTransition}
            style={{ maxHeight: "calc(50vh)" }}
          >
            {children}
          </motion.div>
        </div>
      </motion.div>
    </div>
  )
}
