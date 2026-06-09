"use client"

import { AnimatePresence } from "motion/react"
import { getSpace } from "@/lib/zero/data"
import { useZeroNav } from "@/lib/zero/nav-store"
import { LayerDepthContainer } from "./layer-depth-container"
import { SpaceFrame } from "./space-frame"

export function SpaceLayerStack() {
  const { stack, openSpace, closeSpace } = useZeroNav()

  return (
    <div className="relative h-full w-full">
      <AnimatePresence initial={false}>
        {stack.map((spaceId, index) => {
          const space = getSpace(spaceId)
          if (!space) return null
          const isRoot = index === 0
          const isActive = index === stack.length - 1
          return (
            <LayerDepthContainer key={spaceId} index={index} isActive={isActive}>
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
