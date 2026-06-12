"use client"

import { AnimatePresence } from "motion/react"
import { getSpace, getTask, getEvent } from "@/lib/zero/data"
import { isTaskId, isEventId, useZeroNav } from "@/lib/zero/nav-store"
import { LayerDepthContainer } from "./layer-depth-container"
import { SpaceFrame } from "./space-frame"
import { TaskFrame } from "./task-frame"
import { EventFrame } from "./event-frame"

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

          const space = getSpace(nodeId)
          if (!space) return null
          const isRoot = index === 0
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
