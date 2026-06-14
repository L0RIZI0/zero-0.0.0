"use client"

import { getSpace, getTask, getEvent, getInstant } from "@/lib/zero/data"
import { isTaskId, isEventId, isInstantId, useZeroNav } from "@/lib/zero/nav-store"
import { LayerDepthContainer } from "./layer-depth-container"
import { SpaceFrame } from "./space-frame"
import { TaskFrame } from "./task-frame"
import { EventFrame } from "./event-frame"
import { InstantFrame } from "./instant-frame"

export function SpaceLayerStack() {
  const { stack, closeSpace } = useZeroNav()

  // NOTE: deliberately NO <AnimatePresence>. The row/card <-> frame morph is a
  // shared-layoutId animation driven by the WorkSurface <LayoutGroup>. It is
  // clean only when exactly ONE element owns a given layoutId at a time: on
  // open the origin row swaps to an inert placeholder (dropping its id) as the
  // frame mounts. On CLOSE we need the mirror — the frame must unmount the
  // instant the stack pops so the re-appearing row/card is the sole owner and
  // Framer morphs it FROM the frame's last box. AnimatePresence would keep the
  // exiting frame mounted (still owning the id) while the row re-claims it,
  // producing two live owners and the crossfade "ghost title/glyph". Rendering
  // the stack directly = instant unmount = single owner = clean close.
  return (
    <div className="relative h-full w-full">
      {stack.map((nodeId, index) => {
          const isActive = index === stack.length - 1
          const depthFromTop = stack.length - 1 - index

          if (isTaskId(nodeId)) {
            const task = getTask(nodeId)
            if (!task) return null
            return (
              <LayerDepthContainer key={nodeId} depthFromTop={depthFromTop} isActive={isActive}>
                <TaskFrame task={task} isActive={isActive} depthFromTop={depthFromTop} onClose={closeSpace} />
              </LayerDepthContainer>
            )
          }

          if (isEventId(nodeId)) {
            const event = getEvent(nodeId)
            if (!event) return null
            return (
              <LayerDepthContainer key={nodeId} depthFromTop={depthFromTop} isActive={isActive}>
                <EventFrame event={event} isActive={isActive} depthFromTop={depthFromTop} onClose={closeSpace} />
              </LayerDepthContainer>
            )
          }

          if (isInstantId(nodeId)) {
            const instant = getInstant(nodeId)
            if (!instant) return null
            return (
              <LayerDepthContainer key={nodeId} depthFromTop={depthFromTop} isActive={isActive}>
                <InstantFrame instant={instant} isActive={isActive} depthFromTop={depthFromTop} onClose={closeSpace} />
              </LayerDepthContainer>
            )
          }

          const space = getSpace(nodeId)
          if (!space) return null
          const isRoot = index === 0
          // The root space renders no frame (the surface itself stands in for
          // it) — its body is the z-0 home layer in WorkSurface. Rendering an
          // (empty) active LayerDepthContainer for it would lay a full-bleed
          // pointer-events:auto div over that home body and swallow every hover
          // and click, so skip it entirely.
          if (isRoot) return null
          return (
            <LayerDepthContainer key={nodeId} depthFromTop={depthFromTop} isActive={isActive}>
              <SpaceFrame
                space={space}
                isRoot={isRoot}
                isActive={isActive}
                depthFromTop={depthFromTop}
                onClose={closeSpace}
              />
            </LayerDepthContainer>
          )
      })}
    </div>
  )
}
