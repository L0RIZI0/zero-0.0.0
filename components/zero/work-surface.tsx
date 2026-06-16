"use client"

import { motion } from "motion/react"
import { useZeroNav } from "@/lib/zero/nav-store"
import { getSpace, getEntity } from "@/lib/zero/data"
import { shellStageFor, TIMELINE_TOP_PAD } from "@/lib/zero/layout"
import { layerTransition } from "@/lib/zero/motion"
import { registerStage } from "@/lib/zero/flip-stage"
import { EntityBody } from "./entity-body"
import { TimelineStrip } from "./timeline-strip"

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
  const { activeEntity, stack } = useZeroNav()
  const contextId = activeEntity.contextId
  // The root entity's body is the permanent home backdrop at z-0. It is ALWAYS
  // mounted: the depth-1 window grows over it on open and shrinks back into its
  // dock card / row on close, so that morph source must always be present.
  const rootId = stack[0]
  // The context may be a task/event (not a space), so fall back to the entity's
  // own accent when it isn't a space.
  const accent = getSpace(contextId)?.accent ?? getEntity(contextId)?.accent

  // As the user dives deeper, the whole interface compacts: the timeline slides
  // up toward the header bar (less top padding) at each stage.
  const stage = shellStageFor(activeEntity)

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
        <TimelineStrip contextId={contextId} accent={accent} />
      </motion.div>

      {/* Focus-window region — the SINGLE recursive entity tree lives here. The
          root entity's body (home view) is always mounted; its dock cards and
          DO-list rows are themselves `EntityNode`s that morph IN PLACE into
          fixed focus windows when opened, and shrink back into their own row on
          close (same DOM node — no duplicate, no captured-rect drift). This
          wrapper owns the clipping + establishes the positioning context the
          opened windows are measured against (they use region-relative `fixed`).

          `data-window-region` lets the Flip stage resolve this box's rect so a
          window can fill it exactly at depth 1. */}
      <div
        ref={registerStage}
        data-window-region
        // `flex flex-col` so the always-mounted home EntityBody (flex-1) is
        // actually constrained to this region's height. Without it the region was
        // a plain block, EntityBody sized to its content and overflowed — an
        // expanded Inputs panel then grew the columns row and pushed the opposite
        // (centered) Outputs rail down.
        //
        // Clipping uses `clip-path` (an inset with a NEGATIVE bottom) instead of
        // `overflow-hidden`. At rest the open windows are `position: fixed`, so
        // overflow didn't clip them; but during the GSAP Flip morph the frames
        // become `position: absolute` inside this region and overflow-hidden then
        // clipped the stacked drop-shadows at the very bottom of the screen — they
        // vanished mid-animation and snapped back when it ended. The negative
        // bottom inset (−120px) leaves room for those shadows while still clipping
        // the top/sides (so peeking parent frames stay contained).
        className="relative flex min-h-0 flex-1 flex-col rounded-md [clip-path:inset(0px_0px_-120px_0px_round_6px)]"
      >
        <EntityBody entityId={rootId} active={activeEntity.id === rootId} isRoot />
      </div>
    </div>
  )
}
