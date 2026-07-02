"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { PinOff, Trash2, Ban, RotateCcw } from "lucide-react"
import { layerTransition } from "@/lib/zero/motion"
import { computeDockLayout, dockCardBoxes, dockStructureKey } from "@/lib/zero/dock-layout"
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

  // Resolve the layout into ABSOLUTE per-card boxes + the container size. Cards are
  // rendered as ONE flat, stably-keyed list of absolutely-positioned nodes (they never
  // re-parent between row <div>s, so nothing remounts and there is no jump), and each
  // card just CSS-transitions its box when the structure flips single↔honeycomb.
  const { boxes, height: containerH } = useMemo(
    () => dockCardBoxes(layout, availableWidth),
    [layout, availableWidth],
  )

  // ONE-SHOT TWEEN ACROSS A STRUCTURAL FLIP. `dockStructureKey` changes only when the
  // row breakdown or card SIZE changes (not on every continuous width tick). While the
  // key is steady we leave positions un-transitioned so cards track a panel squeeze in
  // real time; the instant it changes (single↔honeycomb, or a size step) we switch the
  // transition ON for one morph beat, then off again — so the rearrangement glides
  // instead of snapping onto two lines.
  const structureKey = dockStructureKey(layout)
  const prevStructure = useRef(structureKey)
  const [animateLayout, setAnimateLayout] = useState(false)
  useEffect(() => {
    if (prevStructure.current === structureKey) return
    prevStructure.current = structureKey
    setAnimateLayout(true)
    const t = setTimeout(() => setAnimateLayout(false), 420)
    return () => clearTimeout(t)
  }, [structureKey])

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
          squeeze); the engine turns it into per-card boxes.
          The inner container is `position: relative` with an explicit height (cards are
          absolutely positioned inside it). It is keyed by context so it HARD-remounts on
          navigation — exactly like the do list's `<ul key={contextId}>` — so card
          enter/exit resolves cleanly with no stale exiting instances. */}
      <div ref={rowRef} className="w-full">
        <div
          key={contextId}
          className="relative mx-auto transition-[height] duration-300 ease-out"
          style={{ height: containerH }}
        >
          <AnimatePresence initial={false}>
            {pinned.map((item, idx) => {
              const box = boxes[idx]
              if (!box) return null
              return (
                <EntityNode
                  key={item.id}
                  entityId={item.entity.id}
                  contextId={contextId}
                  variant="dock"
                  dockMetrics={dockMetrics}
                  dockPos={{ left: box.left, top: box.top, animate: animateLayout }}
                  onContextMenu={(e) => openMenu(e, item)}
                />
              )
            })}
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
