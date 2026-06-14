"use client"

import { getSpaceAssets } from "@/lib/zero/data"
import { SpacesRow } from "./spaces-row"
import { TaskList } from "./task-list"
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
export function EntityBody({ nodeId }: { nodeId: string }) {
  const assetCount = getSpaceAssets(nodeId).length

  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 pb-5">
      {/* Spaces row — pinned items for this context. SpacesRow hides its cards
          when the context has no pins, so it collapses to a small gap. */}
      <SpacesRow contextSpaceId={nodeId} />

      <div className="flex min-h-0 flex-1 flex-col pt-4">
        <div className="flex min-h-[180px] flex-1 gap-4">
          <div className="hidden w-[230px] shrink-0 md:flex">
            <CollapsibleColumn title="Inputs" side="left" count={assetCount}>
              <AssetPanel spaceId={nodeId} />
            </CollapsibleColumn>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center">
            <div className="flex min-h-0 w-full max-w-[80%] flex-1 flex-col">
              <TaskList spaceId={nodeId} />
            </div>
          </div>

          <div className="hidden w-[230px] shrink-0 md:flex">
            <CollapsibleColumn title="Outputs" side="right" count={0}>
              <OutputPanel spaceId={nodeId} />
            </CollapsibleColumn>
          </div>
        </div>
      </div>
    </div>
  )
}
