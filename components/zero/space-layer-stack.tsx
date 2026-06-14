"use client"

import { getSpace, getTask, getEvent, getInstant } from "@/lib/zero/data"
import { isTaskId, isEventId, isInstantId, useZeroNav } from "@/lib/zero/nav-store"
import { LayerDepthContainer } from "./layer-depth-container"
import { SpaceFrame } from "./space-frame"
import { TaskFrame } from "./task-frame"
import { EventFrame } from "./event-frame"
import { InstantFrame } from "./instant-frame"

export function SpaceLayerStack() {
  const { stack, closeTo } = useZeroNav()

  // NOTE: deliberately NO <AnimatePresence>. The row/card <-> frame morph is a
  // shared-layoutId animation driven by the WorkSurface <LayoutGroup>. It is
  // clean only when exactly ONE element owns a given layoutId at a time: on open
  // the origin row swaps to an inert placeholder (dropping its id) as the frame
  // mounts. On CLOSE the frame must unmount the instant the stack pops so the
  // re-appearing row/card is the sole owner and Framer morphs it FROM the
  // frame's last box. AnimatePresence would keep the exiting frame mounted (still
  // owning the id) while the row re-claims it, producing two live owners and the
  // crossfade ghost. Rendering the stack directly = instant unmount = clean.
  //
  // Every level stays mounted (no occlusion/visibility tricks): ancestor windows
  // are positioned by absolute depth (see LayerDepthContainer), peeking their
  // header strips for the nested-doll breadcrumb. `depth` = absolute index in
  // the stack; `isTop` marks the frontmost (interactive) window.
  return (
    <div className="relative h-full w-full">
      {stack.map((nodeId, index) => {
        const isTop = index === stack.length - 1
        const depth = index

        if (isTaskId(nodeId)) {
          const task = getTask(nodeId)
          if (!task) return null
          return (
            <LayerDepthContainer key={nodeId} depth={depth} isTop={isTop}>
              <TaskFrame task={task} depth={depth} isTop={isTop} onCloseTo={closeTo} />
            </LayerDepthContainer>
          )
        }

        if (isEventId(nodeId)) {
          const event = getEvent(nodeId)
          if (!event) return null
          return (
            <LayerDepthContainer key={nodeId} depth={depth} isTop={isTop}>
              <EventFrame event={event} depth={depth} isTop={isTop} onCloseTo={closeTo} />
            </LayerDepthContainer>
          )
        }

        if (isInstantId(nodeId)) {
          const instant = getInstant(nodeId)
          if (!instant) return null
          return (
            <LayerDepthContainer key={nodeId} depth={depth} isTop={isTop}>
              <InstantFrame instant={instant} depth={depth} isTop={isTop} onCloseTo={closeTo} />
            </LayerDepthContainer>
          )
        }

        const space = getSpace(nodeId)
        if (!space) return null
        // The root space (index 0) renders no frame — its body is the z-0 home
        // layer in WorkSurface. A framed window for it would lay a full-bleed div
        // over that home body and swallow its hovers/clicks.
        if (index === 0) return null
        return (
          <LayerDepthContainer key={nodeId} depth={depth} isTop={isTop}>
            <SpaceFrame space={space} depth={depth} isTop={isTop} onCloseTo={closeTo} />
          </LayerDepthContainer>
        )
      })}
    </div>
  )
}
