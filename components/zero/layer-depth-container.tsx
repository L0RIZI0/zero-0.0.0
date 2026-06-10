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
  // Parents scale up so they recede "past the screen edges" behind the active
  // layer. We deliberately do NOT animate opacity: an active layer is always an
  // opaque, full-bleed frame that completely covers everything beneath it, so
  // fading the parent is invisible work — and it was the cause of the flicker.
  // (Compositing the huge Space 0 subtree as a semi-transparent layer every
  // frame is expensive, and on close it produced a "reveal flash" as the
  // shrinking child uncovered a not-yet-opaque parent.) Scale alone gives the
  // receding effect with none of the flicker.
  const scale = isActive ? 1 : 1 + depthFromTop * SCALE_STEP

  return (
    <motion.div
      aria-hidden={!isActive}
      className="absolute inset-0 origin-center"
      style={{
        zIndex: 100 - depthFromTop,
        pointerEvents: isActive ? "auto" : "none",
        // Hint the compositor so the (transform-only) spring runs off the main
        // thread. We animate transform exclusively, so this never fights an
        // opacity animation the way the previous implementation did.
        willChange: "transform",
      }}
      initial={false}
      animate={{ scale }}
      transition={layerTransition}
    >
      <div className="h-full w-full overflow-hidden">{children}</div>
    </motion.div>
  )
}
