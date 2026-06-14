"use client"

import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { getEntity } from "@/lib/zero/data"
import { useZeroNav } from "@/lib/zero/nav-store"
import { TOP_PEEK_PX, SIDE_PX, type Rect } from "@/lib/zero/motion"
import { EntityFrame } from "./entity-frame"

/**
 * Renders the open window stack as nested-doll windows positioned by ABSOLUTE
 * depth, plus (when present) the single `closing` window as a shrink-to-source
 * overlay. Replaces the old per-kind SpaceLayerStack + the 4 frame files.
 *
 * Geometry: every window's rest box is a pure function of its depth, computed in
 * pixels relative to THIS region (which we measure). Depth 1 fills the region;
 * each deeper level is pushed down one header strip and inset on the sides so all
 * ancestor borders stay visible. Because the box is static per depth, no window
 * ever moves while another opens/closes — the morph engine (EntityFrame) only
 * tweens between a window's source rect and this static target.
 */
export function EntityLayerStack() {
  const { stack, closing, closeWindow, finishClosing, sourceRectOf } = useZeroNav()
  const regionRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  // Measure the region (and keep it current on resize) so target rects are in
  // real pixels. The region is always mounted, so by the time the user dives the
  // size is already known and the first open animates correctly.
  useLayoutEffect(() => {
    const el = regionRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setSize({ w: r.width, h: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Static rest box for a window at absolute `depth` (>= 1), region-relative.
  const targetRectFor = useCallback(
    (depth: number): Rect | null => {
      if (!size) return null
      const step = Math.max(0, depth - 1)
      return {
        top: step * TOP_PEEK_PX,
        left: step * SIDE_PX,
        width: size.w - step * SIDE_PX * 2,
        height: size.h - step * TOP_PEEK_PX - step * SIDE_PX,
      }
    },
    [size],
  )

  // The clicked source row/card/marker, captured at open time (viewport coords),
  // converted to THIS region's local coords. Works for the close shrink too: the
  // source is unmounted by then, but the stored rect persists.
  const sourceRectFor = useCallback((id: string): Rect | null => {
    const el = regionRef.current
    const vp = sourceRectOf(id)
    if (!el || !vp) return null
    const origin = el.getBoundingClientRect()
    return { top: vp.top - origin.top, left: vp.left - origin.left, width: vp.width, height: vp.height }
  }, [sourceRectOf])

  return (
    <div ref={regionRef} className="absolute inset-0">
      {stack.map((id, index) => {
        // Depth 0 = root home body (rendered as z-0 backdrop in WorkSurface).
        if (index === 0) return null
        const entity = getEntity(id)
        const target = targetRectFor(index)
        if (!entity || !target) return null
        const isTop = index === stack.length - 1
        return (
          <EntityFrame
            key={id}
            entity={entity}
            isTop={isTop}
            targetRect={target}
            sourceRect={sourceRectFor(id)}
            mode="open"
            onClose={() => closeWindow(index)}
          />
        )
      })}

      {/* Closing overlay — the one window whose close was clicked, shrinking back
          into its source. Deeper children are already gone from `stack`, so only
          this one animates. */}
      {closing
        ? (() => {
            const entity = getEntity(closing.id)
            const target = targetRectFor(closing.depth)
            if (!entity || !target) {
              // No geometry available — drop immediately so we don't get stuck.
              finishClosing(closing.id)
              return null
            }
            return (
              <EntityFrame
                key={`closing-${closing.id}`}
                entity={entity}
                isTop={false}
                targetRect={target}
                sourceRect={sourceRectFor(closing.id)}
                mode="closing"
                onClose={() => {}}
                onClosed={() => finishClosing(closing.id)}
              />
            )
          })()
        : null}
    </div>
  )
}
