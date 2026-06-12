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
  const { open, dataVersion, notifyDataChanged } = useZeroNav()
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  // Re-read pins whenever data mutates or the context changes.
  void dataVersion
  const pinned: ContextItem[] = getPinnedItems(contextSpaceId)
  const hasPins = pinned.length > 0

  const openItem = (item: ContextItem) => {
    // Spaces and tasks open as their own framed window; an event resolves to
    // its origin parent space (events aren't framed contexts of their own).
    if (item.kind === "event") open(item.entity.parentId ?? "s_root")
    else open(item.entity.id)
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
        // When empty, keep a breathing gap between the timeline and the lists
        // below; when populated, add extra top room now that the SPACES label
        // (which used to provide that separation from the timeline) is gone.
        (hasPins ? "pb-1 pt-6" : "pt-5")
      }
    >
      {/* The Dock has no visible label; spacing above adjusts based on whether
          any items are pinned. The AnimatePresence below must stay mounted
          regardless. */}

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
              onOpen={() => openItem(item)}
              onContextMenu={(e) => openMenu(e, item)}
            />
          ))}
        </AnimatePresence>
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
