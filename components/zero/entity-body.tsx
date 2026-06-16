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
  spine = false,
  onExpandPanel,
}: {
  entityId: string
  active?: boolean
  /** The always-mounted home view. Its region sits BELOW the fixed timeline
   *  chrome, so rails centered in the region land below the screen's true middle.
   *  When set, the collapsed IN/OUT rails are lifted to the viewport center. */
  isRoot?: boolean
  /** True when this body's window is a (space) spine — nudges the collapsed IN
   *  rail right so it aligns with the vertical title/glyph on the spine strip. */
  spine?: boolean
  /** Provided when this body belongs to an ancestor spine: brings that ancestor
   *  to the front so clicking its collapsed IN/OUT rail reveals the panel. */
  onExpandPanel?: () => void
}) {
  const assetCount = getSpaceAssets(entityId).length
  // Half the timeline-chrome height above the region (≈92px); lifting the
  // collapsed rails by this much re-centers them on the whole display.
  const collapsedShiftY = isRoot ? -92 : 0
  // On a spine, the IN rail nudges right to line up with the centered glyph/title.
  const inShiftX = spine ? 14 : 0

  const [inOpen, setInOpen] = usePanelOpen(`${entityId}:in`, false)
  const [outOpen, setOutOpen] = usePanelOpen(`${entityId}:out`, false)

  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 pb-5">
      {/* Dock — pinned items for this context. */}
      <Dock contextId={entityId} active={active} />

      <div className="flex min-h-0 flex-1 flex-col pt-4">
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
              collapsedShiftX={inShiftX}
              collapsedShiftY={collapsedShiftY}
              onBeforeExpand={onExpandPanel}
            >
              <AssetPanel spaceId={entityId} />
            </CollapsibleColumn>
          </motion.div>

          {/* Center Tasks column — takes the remaining width, capped for a
              comfortable reading measure, centered so it slides as sides change. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center">
            <div className="flex min-h-0 w-full max-w-[720px] flex-1 flex-col">
              <DoList contextId={entityId} active={active} />
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
              collapsedShiftY={collapsedShiftY}
              onBeforeExpand={onExpandPanel}
            >
              <OutputPanel spaceId={entityId} />
            </CollapsibleColumn>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
