"use client"

import { motion } from "motion/react"
import { useZeroNav } from "@/lib/zero/nav-store"
import { getSpace } from "@/lib/zero/data"
import { layerTransition } from "@/lib/zero/motion"
import { bottomInsetFor, headerHeightFor } from "@/lib/zero/layout"
import { TimelineStrip } from "./timeline-strip"
import { TaskList } from "./task-list"
import { AssetPanel } from "./asset-panel"
import { OutputPanel } from "./output-panel"
import { CollapsibleColumn } from "./collapsible-column"
import { getSpaceAssets } from "@/lib/zero/data"

/**
 * The persistent, frontmost work content. Exactly one instance of the timeline,
 * task list, Inputs panel, and Outputs panel lives here for the whole app — they
 * never unmount as the user dives between windows, they only re-filter to the
 * active node. This layer sits ABOVE the window frames (Layer B); the frame's
 * border + off-white fill read as a ring behind it, and the frame owns the
 * title band (top) and the spaces dock (bottom), so this layer insets to clear
 * both bands. The timeline's top offset animates down to sit below the child's
 * title/description.
 */
export function FrontContent() {
  const { activeNode } = useZeroNav()
  const contextSpaceId = activeNode.contextSpaceId
  const accent = getSpace(contextSpaceId)?.accent
  const assetCount = getSpaceAssets(contextSpaceId).length

  const headerHeight = headerHeightFor(activeNode)
  const bottomInset = bottomInsetFor(activeNode)

  return (
    // pointer-events-none so the window frame's header controls (close, title)
    // remain clickable through the gaps; interactive children opt back in.
    <div className="pointer-events-none absolute inset-0 flex flex-col px-6">
      <motion.div
        className="pointer-events-auto"
        initial={false}
        animate={{ marginTop: headerHeight }}
        transition={layerTransition}
      >
        <TimelineStrip spaceId={contextSpaceId} accent={accent} />
      </motion.div>

      <div className="pointer-events-auto flex min-h-0 flex-1 flex-col pt-4">
        <div className="mb-1 flex items-center justify-center">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Tasks
          </h2>
        </div>

        <div className="flex min-h-[180px] flex-1 gap-4">
          <div className="hidden w-[230px] shrink-0 md:flex">
            <CollapsibleColumn title="Inputs" side="left" count={assetCount}>
              <AssetPanel spaceId={contextSpaceId} />
            </CollapsibleColumn>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center">
            <div className="flex min-h-0 w-full max-w-[80%] flex-1 flex-col rounded-sm p-2">
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

      {/* Reserve the bottom band the window frame uses for its spaces dock. */}
      <motion.div
        aria-hidden
        className="shrink-0"
        initial={false}
        animate={{ height: bottomInset }}
        transition={layerTransition}
      />
    </div>
  )
}
