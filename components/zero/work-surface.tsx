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
    // NOTE: the card is NOT `overflow-hidden`. Clipping lives on the focus-window
    // region below instead, so the timeline can ride UP past the card's top edge
    // (toward the header) at deeper stages without being cropped. `rounded-md`
    // still rounds the card's own background; only the window region needs to
    // clip its scaled-up parent frames.
    <div className="relative flex h-full w-full flex-col rounded-md bg-background">
      {/* Persistent timeline — always pinned above the focus window. Its top
          margin animates negative with depth so it rises toward (and slightly
          into) the header bar. Not clipped by the card, so it never crops. */}
      <motion.div
        className="relative z-30 shrink-0 px-6"
        initial={false}
        animate={{ marginTop: TIMELINE_TOP_PAD[stage] }}
        transition={layerTransition}
      >
        <TimelineStrip spaceId={contextSpaceId} accent={accent} />
      </motion.div>

      {/* Breadcrumb — between the timeline and the focus window. */}
      <div className="shrink-0">
        <PathStack />
      </div>

      {/* Focus-window region — the window opens here, beneath the timeline.
          This wrapper owns the clipping (rounded + overflow-hidden) that used to
          live on the card root, so the scaled-up parent frames still fade past
          the edges while the timeline above stays free to overflow upward. */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md">
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
