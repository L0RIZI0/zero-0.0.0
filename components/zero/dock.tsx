"use client"

import { useEffect, useMemo, useState } from "react"
import { AnimatePresence } from "motion/react"
import { PinOff, Trash2, Ban, RotateCcw } from "lucide-react"
import {
  getEntity,
  getPinnedItems,
  unpinItem,
  deleteEntity,
  setEventCancelled,
  type ContextItem,
} from "@/lib/zero/data"
import { useZeroNav } from "@/lib/zero/nav-store"
import { EntityNode } from "./entity-node"
import { ContextMenu, type ContextMenuState } from "./context-menu"

/**
 * The Dock — the horizontal strip of pinned entities that sits between the
 * timeline and the inputs/do-list/outputs columns. It lives in the persistent
 * frontmost layer, so it re-reads the active context's pins instantly on
 * navigation rather than animating in with each window frame.
 *
 * Pins are per-context: an entity shows here only in the context it was pinned
 * from. Entities are promoted here via right-click "Pin to Dock" in the do
 * list, and right-clicking a card here unpins it. When a context has no pins,
 * the whole dock collapses to a small gap.
 */
export function Dock({ contextId, active = true }: { contextId: string; active?: boolean }) {
  const { open, dataVersion, notifyDataChanged, selection, moveSelection, publishNavOrder } =
    useZeroNav()
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  // Re-read pins whenever data mutates or the context changes.
  void dataVersion
  const pinned: ContextItem[] = getPinnedItems(contextId)
  const hasPins = pinned.length > 0

  // Pinned cards inside a NON-space entity's dock (a task/event/instant context)
  // are spaced a little wider than inside a Space, where they pack tighter.
  const parentIsSpace = getEntity(contextId)?.kind === "space"
  const dockGap = parentIsSpace ? "gap-3" : "gap-5"

  const openItem = (item: ContextItem) => {
    // Every kind — including events/instants — opens its own window now.
    open(item.entity.id)
  }

  // Publish the dock's navigable order (card entity ids) for the store's
  // arrow-key math. Recomputed whenever the pin set or context changes.
  const dockKeys = useMemo(
    () => pinned.map((p) => p.entity.id),
    // dataVersion captures pin add/remove; contextId captures navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contextId, dataVersion],
  )
  useEffect(() => {
    if (!active) return
    publishNavOrder("dock", dockKeys)
  }, [active, dockKeys, publishNavOrder])

  // Window-level keyboard handler, active only while the dock owns the
  // selection: Enter opens the selected card; Left/Right move between cards;
  // Down crosses back down into the do list. Inert while a text input is focused.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (!selection || selection.region !== "dock") return
      const ae = document.activeElement as HTMLElement | null
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault()
          moveSelection("left")
          break
        case "ArrowRight":
          e.preventDefault()
          moveSelection("right")
          break
        case "ArrowDown":
          e.preventDefault()
          moveSelection("down")
          break
        case "Enter": {
          e.preventDefault()
          const item = pinned.find((p) => p.entity.id === selection.key)
          if (item) openItem(item)
          break
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // `pinned` is recomputed each render; including it keeps Enter targeting the
    // current cards without resubscribing more than necessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selection, moveSelection, pinned])

  const openMenu = (e: React.MouseEvent, item: ContextItem) => {
    e.preventDefault()
    e.stopPropagation()
    const canCancel = item.kind === "event" || item.kind === "instant"
    const isCancelled = !!item.entity.cancelled
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "Unpin from Dock",
          icon: <PinOff className="h-3.5 w-3.5" />,
          onSelect: () => {
            unpinItem(contextId, item.id)
            notifyDataChanged()
          },
        },
        ...(canCancel
          ? [
              {
                label: isCancelled ? "Restore" : "Cancel",
                icon: isCancelled ? (
                  <RotateCcw className="h-3.5 w-3.5" />
                ) : (
                  <Ban className="h-3.5 w-3.5" />
                ),
                onSelect: () => {
                  setEventCancelled(item.id, !isCancelled)
                  notifyDataChanged()
                },
              },
            ]
          : []),
        {
          label: "Delete",
          icon: <Trash2 className="h-3.5 w-3.5" />,
          onSelect: () => {
            deleteEntity(item.id)
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
        // below; when populated, add extra top room.
        (hasPins ? "pb-1 pt-6" : "pt-5")
      }
    >
      {/* CRITICAL: key this container by context so it HARD-remounts when the
          active context changes — exactly like the do list's `<ul key={contextId}>`.
          A fresh per-context AnimatePresence has no stale "exiting" instances,
          so card enter/exit resolves cleanly in both directions. */}
      {/* `flex-nowrap` keeps the dock on a SINGLE row at all times. It used to
          `flex-wrap`, so while a window was still mid-expansion (container narrow)
          the cards momentarily wrapped onto several lines before snapping back to
          one once the frame reached full width. One line avoids that reflow. */}
      <div key={contextId} className={"flex w-full flex-nowrap items-stretch justify-center " + dockGap}>
        <AnimatePresence initial={false} mode="popLayout">
          {pinned.map((item) => (
            <EntityNode
              key={item.id}
              entityId={item.entity.id}
              contextId={contextId}
              variant="dock"
              onContextMenu={(e) => openMenu(e, item)}
            />
          ))}
        </AnimatePresence>
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
