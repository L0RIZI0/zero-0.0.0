"use client"

import { useState } from "react"
import { motion } from "motion/react"
import type { Space } from "@/lib/zero/types"
import { getChildSpaces } from "@/lib/zero/data"
import { useZeroNav } from "@/lib/zero/nav-store"
import { SpaceButton } from "./space-button"
import { CreateWindow } from "./create-window"

/**
 * The Spaces row — the horizontal strip of child-space buttons (plus a trailing
 * "+ ADD" card) that sits between the timeline and the inputs/tasks/outputs
 * lists. It lives in the persistent frontmost layer (FrontContent), so it
 * re-reads the active context's children instantly on navigation rather than
 * animating in with each window frame.
 *
 * For a task context (tasks have no subspaces) it renders nothing.
 */
export function SpacesRow({ contextSpaceId }: { contextSpaceId: string }) {
  const { openSpace, dataVersion } = useZeroNav()
  const [creating, setCreating] = useState(false)

  // Re-read children whenever data mutates or the context changes. Reading on
  // every render is cheap (in-memory filter) and keeps the row instant.
  void dataVersion
  const children: Space[] = getChildSpaces(contextSpaceId)

  return (
    <div className="flex shrink-0 flex-col items-center pb-1 pt-1">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Spaces
      </h3>
      <div className="flex w-full flex-wrap items-stretch justify-center gap-3">
        {children.map((child) => (
          <SpaceButton key={child.id} space={child} onOpen={openSpace} />
        ))}
        <AddSpaceCard onClick={() => setCreating(true)} />
      </div>

      {creating && (
        <CreateWindow spaceId={contextSpaceId} defaultKind="space" onClose={() => setCreating(false)} />
      )}
    </div>
  )
}

/** An empty "+ ADD" card matching the SpaceButton footprint. */
function AddSpaceCard({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label="Add space"
      style={{ borderRadius: 4 }}
      whileHover={{ scale: 1.03 }}
      className="flex h-[64px] w-[150px] shrink-0 flex-col items-center justify-center gap-1 border border-dashed border-border bg-transparent text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      <span className="text-[11px] font-medium uppercase tracking-[0.12em]">+ Add</span>
    </motion.button>
  )
}
