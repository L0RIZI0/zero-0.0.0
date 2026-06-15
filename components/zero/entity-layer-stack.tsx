"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { getEntity } from "@/lib/zero/data"
import { useZeroNav } from "@/lib/zero/nav-store"
import { stackTargetRect, type Rect } from "@/lib/zero/motion"
import { registerStage } from "@/lib/zero/flip-stage"
import type { EntityKind } from "@/lib/zero/types"
import { EntityFrame } from "./entity-frame"

/**
 * Renders the open window stack as the focus-window region, plus (when present)
 * the single `closing` window as a shrink-to-source overlay.
 *
 * Geometry is no longer a flat per-depth step: each window's rest box is a
 * function of its ANCESTOR CHAIN's kinds (via `stackTargetRect`). A space
 * ancestor reserves a vertical spine on the left (its child insets from the
 * left and beside the rail); a task/event ancestor reserves a top peek. This is
 * what lets a task open to the RIGHT of its parent space's spine.
 *
 * This region is also the registered GSAP "stage": resident window headers
 * carry `data-flip-id`, and nav-store snapshots/animates them here as the stack
 * changes (the spine ↔ horizontal header morph).
 */
export function EntityLayerStack() {
  const { stack, closing, closeWindow, finishClosing, sourceRectOf, isSpine } = useZeroNav()
  const regionRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  // Register this region as the Flip stage for the lifetime of the component.
  useEffect(() => {
    registerStage(regionRef.current)
    return () => registerStage(null)
  }, [])

  // Measure the region (and keep it current on resize) so target rects are in
  // real pixels. Always mounted, so by the time the user dives the size is known.
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

  // Kinds of the FRAME ancestors above a window at absolute `depth`. Index 0 is
  // the root home backdrop (not a frame), so ancestors are stack[1 .. depth-1].
  const ancestorKindsFor = useCallback(
    (depth: number): EntityKind[] => {
      const kinds: EntityKind[] = []
      for (let i = 1; i < depth; i++) {
        const k = getEntity(stack[i])?.kind
        if (k) kinds.push(k)
      }
      return kinds
    },
    [stack],
  )

  // Static rest box for a window at absolute `depth` (>= 1), region-relative.
  const targetRectFor = useCallback(
    (depth: number): Rect | null => {
      if (!size) return null
      return stackTargetRect(ancestorKindsFor(depth), size)
    },
    [size, ancestorKindsFor],
  )

  // The clicked source row/card/marker, captured at open time (viewport coords),
  // converted to THIS region's local coords. Works for the close shrink too.
  const sourceRectFor = useCallback(
    (id: string): Rect | null => {
      const el = regionRef.current
      const vp = sourceRectOf(id)
      if (!el || !vp) return null
      const origin = el.getBoundingClientRect()
      return { top: vp.top - origin.top, left: vp.left - origin.left, width: vp.width, height: vp.height }
    },
    [sourceRectOf],
  )

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
            // Stack-position-scoped key: the same entity id can appear at
            // different depths / in several do-lists, so keying by id alone
            // could collide. Depth+id is unique per live window.
            key={`${index}:${id}`}
            entity={entity}
            isTop={isTop}
            depth={index}
            spine={isSpine(id)}
            targetRect={target}
            sourceRect={sourceRectFor(id)}
            mode="open"
            onClose={() => closeWindow(index)}
          />
        )
      })}

      {/* Closing overlay — the one window whose close was clicked, shrinking back
          into its source. Deeper children are already gone from `stack`. */}
      {closing
        ? (() => {
            const entity = getEntity(closing.id)
            const target = targetRectFor(closing.depth)
            if (!entity || !target) {
              finishClosing(closing.id)
              return null
            }
            return (
              <EntityFrame
                key={`closing-${closing.id}`}
                entity={entity}
                isTop={false}
                depth={closing.depth}
                spine={false}
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
