"use client"

import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { getEntity } from "@/lib/zero/data"
import { useZeroNav } from "@/lib/zero/nav-store"
import { TOP_PEEK_PX, SIDE_PX, type Rect } from "@/lib/zero/motion"
import { EntityFrame } from "./entity-frame"

/**
 * Renders the open window stack as nested-doll windows positioned by ABSOLUTE
 * depth. There is NO bespoke open/close overlay anymore: each window is just the
 * EXPANDED state of an entity, and the morph between collapsed (row/card) and
 * expanded is a Framer shared-layout animation owned by the shared frame / glyph
 * / title elements (see EntityFrame). Closing simply unmounts the window; its
 * source row/card re-mounts and re-claims those layoutIds, so Framer flies them
 * home automatically.
 *
 * Geometry: every window's box is a pure function of its depth, in pixels
 * relative to THIS region (which we measure). Depth 1 fills the region; each
 * deeper level is pushed down one header strip and inset on the sides so all
 * ancestor borders stay visible. The box is static per depth, so no window moves
 * while another opens/closes.
 */
export function EntityLayerStack() {
  const { stack, closeWindow } = useZeroNav()
  const regionRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  // Measure the region (and keep it current on resize) so depth boxes are in
  // real pixels. The region is always mounted, so the size is known before the
  // user ever dives.
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

  // Static box for a window at absolute `depth` (>= 1), region-relative.
  const rectFor = useCallback(
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

  return (
    <div ref={regionRef} className="absolute inset-0">
      {stack.map((id, index) => {
        // Depth 0 = root home body (rendered as z-0 backdrop in WorkSurface).
        if (index === 0) return null
        const entity = getEntity(id)
        const rect = rectFor(index)
        if (!entity || !rect) return null
        const isTop = index === stack.length - 1
        return (
          <EntityFrame
            key={id}
            entity={entity}
            isTop={isTop}
            depth={index}
            rect={rect}
            onClose={() => closeWindow(index)}
          />
        )
      })}
    </div>
  )
}
