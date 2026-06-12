"use client"

import { motion } from "motion/react"
import { layerTransition } from "@/lib/zero/motion"
import { useZeroNav } from "@/lib/zero/nav-store"

/**
 * Wraps a layer in the stack. The active (top) layer fills the whole stage.
 * Parent layers expand slightly and fade out *beyond* the screen edges — so
 * diving into a child feels like the parent (e.g. Space 0) opening up and
 * receding past the frame, rather than the child nesting inside it.
 *
 * - `depthFromTop` is 0 for the active layer, 1 for its parent, etc.
 * - `isActive` marks the top of the stack (drives only the visual scale/morph).
 */
const SCALE_STEP = 0.085

export function LayerDepthContainer({
  nodeId,
  depthFromTop,
  isActive,
  children,
}: {
  nodeId: string
  depthFromTop: number
  isActive: boolean
  children: React.ReactNode
}) {
  // CRITICAL — interactivity must follow the LIVE top of stack, not the
  // `isActive` prop. When a layer closes, AnimatePresence keeps rendering it
  // with its LAST props during the exit animation, so the closing layer would
  // otherwise hold isActive=true → `pointer-events: auto` on a full-bleed layer
  // painted on top, swallowing every click. Reading the live active id here
  // means the moment a layer is no longer the top of stack it becomes
  // click-through, even while it animates out — so a stranded/interrupted exit
  // can never freeze the whole app.
  const { activeSpaceId } = useZeroNav()
  const isLiveTop = nodeId === activeSpaceId
  // Parents scale up so they recede "past the screen edges" behind the active
  // layer. We deliberately do NOT animate opacity: an active layer is always an
  // opaque, full-bleed frame that fully covers everything beneath it.
  const scale = isActive ? 1 : 1 + depthFromTop * SCALE_STEP

  // CRITICAL: the depth scale lives on the INNER wrapper, not this positioned
  // container. The Space/Task frames inside morph via a shared `layoutId`
  // (button <-> frame), and Framer projects that morph by measuring bounding
  // boxes. If an *ancestor* of a layoutId node is mid-scale during the morph,
  // the projection is distorted and flickers — which is exactly what happened
  // on close and at deeper levels. By scaling a sibling-level inner wrapper and
  // letting Motion own `willChange` (no always-on hint, another flicker cause),
  // the morph stays geometrically clean.
  //
  // Layers two or more deep are completely occluded by the opaque active layer,
  // so we hide them outright to keep them out of compositing during transitions.
  const occluded = depthFromTop >= 2

  return (
    <div
      aria-hidden={!isLiveTop}
      className="absolute inset-0"
      style={{
        zIndex: 100 - depthFromTop,
        // Follow the LIVE top of stack (see note above): an exiting layer is no
        // longer the top, so it drops to click-through immediately and can't
        // trap input even if its exit animation is interrupted or stranded.
        pointerEvents: isLiveTop ? "auto" : "none",
        visibility: occluded ? "hidden" : "visible",
      }}
    >
      <motion.div
        className="h-full w-full origin-center overflow-hidden"
        initial={false}
        animate={{ scale }}
        transition={layerTransition}
      >
        {children}
      </motion.div>
    </div>
  )
}
