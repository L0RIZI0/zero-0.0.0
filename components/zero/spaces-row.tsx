"use client"

import type { Space } from "@/lib/zero/types"
import { getChildSpaces } from "@/lib/zero/data"
import { useZeroNav } from "@/lib/zero/nav-store"
import { SpaceButton } from "./space-button"

/**
 * The Spaces row — the horizontal strip of child-space buttons that sits
 * between the timeline and the inputs/tasks/outputs lists. It lives in the
 * persistent frontmost layer (FrontContent), so it re-reads the active
 * context's children instantly on navigation rather than animating in with
 * each window frame.
 *
 * When the active context has no child spaces, the whole row is hidden. New
 * spaces are created from the "+ ADD" button at the bottom of the task list.
 */
export function SpacesRow({ contextSpaceId }: { contextSpaceId: string }) {
  const { openSpace, dataVersion } = useZeroNav()

  // Re-read children whenever data mutates or the context changes. Reading on
  // every render is cheap (in-memory filter) and keeps the row instant.
  void dataVersion
  const children: Space[] = getChildSpaces(contextSpaceId)

  // No subspaces in this context → hide the row entirely.
  if (children.length === 0) return null

  return (
    <div className="pointer-events-auto flex shrink-0 flex-col items-center pb-1 pt-3">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Spaces
      </h3>
      <div className="flex w-full flex-wrap items-stretch justify-center gap-3">
        {children.map((child) => (
          <SpaceButton key={child.id} space={child} onOpen={openSpace} />
        ))}
      </div>
    </div>
  )
}
