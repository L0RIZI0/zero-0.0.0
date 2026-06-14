"use client"

import { motion, useIsPresent } from "motion/react"
import { X } from "lucide-react"
import type { Entity } from "@/lib/zero/types"
import { layerTransition, spaceLayoutId, spaceTitleId, glyphId, contentTransition } from "@/lib/zero/motion"
import { NodeGlyph } from "./node-glyph"
import { EntityBody } from "./entity-body"

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
  space: Entity
  isRoot: boolean
  isActive: boolean
  onClose: () => void
}) {
  const accent = space.accent ?? "var(--accent)"

  // While exiting (close morph), drop the shared layoutIds so the re-mounting
  // dock card / list row is the sole owner and morphs cleanly from this frame's
  // last snapshot — otherwise two live owners crossfade into an offset ghost.
  const isPresent = useIsPresent()
  const bodyMorphId = isPresent ? spaceLayoutId(space.id) : undefined
  const accentMorphId = isPresent ? `${spaceLayoutId(space.id)}-accent` : undefined
  const titleMorphId = isPresent ? spaceTitleId(space.id) : undefined
  const glyphMorphId = isPresent ? glyphId(space.id) : undefined

  // Space 0 (root) is borderless — the surface itself stands in for it.
  if (isRoot) return null

  return (
    <motion.div
      layoutId={bodyMorphId}
      transition={layerTransition}
      style={{ borderRadius: 4 }}
      className="relative flex h-full w-full flex-col overflow-hidden border border-border bg-secondary/40 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)]"
    >
      {/* accent edge — shares element with the button's accent strip */}
      <motion.span
        layoutId={accentMorphId}
        transition={layerTransition}
        className="absolute left-0 top-0 z-10 h-full w-[3px]"
        style={{ backgroundColor: accent }}
      />

      {/* Title band. Only the active (frontmost) frame paints its header — a
          receding parent frame would otherwise bleed its title / description /
          close button through the opaque active layer. Sits above the frontmost
          timeline; the timeline animates down to clear this band's height. */}
      {isActive && (
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3">
          <div className="flex min-w-0 items-start gap-3">
            <motion.span
              layoutId={glyphMorphId}
              transition={layerTransition}
              className="mt-0.5 flex h-[24px] w-[24px] shrink-0 items-center justify-center text-foreground"
            >
              <NodeGlyph kind="space" />
            </motion.span>
            <div className="flex min-w-0 flex-col">
              <motion.h2
                layoutId={titleMorphId}
                transition={layerTransition}
                className="truncate text-[22px] font-medium leading-tight tracking-tight text-foreground"
              >
                {space.title}
              </motion.h2>
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
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${space.title}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* The body (spaces row / tasks / inputs / outputs) is rendered HERE,
          inside the frame, only for the active (frontmost) frame. Receding
          parent frames render an empty middle — their bodies unmount, so only
          the active entity's list is ever visible. */}
      {isActive ? (
        <EntityBody nodeId={space.id} />
      ) : (
        <div className="min-h-0 flex-1" aria-hidden />
      )}
    </motion.div>
  )
}
