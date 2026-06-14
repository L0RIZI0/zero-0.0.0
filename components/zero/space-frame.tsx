"use client"

import { motion } from "motion/react"
import { X } from "lucide-react"
import type { Entity } from "@/lib/zero/types"
import { layerTransition, spaceLayoutId, spaceTitleId, glyphId, contentTransition } from "@/lib/zero/motion"
import { NodeGlyph } from "./node-glyph"
import { EntityBody } from "./entity-body"

/**
 * A child Space window in the nested-doll stack. Renders the compact nav-bar
 * header (accent edge + glyph + title + close) so the space's header peeks above
 * its children. Root (Space 0) never renders a frame — it's the home backdrop in
 * WorkSurface — so this component is only ever a depth >= 1 window.
 */
export function SpaceFrame({
  space,
  depth,
  isTop,
  onCloseTo,
}: {
  space: Entity
  depth: number
  isTop: boolean
  onCloseTo: (targetTopIndex: number) => void
}) {
  const accent = space.accent ?? "var(--accent)"

  // Shared morph ids — the frame and its origin dock card / row own the same
  // layoutIds. Static per-depth geometry keeps the morph projection clean.
  const bodyMorphId = spaceLayoutId(space.id)
  const accentMorphId = `${spaceLayoutId(space.id)}-accent`
  const titleMorphId = spaceTitleId(space.id)
  const glyphMorphId = glyphId(space.id)

  return (
    <motion.div
      layoutId={bodyMorphId}
      transition={layerTransition}
      style={{ borderRadius: 4 }}
      className="relative flex h-full w-full flex-col overflow-hidden border border-border bg-card shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)]"
    >
      {/* accent edge — shares element with the button's accent strip */}
      <motion.span
        layoutId={accentMorphId}
        transition={layerTransition}
        className="absolute left-0 top-0 z-10 h-full w-[3px]"
        style={{ backgroundColor: accent }}
      />

      {/* Compact nav-bar header — always rendered so this space's title peeks
          above its children. `pointer-events:auto` keeps the close button live
          even when this is an ancestor window (its container is inert). */}
      <div
        className="relative flex min-h-[40px] items-center gap-2 px-3"
        style={{ pointerEvents: "auto" }}
      >
        <motion.span
          layoutId={glyphMorphId}
          transition={layerTransition}
          className="flex h-5 w-5 shrink-0 items-center justify-center text-foreground"
        >
          <NodeGlyph kind="space" />
        </motion.span>

        <motion.h2
          layoutId={titleMorphId}
          transition={layerTransition}
          className="min-w-0 flex-1 truncate whitespace-nowrap text-sm font-medium leading-tight tracking-tight text-foreground"
        >
          {space.title}
        </motion.h2>

        <button
          type="button"
          onClick={() => onCloseTo(depth - 1)}
          aria-label={`Close ${space.title}`}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Description — only the top window shows it (ancestors are covered below
          their header peek). */}
      {isTop && space.description && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...contentTransition, delay: 0.08 }}
          className="truncate px-3 pb-2 pl-4 text-[12.5px] text-muted-foreground"
        >
          {space.description}
        </motion.p>
      )}

      {/* Body renders at full opacity so the close shrink stays fully visible. */}
      <EntityBody nodeId={space.id} />
    </motion.div>
  )
}
