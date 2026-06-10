"use client"

import { AnimatePresence } from "motion/react"
import { getSpace, getTask } from "@/lib/zero/data"
import { isTaskId, useZeroNav } from "@/lib/zero/nav-store"
import { LayerDepthContainer } from "./layer-depth-container"
import { SpaceFrame } from "./space-frame"
import { TaskFrame } from "./task-frame"

export function SpaceLayerStack() {
  const { stack, openSpace, closeSpace } = useZeroNav()

  return (
    <div className="relative h-full w-full">
      <AnimatePresence initial={false}>
        {stack.map((nodeId, index) => {
          const isActive = index === stack.length - 1

          if (isTaskId(nodeId)) {
            const task = getTask(nodeId)
            if (!task) return null
            return (
              <LayerDepthContainer key={nodeId} index={index} isActive={isActive}>
                <TaskFrame task={task} onClose={closeSpace} />
              </LayerDepthContainer>
            )
          }

          const space = getSpace(nodeId)
          if (!space) return null
          const isRoot = index === 0
          return (
            <LayerDepthContainer key={nodeId} index={index} isActive={isActive}>
              <SpaceFrame
                space={space}
                isRoot={isRoot}
                onOpenChild={openSpace}
                onClose={closeSpace}
              />
            </LayerDepthContainer>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
