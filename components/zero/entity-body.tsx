"use client"

import { getSpaceAssets } from "@/lib/zero/data"
import { Dock } from "./dock"
import { DoList } from "./do-list"
import { AssetPanel } from "./asset-panel"
import { OutputPanel } from "./output-panel"
import { CollapsibleColumn } from "./collapsible-column"

/**
 * An entity's working surface: its Spaces row (pinned items for this context)
 * plus the Inputs · Tasks · Outputs columns, all filtered to `nodeId`. ONE of
 * these is rendered per entity — the root body lives in WorkSurface, and every
 * space/task frame renders its own body when it is the active (frontmost) frame.
 *
 * This replaces the old single, persistent `FrontContent` that floated above the
 * frame stack and re-filtered to the active node. Putting the body INSIDE the
 * frame means a row and the child frame it opens live in the SAME tree, so the
 * shared-element (`layoutId`) morph between them is a clean, single-tree layout
 * animation — no cross-layer handoff, which was the source of the close ghosts.
 *
 * The timeline is NOT rendered here: it stays pinned and persistent at the top
 * of the surface (WorkSurface), above the focus window.
 */
export function EntityBody({
  entityId,
  active = true,
  isRoot = false,
  onExpandPanel,
}: {
  entityId: string
  active?: boolean
  /** The always-mounted home view. Its region sits BELOW the fixed timeline
   *  chrome, so rails centered in the region land below the screen's true middle.
   *  When set, the collapsed IN/OUT rails are lifted to the viewport center. */
  isRoot?: boolean
  /** Provided when this body belongs to an ancestor spine: brings that ancestor
   *  to the front so clicking its collapsed IN/OUT rail reveals the panel. */
  onExpandPanel?: () => void
}) {
  const assetCount = getSpaceAssets(entityId).length
  // Half the timeline-chrome height above the region (≈92px); lifting the
  // collapsed rails by this much re-centers them on the whole display.
  const collapsedShiftY = isRoot ? -92 : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 pb-5">
      {/* Dock — pinned items for this context. The Dock hides its cards when the
          context has no pins, so it collapses to a small gap. */}
      <Dock contextId={entityId} active={active} />

      <div className="flex min-h-0 flex-1 flex-col pt-4">
        <div className="flex min-h-[180px] flex-1 gap-4">
          <div className="hidden w-[230px] shrink-0 md:flex">
            <CollapsibleColumn
              title="Inputs"
              collapsedTitle="In"
              side="left"
              count={assetCount}
              defaultOpen={false}
              storeKey={`${entityId}:in`}
              collapsedShiftY={collapsedShiftY}
              onBeforeExpand={onExpandPanel}
            >
              <AssetPanel spaceId={entityId} />
            </CollapsibleColumn>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center">
            <div className="flex min-h-0 w-full max-w-[80%] flex-1 flex-col">
              <DoList contextId={entityId} active={active} />
            </div>
          </div>

          <div className="hidden w-[230px] shrink-0 md:flex">
            <CollapsibleColumn
              title="Outputs"
              collapsedTitle="Out"
              side="right"
              count={0}
              defaultOpen={false}
              storeKey={`${entityId}:out`}
              collapsedShiftY={collapsedShiftY}
              onBeforeExpand={onExpandPanel}
            >
              <OutputPanel spaceId={entityId} />
            </CollapsibleColumn>
          </div>
        </div>
      </div>
    </div>
  )
}
