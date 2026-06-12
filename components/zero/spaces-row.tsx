"use client"

import { useState } from "react"
import { AnimatePresence } from "motion/react"
import { PinOff } from "lucide-react"
import { getPinnedItems, unpinItem, type ContextItem } from "@/lib/zero/data"
import { useZeroNav } from "@/lib/zero/nav-store"
import { PinnedCard } from "./pinned-card"
import { ContextMenu, type ContextMenuState } from "./context-menu"

/**
 * The Spaces row — the horizontal strip of pinned items that sits between the
 * timeline and the inputs/tasks/outputs lists. It lives in the persistent
 * frontmost layer (FrontContent), so it re-reads the active context's pins
 * instantly on navigation rather than animating in with each window frame.
 *
 * Pins are per-context: an item shows here only in the space it was pinned
 * from. Items are promoted here via right-click "Pin to Spaces" in the task
 * list, and right-clicking a card here unpins it (sending it back to the list).
 * When a context has no pins, the whole row is hidden.
 */
export function SpacesRow({ contextSpaceId }: { contextSpaceId: string }) {
  const { openSpace, openTask, dataVersion, notifyDataChanged } = useZeroNav()
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  // Re-read pins whenever data mutates or the context changes.
  void dataVersion
  const pinned: ContextItem[] = getPinnedItems(contextSpaceId)
  const hasPins = pinned.length > 0

  const open = (item: ContextItem) => {
    if (item.kind === "space") openSpace(item.space!.id)
    else if (item.kind === "task") openTask(item.task!.id)
    else openSpace(item.event!.spaceId)
  }

  const openMenu = (e: React.MouseEvent, item: ContextItem) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "Unpin from Spaces",
          icon: <PinOff className="h-3.5 w-3.5" />,
          onSelect: () => {
            unpinItem(contextSpaceId, item.id)
            notifyDataChanged()
          },
        },
      ],
    })
  }

  return (
    <div
      className={
        "pointer-events-auto flex shrink-0 flex-col items-center " +
        (hasPins ? "pb-1 pt-3" : "")
      }
    >
      {/* Header collapses when empty, but the AnimatePresence below must stay
          mounted regardless. */}
      {hasPins && (
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Spaces
        </h3>
      )}

      {/* CRITICAL: key this container by context so it HARD-remounts when the
          active context changes — exactly like the task list's `<ul key={spaceId}>`.
          A persistent AnimatePresence (mode="popLayout") instead leaves the card
          as a lingering "exiting" instance when its space opens (context → child,
          pins empty); on close that stale exit collides with the re-entering card
          and Framer strands it at opacity:0. A fresh per-context AnimatePresence
          has no stale instances, so the shared-layoutId morph (frame ↔ card)
          resolves cleanly in both directions. */}
      <div key={contextSpaceId} className="flex w-full flex-wrap items-stretch justify-center gap-3">
        <AnimatePresence initial={false} mode="popLayout">
          {pinned.map((item) => (
            <PinnedCard
              key={item.id}
              item={item}
              onOpen={() => open(item)}
              onContextMenu={(e) => openMenu(e, item)}
            />
          ))}
        </AnimatePresence>
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
