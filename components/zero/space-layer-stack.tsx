"use client"

import { AnimatePresence } from "motion/react"
import { getSpace, getTask, getEvent, getInstant } from "@/lib/zero/data"
import { isTaskId, isEventId, isInstantId, useZeroNav } from "@/lib/zero/nav-store"
import { LayerDepthContainer } from "./layer-depth-container"
import { SpaceFrame } from "./space-frame"
import { TaskFrame } from "./task-frame"
import { EventFrame } from "./event-frame"
import { InstantFrame } from "./instant-frame"

export function SpaceLayerStack() {
  const { stack, closeSpace } = useZeroNav()

  return (
    <div className="relative h-full w-full">
      <AnimatePresence initial={false}>
        {stack.map((nodeId, index) => {
          const isActive = index === stack.length - 1
          const depthFromTop = stack.length - 1 - index

          if (isTaskId(nodeId)) {
            const task = getTask(nodeId)
            if (!task) return null
            return (
              <LayerDepthContainer key={nodeId} depthFromTop={depthFromTop} isActive={isActive}>
                <TaskFrame task={task} isActive={isActive} onClose={closeSpace} />
              </LayerDepthContainer>
            )
          }

          if (isEventId(nodeId)) {
            const event = getEvent(nodeId)
            if (!event) return null
            return (
              <LayerDepthContainer key={nodeId} depthFromTop={depthFromTop} isActive={isActive}>
                <EventFrame event={event} isActive={isActive} onClose={closeSpace} />
              </LayerDepthContainer>
            )
          }

          if (isInstantId(nodeId)) {
            const instant = getInstant(nodeId)
            if (!instant) return null
            return (
              <LayerDepthContainer key={nodeId} depthFromTop={depthFromTop} isActive={isActive}>
                <InstantFrame instant={instant} isActive={isActive} onClose={closeSpace} />
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
                onClose={closeSpace}
              />
            </LayerDepthContainer>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
