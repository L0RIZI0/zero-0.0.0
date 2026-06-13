"use client"

import { motion } from "motion/react"
import { useZeroNav } from "@/lib/zero/nav-store"
import { getSpace, getEntity } from "@/lib/zero/data"
import { shellStageFor, TIMELINE_TOP_PAD } from "@/lib/zero/layout"
import { layerTransition } from "@/lib/zero/motion"
import { SpaceLayerStack } from "./space-layer-stack"
import { FrontContent } from "./front-content"
import { TimelineStrip } from "./timeline-strip"
import { PathStack } from "./breadcrumb-path"

/**
 * The composed work surface. The timeline is a persistent band pinned to the
 * TOP of the surface — it always sits ABOVE the focus window and never gets
 * "contained" by it. Directly beneath the timeline is the breadcrumb, and below
 * that is the focus-window region, three stacked layers:
 *
 *   ┌─────────────────────────────────────┐
 *   │  timeline            (persistent)     │  ← pinned top, context-filtered
 *   │  breadcrumb          (persistent)     │  ← between timeline & window
 *   │ ┌─────────────────────────────────┐  │
 *   │ │  A — Space 0 background          │  │
 *   │ │  B — SpaceLayerStack (frames)    │  │  ← the focus window opens here,
 *   │ │  C — FrontContent (lists etc.)   │  │     below the timeline
 *   │ └─────────────────────────────────┘  │
 *   └─────────────────────────────────────┘
 *
 * Layer C sits above B so the frontmost content reads in front of the child
 * window's border, while the frame still owns its title band.
 */
export function WorkSurface() {
  const { activeNode } = useZeroNav()
  const contextSpaceId = activeNode.contextSpaceId
  // The context may be a task/event (not a space), so fall back to the entity's
  // own accent when it isn't a space.
  const accent = getSpace(contextSpaceId)?.accent ?? getEntity(contextSpaceId)?.accent

  // As the user dives deeper, the whole interface compacts: the timeline slides
  // up toward the header bar (less top padding) at each stage.
  const stage = shellStageFor(activeNode)

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-md bg-background">
      {/* Persistent timeline — always pinned above the focus window. Its top
          padding animates down with depth so it rises toward the header bar. */}
      <motion.div
        className="shrink-0 px-6"
        initial={false}
        animate={{ paddingTop: TIMELINE_TOP_PAD[stage] }}
        transition={layerTransition}
      >
        <TimelineStrip spaceId={contextSpaceId} accent={accent} stage={stage} />
      </motion.div>

      {/* Breadcrumb — between the timeline and the focus window. */}
      <div className="shrink-0">
        <PathStack />
      </div>

      {/* Focus-window region — the window opens here, beneath the timeline. */}
      <div className="relative min-h-0 flex-1">
        {/* Layer B — window frames (root renders no frame, just transparent). */}
        <div className="absolute inset-0 z-10">
          <SpaceLayerStack />
        </div>

        {/* Layer C — persistent frontmost content. The wrapper is click-through;
            FrontContent re-enables pointer events on its interactive children so
            the window frame's header below stays clickable. */}
        <div className="pointer-events-none absolute inset-0 z-20">
          <FrontContent />
        </div>
      </div>
    </div>
  )
}
