"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { PinOff, Trash2, Ban, RotateCcw } from "lucide-react"
import { layerTransition } from "@/lib/zero/motion"
import { computeDockLayout } from "@/lib/zero/dock-layout"
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
import { cn } from "@/lib/utils"

/**
 * The Dock — the horizontal strip of pinned entities that sits between the
 * timeline and the inputs/do-list/outputs columns. It lives in the persistent
 * frontmost layer, so it re-reads the active context's pins instantly on
 * navigation rather than animating in with each window frame.
 *
 * Pins are per-context: an entity shows here only in the context it was pinned
 * from. Entities are promoted here via right-click "Pin to Dock" in the do
 * list, and right-clicking a card here unpins it. The Dock renders as the entity's
 * region 2 (a bottom HUG region); EntityBody mounts it ONLY when the context has
 * pins, so an empty context has no dock region at all and its do-list fills the view.
 */
export function Dock({ contextId, active = true }: { contextId: string; active?: boolean }) {
  const { open, dataVersion, notifyDataChanged, morphCommit, setMenuKey, selection, moveSelection, publishNavOrder, stack } =
    useZeroNav()
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  // Re-read pins whenever data mutates or the context changes.
  void dataVersion
  const pinned: ContextItem[] = getPinnedItems(contextId)
  const hasPins = pinned.length > 0

  const parentIsSpace = getEntity(contextId)?.kind === "space"
  const contextDepth = Math.max(0, stack.indexOf(contextId))

  // RESPONSIVE DOCK: measure the region's actual inner width (which already reflects
  // an open in/out panel squeezing REG2 via the View's padding — no coupling to panel
  // state). The pure `computeDockLayout` engine turns that width + pin count into card
  // size, content scale, and either a single row or an interlocking honeycomb of rows.
  const rowRef = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setAvailableWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev))
    })
    ro.observe(el)
    setAvailableWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const layout = useMemo(
    () => computeDockLayout({ availableWidth, count: pinned.length, parentIsSpace, contextDepth }),
    [availableWidth, pinned.length, parentIsSpace, contextDepth],
  )

  // Slice the pins into honeycomb rows per the layout (single-element array = one row).
  const rows = useMemo(() => {
    const out: ContextItem[][] = []
    let i = 0
    for (const n of layout.rowCounts) {
      out.push(pinned.slice(i, i + n))
      i += n
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.rowCounts, pinned])

  const dockMetrics = { cardW: layout.cardW, cardH: layout.cardH, contentScale: layout.contentScale }

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
  // Up crosses back UP into the do list (the dock now sits BELOW the list).
  // Inert while a text input is focused.
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
        case "ArrowUp":
          e.preventDefault()
          moveSelection("up")
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
    // Keep this card lit while its menu is open (pointer may move onto the menu).
    setMenuKey(`${contextId}:${item.id}`)
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
            // Morph the card back up into its do-list row (frame + glyph + title
            // glide, Spaces morph hexagon→rectangle) via the shared Flip stage —
            // `morphCommit` raises the `animating` gate so framer stands down.
            morphCommit(() => {
              unpinItem(contextId, item.id)
              notifyDataChanged()
            }, `${contextId}:${item.id}`)
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
    // Region-2 (hug) content. EntityBody mounts the Dock ONLY when the context has
    // pins, so this whole element appears/disappears with the dock region. On mount
    // it SLIDES UP into its reserved flow slot via a transform (y/opacity) — the
    // region already reserves the height, so region 1 reflows once and the dock rises
    // into place on the compositor rather than animating layout. Per-card add/remove
    // is still the GSAP Flip morph + AnimatePresence below; this entrance is only the
    // region's own appearance.
    <motion.div
      className={cn(
        "pointer-events-auto flex shrink-0 flex-col items-center",
        hasPins ? "py-4" : "pt-5",
      )}
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={layerTransition}
    >
      {/* Measured wrapper: `rowRef` reads the REG2 inner width (auto-captures the panel
          squeeze). The engine decides single row vs. honeycomb from it.
          CRITICAL: key the inner stack by context so it HARD-remounts when the active
          context changes — exactly like the do list's `<ul key={contextId}>` — so card
          enter/exit resolves cleanly with no stale exiting instances. */}
      <div ref={rowRef} className="w-full">
        <div key={contextId} className="flex w-full flex-col items-center">
          <AnimatePresence initial={false} mode="popLayout">
            {rows.map((rowItems, rowIdx) => (
              <div
                key={`row-${rowIdx}`}
                className="flex flex-nowrap items-stretch justify-center transition-[gap,margin,transform] duration-300 ease-out"
                style={{
                  gap: layout.gapX,
                  // Honeycomb: rows after the first pull UP so hexagons interlock, and
                  // adjacent rows shift half a period so cards nest in the valleys of the
                  // row above. The shift is SPLIT symmetrically — odd rows +½ offset, even
                  // rows −½ offset — so the relative nesting shift is a full half-period
                  // while the whole group stays centered (each row is justify-center), which
                  // keeps it inside the width the engine reserved (cols + 0.5). Applied to
                  // the ROW wrapper (not per-card) so each card's GSAP Flip rect stays honest.
                  marginTop: rowIdx > 0 ? -layout.rowOverlap : 0,
                  transform: layout.multiRow
                    ? `translateX(${(rowIdx % 2 === 1 ? 1 : -1) * (layout.rowOffset / 2)}px)`
                    : undefined,
                }}
              >
                {rowItems.map((item) => (
                  <EntityNode
                    key={item.id}
                    entityId={item.entity.id}
                    contextId={contextId}
                    variant="dock"
                    dockMetrics={dockMetrics}
                    onContextMenu={(e) => openMenu(e, item)}
                  />
                ))}
              </div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <ContextMenu
        state={menu}
        onClose={() => {
          setMenu(null)
          setMenuKey(null)
        }}
      />
    </motion.div>
  )
}
