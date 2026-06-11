"use client"

import { motion } from "motion/react"
import { X } from "lucide-react"
import { useState } from "react"
import type { Space } from "@/lib/zero/types"
import { layerTransition, spaceLayoutId, spaceTitleId, contentTransition } from "@/lib/zero/motion"
import { SPACES_DOCK_HEIGHT } from "@/lib/zero/layout"
import { SpaceButton } from "./space-button"
import { CreateWindow } from "./create-window"
import { getChildSpaces } from "@/lib/zero/data"

/**
 * A child Space window — chrome only. It paints the bordered, off-white frame,
 * owns the title band (top) and the spaces dock (bottom), and leaves its middle
 * transparent so the persistent frontmost content (timeline / tasks / inputs /
 * outputs in FrontContent) reads in front of it. Space 0 (root) renders nothing
 * here — its background is the surface itself.
 */
export function SpaceFrame({
  space,
  isRoot,
  isActive,
  onOpenChild,
  onClose,
}: {
  space: Space
  isRoot: boolean
  isActive: boolean
  onOpenChild: (spaceId: string) => void
  onClose: () => void
}) {
  const [creating, setCreating] = useState(false)
  const accent = space.accent ?? "var(--accent)"
  const children = getChildSpaces(space.id)

  // Space 0 (root) is a borderless, non-closable window. It has no title band
  // (the shell header carries identity) but it still shows the spaces dock at
  // the bottom so the user can browse and create top-level spaces.
  if (isRoot) {
    return (
      <div className="relative flex h-full w-full flex-col">
        <div className="min-h-0 flex-1" aria-hidden />
        <SpacesDock
          heading="Spaces"
          spaces={children}
          onOpenChild={onOpenChild}
          onAdd={() => setCreating(true)}
        />
        {creating && (
          <CreateWindow spaceId={space.id} defaultKind="space" onClose={() => setCreating(false)} />
        )}
      </div>
    )
  }

  return (
    <motion.div
      layoutId={spaceLayoutId(space.id)}
      transition={layerTransition}
      style={{ borderRadius: 4 }}
      className="relative flex h-full w-full flex-col overflow-hidden border border-border bg-background shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)]"
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

      {/* Transparent middle — the persistent timeline / tasks / inputs / outputs
          (FrontContent, a higher z-layer) render over this gap. */}
      <div className="min-h-0 flex-1" aria-hidden />

      {/* Spaces dock — this window's child subspaces, pinned to the bottom. */}
      <SpacesDock
        heading="Subspaces"
        spaces={children}
        onOpenChild={onOpenChild}
        onAdd={() => setCreating(true)}
        animate
      />

      {creating && (
        <CreateWindow spaceId={space.id} defaultKind="space" onClose={() => setCreating(false)} />
      )}
    </motion.div>
  )
}

/** Bottom dock listing child spaces plus a trailing "+ ADD" card. */
function SpacesDock({
  heading,
  spaces,
  onOpenChild,
  onAdd,
  animate = false,
}: {
  heading: string
  spaces: Space[]
  onOpenChild: (spaceId: string) => void
  onAdd: () => void
  animate?: boolean
}) {
  const motionProps = animate
    ? {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { ...contentTransition, delay: 0.1 },
      }
    : {}
  return (
    <motion.div
      {...motionProps}
      className="flex shrink-0 flex-col items-center px-6 pb-4"
      style={{ height: SPACES_DOCK_HEIGHT }}
    >
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {heading}
      </h3>
      <div className="flex w-full flex-1 flex-wrap items-stretch justify-center gap-3 overflow-x-auto pb-1 no-scrollbar">
        {spaces.map((child) => (
          <SpaceButton key={child.id} space={child} onOpen={onOpenChild} />
        ))}
        <AddSpaceCard onClick={onAdd} />
      </div>
    </motion.div>
  )
}

/** An empty "+ ADD" card matching the SpaceButton footprint. */
function AddSpaceCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Add subspace"
      style={{ borderRadius: 4 }}
      className="flex h-[64px] w-[150px] shrink-0 flex-col items-center justify-center gap-1 border border-dashed border-border bg-transparent text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      <span className="text-[11px] font-medium uppercase tracking-[0.12em]">+ Add</span>
    </button>
  )
}
