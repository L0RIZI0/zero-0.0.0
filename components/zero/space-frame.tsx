"use client"

import { motion } from "motion/react"
import { X } from "lucide-react"
import type { Space } from "@/lib/zero/types"
import { layerTransition, spaceLayoutId, spaceTitleId, contentTransition } from "@/lib/zero/motion"

/**
 * A child Space window — chrome only. It paints the bordered, off-white frame
 * and owns the title band (top); everything else (timeline, the spaces row,
 * tasks, inputs, outputs) lives in the persistent frontmost layer (FrontContent)
 * that reads in front of it. Space 0 (root) renders nothing here — its
 * background is the surface itself.
 */
export function SpaceFrame({
  space,
  isRoot,
  isActive,
  onClose,
}: {
  space: Space
  isRoot: boolean
  isActive: boolean
  onClose: () => void
}) {
  const accent = space.accent ?? "var(--accent)"

  // Space 0 (root) is borderless — the surface itself stands in for it.
  if (isRoot) return null

  return (
    <motion.div
      layoutId={spaceLayoutId(space.id)}
      transition={layerTransition}
      style={{ borderRadius: 4 }}
      className="relative flex h-full w-full flex-col overflow-hidden border border-border bg-secondary/40 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)]"
    >
      {/* accent edge — shares element with the button's accent strip */}
      <motion.span
        layoutId={`${spaceLayoutId(space.id)}-accent`}
        transition={layerTransition}
        className="absolute left-0 top-0 z-10 h-full w-[3px]"
        style={{ backgroundColor: accent }}
      />

      {/* Title band. Sits above the frontmost timeline; the timeline animates
          down to clear whatever height this band occupies (title, +description). */}
      <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3">
        <div className="flex min-w-0 flex-col">
          {isActive && (
            <motion.h2
              layoutId={spaceTitleId(space.id)}
              transition={layerTransition}
              className="truncate text-[22px] font-medium leading-tight tracking-tight text-foreground"
            >
              {space.name}
            </motion.h2>
          )}
          {space.description && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ ...contentTransition, delay: 0.08 }}
              className="mt-0.5 truncate text-[12.5px] text-muted-foreground"
            >
              {space.description}
            </motion.p>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${space.name}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Transparent remainder — the persistent FrontContent layer (timeline /
          spaces row / tasks / inputs / outputs) renders over this gap. */}
      <div className="min-h-0 flex-1" aria-hidden />
    </motion.div>
  )
}
