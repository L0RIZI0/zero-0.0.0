"use client"

import { motion } from "motion/react"
import type { CSSProperties, ReactNode } from "react"
import { layerTransition } from "@/lib/zero-002/motion"
import { cn } from "@/lib/utils"
import type { RegionGrow } from "@/lib/zero-002/regions"
import { useDebugView } from "@/lib/zero-002/debug-view"
import { DebugFrameLabel } from "./debug-frame-label"

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
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * CURRENT STATUS: this component is NOT rendered anywhere yet. EntityBody currently
 * hand-rolls plain `data-region` divs and WorkSurface paints the timeline as an
 * absolute overlay (see lib/zero/regions header). `<Region>` is kept INTACT as the
 * scaffold for the planned migration BACK to a structured region stack — where a
 * hug timeline region genuinely pushes the fill do-list region down instead of the
 * interim overlay. Do not delete; wire it in when that model returns.
 */
export function Region({
  grow,
  lift = 0,
  className,
  style,
  children,
  debugName,
  debugRole,
}: {
  grow: RegionGrow
  lift?: number
  className?: string
  style?: CSSProperties
  children: ReactNode
  /** [v0] DEBUG: short name shown in the red region's corner label (e.g. "ent0·reg0").
   *  When omitted, no label renders. Remove with the debug borders. */
  debugName?: string
  /** [v0] DEBUG: the region's role word (e.g. "lifelane", "do-list", "dock"). */
  debugRole?: string
}) {
  // [v0] DEBUG: red border + ID label are gated on the shared `§ 2` toggle.
  const { frames: showFrames } = useDebugView()
  return (
    <motion.div
      data-region
      data-region-grow={grow}
      className={cn(
        "relative",
        // [v0] DEBUG: red border = each region's footprint within the View.
        showFrames && "border border-red-500",
        grow === "fill" ? "flex min-h-0 flex-1 flex-col" : "shrink-0",
        className,
      )}
      style={style}
      initial={false}
      animate={{ y: lift }}
      transition={layerTransition}
    >
      {/* [v0] DEBUG: a region is always full-width within the View (h:fill); its
          vertical sizing is exactly its `grow` (fill = take leftover, hug = wrap). */}
      {showFrames && debugName ? (
        <DebugFrameLabel
          name={debugName}
          info={`${debugRole ? `${debugRole} · ` : ""}h:fill v:${grow}`}
          className="text-red-500"
        />
      ) : null}
      {children}
    </motion.div>
  )
}
