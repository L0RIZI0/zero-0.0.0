"use client"

import { motion } from "motion/react"
import { useZeroNav } from "@/lib/zero/nav-store"
import { getSpaceAssets } from "@/lib/zero/data"
import { layerTransition } from "@/lib/zero/motion"
import { headerHeightFor } from "@/lib/zero/layout"
import { SpacesRow } from "./spaces-row"
import { TaskList } from "./task-list"
import { AssetPanel } from "./asset-panel"
import { OutputPanel } from "./output-panel"
import { CollapsibleColumn } from "./collapsible-column"

/**
 * The persistent, frontmost work content. Exactly one instance of the spaces
 * row, task list, Inputs panel, and Outputs panel lives here for the whole app —
 * they never unmount as the user dives between windows, they only re-filter to
 * the active node. This layer sits ABOVE the window frames (Layer B); the
 * frame's border + off-white fill read as a ring behind it, and the frame owns
 * only the title band (top), so this layer animates its top down to clear the
 * child's title/description. The timeline is NOT here — it is pinned above this
 * whole region by WorkSurface, so the focus window opens beneath it.
 */
export function FrontContent() {
  const { activeNode } = useZeroNav()
  const contextSpaceId = activeNode.contextSpaceId
  const assetCount = getSpaceAssets(contextSpaceId).length

  const headerHeight = headerHeightFor(activeNode)

  return (
    // pointer-events-none so the window frame's header controls (close, title)
    // remain clickable through the gaps; interactive children opt back in.
    <div className="pointer-events-none absolute inset-0 flex flex-col px-6 pb-5">
      {/* Top spacer animates down to clear the active frame's title band. */}
      <motion.div
        aria-hidden
        initial={false}
        animate={{ height: headerHeight }}
        transition={layerTransition}
      />

      {/* Spaces row — between the title band and the lists. Tasks have no
          subspaces, and SpacesRow hides itself when the context has no
          children, so it renders nothing in those cases. */}
      {activeNode.kind === "space" && <SpacesRow contextSpaceId={contextSpaceId} />}

      <div className="pointer-events-auto flex min-h-0 flex-1 flex-col pt-4">
        <div className="flex min-h-[180px] flex-1 gap-4">
          <div className="hidden w-[230px] shrink-0 md:flex">
            <CollapsibleColumn title="Inputs" side="left" count={assetCount}>
              <AssetPanel spaceId={contextSpaceId} />
            </CollapsibleColumn>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center">
            <div className="flex min-h-0 w-full max-w-[80%] flex-1 flex-col">
              <TaskList spaceId={contextSpaceId} />
            </div>
          </div>

          <div className="hidden w-[230px] shrink-0 md:flex">
            <CollapsibleColumn title="Outputs" side="right" count={0}>
              <OutputPanel spaceId={contextSpaceId} />
            </CollapsibleColumn>
          </div>
        </div>
      </div>
    </div>
  )
}
