"use client"

import { motion } from "motion/react"
import { layerTransition } from "@/lib/zero/motion"

/**
 * Wraps a layer in the stack. The active (top) layer fills the whole stage.
 * Parent layers expand slightly and recede *beyond* the stage edges — so diving
 * into a child feels like the parent (e.g. Space 0) opening up and receding past
 * the frame, rather than the child nesting inside it.
 *
 * - `depthFromTop` is 0 for the active layer, 1 for its parent, etc.
 * - `isActive` marks the top of the stack.
 */

// How far (px, per depth level) a receding parent grows beyond each stage edge.
const GROW_STEP_PX = 38

export function LayerDepthContainer({
  depthFromTop,
  isActive,
  children,
}: {
  depthFromTop: number
  isActive: boolean
  children: React.ReactNode
}) {
  // CRITICAL: the recede is done with pure LAYOUT (negative inset growing the
  // frame past the stage edges), NOT `transform: scale`. The frames morph via a
  // shared `layoutId` (button/row <-> frame), which Framer projects by measuring
  // bounding boxes. A `transform: scale` on an ancestor compounds with that
  // projection transform and corrupts the scale-correction — the stretch/flicker
  // we kept fighting, most visibly on CLOSE, where the becoming-active parent
  // (now holding the destination row in its body) animates back to full size
  // while the row morphs into it. Animating `inset` is a layout change: it
  // imposes no transform matrix on descendants, so the row's projection stays
  // clean. We deliberately do NOT animate opacity — an active layer is an opaque,
  // full-bleed frame that covers everything beneath it.
  const grow = isActive ? 0 : depthFromTop * GROW_STEP_PX

  // Layers two or more deep are completely occluded by the opaque active layer,
  // so we hide them outright to keep them out of compositing during transitions.
  const occluded = depthFromTop >= 2

  return (
    <div
      aria-hidden={!isActive}
      className="absolute inset-0"
      style={{
        zIndex: 100 - depthFromTop,
        pointerEvents: isActive ? "auto" : "none",
        visibility: occluded ? "hidden" : "visible",
      }}
    >
      {/* CRITICAL (close morph): the ACTIVE layer's inset settles INSTANTLY, not
          via the spring. On close, the parent goes from receded (inset -38) to
          active (inset 0); if that 38px advance ANIMATES, the becoming-active
          container is mid-animation exactly while the destination row inside its
          body runs its shared-layoutId morph — and Framer's scale-correction for
          that nested morph reads a moving ancestor and silently drops the SCALE
          part (the row snaps to size and only its position eases: the "jump +
          tiny slide" bug). Snapping the active inset to 0 gives the row a static
          ancestor (like the dock's root body), so the frame→row shrink scales
          cleanly. Receding layers (open) still animate for the push-back feel. */}
      <motion.div
        className="absolute overflow-hidden"
        initial={false}
        animate={{ top: -grow, right: -grow, bottom: -grow, left: -grow }}
        transition={isActive ? { duration: 0 } : layerTransition}
      >
        {children}
      </motion.div>
    </div>
  )
}
