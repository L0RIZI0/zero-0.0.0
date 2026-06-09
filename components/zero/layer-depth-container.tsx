"use client"

import { motion } from "motion/react"
import { layerTransition } from "@/lib/zero/motion"

/**
 * Wraps a layer in the stack. Each deeper layer is inset further so the layer
 * beneath remains visible around its edges — the user feels they are diving
 * into a context, not teleporting. Parent (inactive) layers also recede with
 * scale, blur and dimming.
 *
 * - `index` is the position from the root (0 = root).
 * - `isActive` marks the top of the stack.
 */
const INSET = 22

export function LayerDepthContainer({
  index,
  isActive,
  children,
}: {
  index: number
  isActive: boolean
  children: React.ReactNode
}) {
  const inset = index * INSET

  // Inactive (parent) layers recede slightly: dim + blur to push them back.
  const scale = isActive ? 1 : 0.992
  const blur = isActive ? 0 : 1.5
  const opacity = isActive ? 1 : 0.55

  return (
    <motion.div
      aria-hidden={!isActive}
      className="absolute inset-0 origin-top"
      style={{
        zIndex: 10 + index,
        pointerEvents: isActive ? "auto" : "none",
        padding: inset,
      }}
      initial={false}
      animate={{ scale, filter: `blur(${blur}px)`, opacity }}
      transition={layerTransition}
    >
      <div className="h-full w-full overflow-hidden">{children}</div>
    </motion.div>
  )
}
