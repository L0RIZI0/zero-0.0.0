"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { layerTransition } from "@/lib/zero/motion"
import { computeDockLayout, dockCardBoxes } from "@/lib/zero/dock-layout"
import {
  getEntity,
  getPinnedItems,
  reorderPins,
  type ContextItem,
} from "@/lib/zero/data"
import { useZeroNav } from "@/lib/zero/nav-store"
import { EntityNode } from "./entity-node"
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
  const { open, dataVersion, notifyDataChanged, selection, moveSelection, publishNavOrder, stack } =
    useZeroNav()

  // Re-read pins whenever data mutates or the context changes.
  void dataVersion
  const pinned: ContextItem[] = getPinnedItems(contextId)
  const hasPins = pinned.length > 0

  // DRAG-AND-DROP REORDER. The dock is an absolutely-positioned honeycomb (not a
  // flow list), so motion's Reorder can't drive it — we drive it by hand. `liveOrder`
  // is a local mirror of the pin ids; a drag rearranges it instantly (nearest-slot
  // snapping) and we persist it on drop via `reorderPins`. Cards are directly
  // draggable — no handles. While a drag is in flight we never resync from data
  // (that would yank the card from the cursor).
  const pinnedIds = pinned.map((p) => p.entity.id)
  const pinnedKey = pinnedIds.join("|")
  const [liveOrder, setLiveOrder] = useState<string[]>(pinnedIds)
  const liveOrderRef = useRef(liveOrder)
  liveOrderRef.current = liveOrder
  const draggingRef = useRef(false)
  // The card following the pointer. `px/py` = pointer position in CONTAINER coords;
  // `ox/oy` = where inside the card it was grabbed. The card renders at `px-ox, py-oy`,
  // so it stays glued to the cursor no matter how its slot index reshuffles beneath it.
  const [drag, setDrag] = useState<{ id: string; px: number; py: number; ox: number; oy: number } | null>(null)
  // The id currently gliding home after a drop (its left/top transition is kept on for
  // one cycle so it eases from the drop point into its final slot instead of snapping).
  const [landing, setLanding] = useState<string | null>(null)
  // The positioned honeycomb container — pointer math is done relative to its box.
  const gridRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number; started: boolean } | null>(null)
  // Set true for the click that immediately follows a real drag, so it doesn't ALSO
  // open the card (a drag and an open are mutually exclusive).
  const justDraggedRef = useRef(false)
  useEffect(() => {
    if (draggingRef.current) return
    setLiveOrder(pinnedIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedKey])

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
  // re-parent, so nothing remounts and there is no jump); each just tracks its box.
  const { boxes, height: containerH } = useMemo(
    () => dockCardBoxes(layout, availableWidth),
    [layout, availableWidth],
  )

  const dockMetrics = { cardW: layout.cardW, cardH: layout.cardH, contentScale: layout.contentScale }

  // The cards in their LIVE visual order (data order, or the drag's rearrangement).
  // Slot `idx` of this list maps to `boxes[idx]`, so reordering the list repositions
  // cards. Ids missing from `pinned` (stale mid-transition) are skipped.
  const byId = useMemo(() => {
    const m = new Map<string, ContextItem>()
    for (const p of pinned) m.set(p.entity.id, p)
    return m
  }, [pinned])
  const orderedItems = liveOrder.map((id) => byId.get(id)).filter(Boolean) as ContextItem[]

  // Move `id` to visual slot `j` within an order array (used as the pointer sweeps
  // over slots during a drag).
  const moveTo = (order: string[], id: string, j: number) => {
    const arr = order.filter((x) => x !== id)
    arr.splice(Math.max(0, Math.min(j, arr.length)), 0, id)
    return arr
  }

  const cardW = layout.cardW
  const cardH = layout.cardH

  const onCardPointerDown = (e: React.PointerEvent, id: string, box: { left: number; top: number }) => {
    // Left button only; ignore if a card is open/animating into a window.
    if (e.button !== 0) return
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, ox: px - box.left, oy: py - box.top, started: false }

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current
      const g = gridRef.current?.getBoundingClientRect()
      if (!d || !g) return
      // Threshold: only promote to a real drag past 4px, so a plain tap still opens.
      if (!d.started) {
        if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < 4) return
        d.started = true
        draggingRef.current = true
      }
      const npx = ev.clientX - g.left
      const npy = ev.clientY - g.top
      setDrag({ id: d.id, px: npx, py: npy, ox: d.ox, oy: d.oy })
      // Nearest slot to the dragged card's center → target visual index.
      const cx = npx - d.ox + cardW / 2
      const cy = npy - d.oy + cardH / 2
      let best = 0
      let bestDist = Number.POSITIVE_INFINITY
      boxes.forEach((b, i) => {
        const dx = b.left + cardW / 2 - cx
        const dy = b.top + cardH / 2 - cy
        const dist = dx * dx + dy * dy
        if (dist < bestDist) {
          bestDist = dist
          best = i
        }
      })
      setLiveOrder((prev) => moveTo(prev, d.id, best))
    }

    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      const d = dragRef.current
      dragRef.current = null
      if (d?.started) {
        justDraggedRef.current = true
        // Fallback: if no click follows (e.g. pointer released off the card), clear the
        // suppression flag so a later genuine tap still opens.
        window.setTimeout(() => {
          justDraggedRef.current = false
        }, 300)
        reorderPins(contextId, liveOrderRef.current)
        notifyDataChanged()
        // Keep the transition on for one cycle so the card glides into its slot.
        setLanding(d.id)
        setDrag(null)
        window.setTimeout(() => setLanding(null), 220)
      } else {
        setDrag(null)
      }
      draggingRef.current = false
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

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
          ref={gridRef}
          className="relative w-full"
          style={{ height: containerH }}
        >
          <AnimatePresence initial={false}>
            {orderedItems.map((item, idx) => {
              const box = boxes[idx]
              if (!box) return null
              const isDragging = drag?.id === item.id
              const isLanding = landing === item.id
              // The dragged card is glued to the pointer (px-ox, py-oy); every other
              // card sits at its slot box. Positions use left/top so an OPEN card's
              // fixed window still resolves vs. the viewport. Transitions are enabled
              // only DURING a drag (so non-dragged cards glide to new slots) and for the
              // one landing card — never at rest, so continuous width-tracking of the
              // panel squeeze isn't rubber-banded.
              const left = isDragging && drag ? drag.px - drag.ox : box.left
              const top = isDragging && drag ? drag.py - drag.oy : box.top
              const transition =
                isDragging ? "none" : drag || isLanding ? "left 0.2s ease-out, top 0.2s ease-out" : "none"
              return (
                <div
                  key={item.id}
                  // Reserve the FULL slot height (the tall hexagon's cardH) and CENTER the
                  // card within it. Non-Space cards render as a shorter 1:1 square, so
                  // without this they top-aligned and sat ~10px higher than the taller
                  // hexagon — making a Space card look dropped below its neighbours. A
                  // fixed open-window (position: fixed) ignores this flex box, so morphs
                  // are unaffected.
                  className={cn("absolute flex touch-none items-center justify-center", isDragging && "cursor-grabbing")}
                  style={{ left, top, height: box.height, transition, zIndex: isDragging ? 50 : undefined }}
                  onPointerDown={(e) => onCardPointerDown(e, item.entity.id, box)}
                  // Suppress the click that fires right after a real drag so the card
                  // doesn't also open. A plain tap (no drag) leaves the flag false.
                  onClickCapture={(e) => {
                    if (justDraggedRef.current) {
                      e.preventDefault()
                      e.stopPropagation()
                      justDraggedRef.current = false
                    }
                  }}
                >
                  <EntityNode
                    entityId={item.entity.id}
                    contextId={contextId}
                    variant="dock"
                    dockMetrics={dockMetrics}
                  />
                </div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}
