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
}: {
  entityId: string
  active?: boolean
  /** Forwarded to the DoList so it can keep its scroller clipped during this
   *  window's close morph (prevents the ADD row jumping up over the title). */
  closing?: boolean
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
    <div className="relative flex min-h-0 flex-1 flex-col px-6 pb-5 pt-4">
      {/* Center column — Tasks do-list ABOVE the Dock (pinned items). The list
          takes the remaining height (flex-1); the Dock sits beneath it. Capped for
          a comfortable reading measure and centered. Full width now: the side
          panels overlay it rather than stealing its space, so it never moves. */}
      <div className="flex min-h-[180px] min-w-0 flex-1 flex-col items-center">
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
      <PanelSlot side="left" open={inOpen}>
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
      <PanelSlot side="right" open={outOpen}>
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
 * Absolute overlay for one side panel. Anchored to the frame's true vertical
 * center via `--rail-center-shift` (set by entity-node; 0 on the home root). The
 * wrapper is `pointer-events-none` so the do-list underneath stays interactive
 * wherever the panel is transparent; the panel itself re-enables pointer events.
 * Width animates between the collapsed rail and the open panel on the morph beat,
 * and `maxHeight` bounds an open panel so its inner list scrolls.
 */
function PanelSlot({ side, open, children }: { side: "left" | "right"; open: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn("pointer-events-none absolute z-10 hidden md:flex", side === "left" ? "left-0" : "right-0")}
      style={{ top: "calc(50% + var(--rail-center-shift, 0px))", transform: "translateY(-50%)" }}
    >
      <motion.div
        className="pointer-events-auto flex min-h-0 flex-col"
        initial={false}
        animate={{ width: open ? PANEL_OPEN_W : PANEL_RAIL_W }}
        transition={panelTransition}
        style={{ maxHeight: "calc(50vh)" }}
      >
        {children}
      </motion.div>
    </div>
  )
}
