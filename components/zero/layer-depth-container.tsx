"use client"

import { motion } from "motion/react"
import { layerTransition } from "@/lib/zero/motion"

/**
 * Wraps a layer in the stack. The active (top) layer fills the whole stage.
 * Parent layers expand slightly and fade out *beyond* the screen edges — so
 * diving into a child feels like the parent (e.g. Space 0) opening up and
 * receding past the frame, rather than the child nesting inside it.
 *
 * - `depthFromTop` is 0 for the active layer, 1 for its parent, etc.
 * - `isActive` marks the top of the stack.
 */
const SCALE_STEP = 0.085

export function LayerDepthContainer({
  depthFromTop,
  isActive,
  children,
}: {
  depthFromTop: number
  isActive: boolean
  children: React.ReactNode
}) {
  // Parents scale up and fade out past the screen limits; the active layer is
  // pristine and full-size.
  const scale = isActive ? 1 : 1 + depthFromTop * SCALE_STEP
  const opacity = isActive ? 1 : 0

  return (
    <motion.div
      aria-hidden={!isActive}
      className="absolute inset-0 origin-center"
      style={{
        zIndex: 100 - depthFromTop,
        pointerEvents: isActive ? "auto" : "none",
        // Promote to its own GPU compositor layer so the scale/opacity spring
        // runs off the main thread. Without this, the first dive from Space 0
        // (which renders the entire app's content) janks, because the large
        // subtree is repainted every frame as it scales and fades.
        willChange: "transform, opacity",
        transform: "translateZ(0)",
        backfaceVisibility: "hidden",
      }}
      initial={false}
      animate={{ scale, opacity }}
      transition={layerTransition}
    >
      <div className="h-full w-full overflow-hidden">{children}</div>
    </motion.div>
  )
}
