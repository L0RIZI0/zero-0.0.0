"use client"

import { motion } from "motion/react"
import type { CSSProperties, ReactNode } from "react"
import { layerTransition } from "@/lib/zero/motion"
import { cn } from "@/lib/utils"
import type { RegionGrow } from "@/lib/zero/regions"

/**
 * An invisible layout frame inside an entity's content area (see lib/zero/regions).
 * Regions have NO border and NO background — content bleeds freely — they exist
 * only to organize and size the components stacked within an entity.
 *
 *   • grow="fill" → takes the leftover vertical space (region 0 / do-list). It is
 *                   a flex column so its component can center within it.
 *   • grow="hug"  → sizes to its content's height (e.g. the timeline); growing the
 *                   content grows the region and pushes the regions below it down.
 *
 * `lift` is an ANIMATED translateY — used by entity 0's timeline region to slide up
 * toward the header bar as the shell compacts with depth. It is a transform, so it
 * never reflows the regions below: their boxes stay put through the morph (this is
 * what keeps the fixed child windows, anchored to region 0's rect, from jumping).
 */
export function Region({
  grow,
  lift = 0,
  className,
  style,
  children,
}: {
  grow: RegionGrow
  lift?: number
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <motion.div
      data-region
      data-region-grow={grow}
      className={cn("relative", grow === "fill" ? "flex min-h-0 flex-1 flex-col" : "shrink-0", className)}
      style={style}
      initial={false}
      animate={{ y: lift }}
      transition={layerTransition}
    >
      {children}
    </motion.div>
  )
}
