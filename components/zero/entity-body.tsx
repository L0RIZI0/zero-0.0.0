"use client"

import { motion, LayoutGroup } from "motion/react"
import { getSpaceAssets } from "@/lib/zero/data"
import { panelTransition } from "@/lib/zero/motion"
import { usePanelOpen } from "@/lib/zero/panel-store"
import { Dock } from "./dock"
import { DoList } from "./do-list"
import { AssetPanel } from "./asset-panel"
import { OutputPanel } from "./output-panel"
import { CollapsibleColumn } from "./collapsible-column"
import { cn } from "@/lib/utils"

/** Width of a side slot when its panel is OPEN, and the thin RAIL when collapsed. */
const PANEL_OPEN_W = 230
const PANEL_RAIL_W = 48

/**
 * An entity's working surface: its Spaces row (pinned items for this context)
 * plus the Inputs · Tasks · Outputs columns, all filtered to `entityId`.
 *
 * The two side columns sit in slots whose WIDTH animates: a collapsed panel is a
 * thin rail (PANEL_RAIL_W), an open one is PANEL_OPEN_W. Because the center Tasks
 * column is `flex-1`, shrinking a side slot hands that room straight to the
 * center — so the do-list occupies a generous central portion when both panels
 * are closed, then smoothly slides toward the still-collapsed side (and shrinks)
 * as a panel opens, and shrinks further when both are open or the window is
 * narrow. Panel state lives in the reactive panel-store so it survives the
 * remounts that happen as windows open/close and so the nav layer can fold it.
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
  /** Vertically center the do-list within its column (forwarded to DoList). ON by
   *  default for every entity at every depth; pass `false` to top-align a specific
   *  entity's list. */
  centerList?: boolean
  /** The always-mounted home view. Its region sits BELOW the fixed timeline
   *  chrome, so rails centered in the region land below the screen's true middle.
   *  When set, the collapsed IN/OUT rails are lifted to the viewport center. */
  isRoot?: boolean
}) {
  const assetCount = getSpaceAssets(entityId).length
  // The body fills the full window now (header band above it + asymmetric
  // top/bottom padding), so a rail centered in the body lands ~19px below the
  // window's true vertical center — i.e. below the midpoint of the left/right
  // borders. This constant is independent of window HEIGHT (header + padding are
  // fixed), so lifting the collapsed rail by it re-centers the shortcut group on
  // the window at any size. Root (the always-mounted home) instead lifts by half
  // the timeline chrome above its region.
  const BODY_TOP_OFFSET = 19
  // Home view exception: lift the rails by less than the full timeline-chrome
  // height (was -92) so the collapsed IN/OUT panels sit a bit LOWER on the home
  // view than dead-center — a deliberate visual exception just for the root.
  const collapsedShiftY = isRoot ? -64 : -BODY_TOP_OFFSET
  // The IN rail nudges right by 2px everywhere so its icon clears the window's
  // left edge.
  const inShiftX = 2

  // When this window is the frontmost LEAF (active, and not the home root), the
  // collapsed IN/OUT rails pull a bit further IN from the window edges so they
  // breathe. As soon as a child opens — this window stops being the leaf
  // (active → false) — they slide back to hugging the edge, matching every
  // ancestor. CollapsibleColumn animates `x`, so toggling these values glides.
  // Left rail insets by moving right (+x); right rail by moving left (−x).
  const leafInset = active && !isRoot ? 14 : 0

  const [inOpen, setInOpen] = usePanelOpen(`${entityId}:in`, false)
  const [outOpen, setOutOpen] = usePanelOpen(`${entityId}:out`, false)

  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 pb-5 pt-4">
      {/* Single full-height row: Inputs · (Dock + Tasks) · Outputs. The Dock now
          lives INSIDE the center column (instead of spanning the top of the whole
          body) so the Inputs/Outputs slots run the FULL body height — their
          collapsed rails therefore center on the window itself, identically for
          every window regardless of how tall its dock is. (Previously the rails
          centered in the post-dock area, so docked spaces pushed them down and
          empty-dock tasks didn't — they never lined up.) */}
      <div className="flex min-h-[180px] flex-1 gap-4">
        {/* Inputs slot — width animates between rail and open panel. */}
        <motion.div
          className="hidden shrink-0 md:flex"
          initial={false}
          animate={{ width: inOpen ? PANEL_OPEN_W : PANEL_RAIL_W }}
          transition={panelTransition}
        >
          <CollapsibleColumn
            title="Inputs"
            collapsedTitle="In"
            side="left"
            count={assetCount}
            open={inOpen}
            onOpenChange={setInOpen}
            collapsedShiftX={inShiftX + leafInset}
            collapsedShiftY={collapsedShiftY}
          >
            <AssetPanel spaceId={entityId} />
          </CollapsibleColumn>
        </motion.div>

        {/* Center column — Tasks do-list ABOVE the Dock (pinned items) at every
            level, including the home view. The do-list takes the remaining height
            (flex-1) and the Dock sits beneath it. Capped for a comfortable reading
            measure and centered so it slides as the sides change. On the home view
            the cap is 70% of the viewport; inside a focus window the fixed 720px
            measure is kept. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center">
          <div
            className={cn(
              "relative flex min-h-0 w-full flex-1 flex-col",
              isRoot ? "max-w-[70vw]" : "max-w-[720px]",
            )}
          >
            {/* LayoutGroup coordinates the do-list rows and dock cards so a shared
                `layoutId` (pin-<ctx>-<id>) performs ONE magic-move animation across
                the two otherwise-independent AnimatePresence trees — the row flies and
                morphs into its dock card on pin (and back on unpin) instead of the item
                teleporting. Without the group the two presences animate in isolation. */}
            <LayoutGroup>
            {/* Do-list (including its ADD button) is narrowed to 2/3 of the measure
                and centered, so the task column reads as a tighter list. The Dock
                below keeps the full measure width. */}
            <div className="flex min-h-0 w-2/3 flex-1 flex-col self-center">
              <DoList contextId={entityId} active={active} closing={closing} centered={centerList} />
            </div>
            {floatDock ? (
              /* SPACE LEAF: the Dock is pulled OUT of the do-list's flex column and
                 pinned absolutely just below it (top:100% = the central-rectangle
                 bottom / corner line), then nudged down into the hexagon's bottom
                 triangle. Because it no longer occupies flex height, the do-list's
                 flex-1 area always spans the FULL central rectangle — so the list
                 centers identically whether or not items are pinned (fixes the list
                 being squeezed upward by a tall dock). The lift keeps the dock clear
                 of the screen-bottom edge on short viewports; it is a fraction of
                 --hex-corner-inset-y so it scales with the hexagon. No transforms are
                 used (only top/position), keeping it invisible to GSAP Flip. */
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
            </LayoutGroup>
          </div>
        </div>

        {/* Outputs slot — mirrors the Inputs slot. */}
        <motion.div
          className="hidden shrink-0 md:flex"
          initial={false}
          animate={{ width: outOpen ? PANEL_OPEN_W : PANEL_RAIL_W }}
          transition={panelTransition}
        >
          <CollapsibleColumn
            title="Outputs"
            collapsedTitle="Out"
            side="right"
            count={0}
            open={outOpen}
            onOpenChange={setOutOpen}
            collapsedShiftX={-leafInset}
            collapsedShiftY={collapsedShiftY}
          >
            <OutputPanel spaceId={entityId} />
          </CollapsibleColumn>
        </motion.div>
      </div>
    </div>
  )
}
