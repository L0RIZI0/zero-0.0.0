"use client"

// ============================================================================
// useTimelineGestures — mouse / trackpad zoom + pan for the lifeline
// ----------------------------------------------------------------------------
// Owns the messy input layer so the strip stays declarative:
//   - WHEEL (vertical) → cursor-anchored zoom. The instant under the pointer
//     stays pinned while the span grows/shrinks — the natural "zoom where I'm
//     looking" feel. Span changes geometrically (exp), so zooming feels even
//     across five orders of magnitude (hours → decades).
//   - WHEEL (horizontal) / SHIFT+wheel → pan through time.
//   - DRAG on empty track → pan (scrub) through time.
//
// Finger pinch is intentionally NOT handled yet (deferred), but the math is
// isolated here so a pointer-based pinch can be added without touching the strip.
//
// All updates are rAF-BATCHED: rapid wheel/drag events accumulate into a ref and
// commit once per frame, so we never thrash React with 100+ setStates/sec. Tuned
// to stay fluid on a mid-range laptop.
// ============================================================================

import { useEffect, useRef, type RefObject } from "react"

interface View {
  startMs: number
  spanMs: number
}

interface Options {
  viewportRef: RefObject<HTMLElement | null>
  /** Latest view — read fresh each gesture (passed every render). */
  view: View
  /** Commit a new view (rAF-batched by the hook). */
  onChange: (next: View) => void
  /** Clamp bounds for the span. */
  minSpan: number
  maxSpan: number
  /** Called when a gesture starts / ends (drives the strip's "moving" flag, and
   *  lets it stop any running tween). */
  onGestureStart?: () => void
  onGestureEnd?: () => void
}

// Wheel sensitivity. Per "notch" deltaY (~100) this yields ~a 12% span change —
// brisk but controllable; trackpads send many small deltas that integrate smoothly.
const ZOOM_K = 0.0012

export function useTimelineGestures({
  viewportRef,
  view,
  onChange,
  minSpan,
  maxSpan,
  onGestureStart,
  onGestureEnd,
}: Options) {
  // Mirror latest values into refs so the once-bound listeners always see fresh
  // state without re-binding (re-binding a passive:false wheel listener each
  // render is both wasteful and a footgun).
  const viewRef = useRef(view)
  viewRef.current = view
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const startCbRef = useRef(onGestureStart)
  startCbRef.current = onGestureStart
  const endCbRef = useRef(onGestureEnd)
  endCbRef.current = onGestureEnd

  // Pending view + rAF handle for batched commits.
  const pendingRef = useRef<View | null>(null)
  const rafRef = useRef<number | null>(null)

  const clampSpan = (s: number) => Math.min(maxSpan, Math.max(minSpan, s))

  const flush = () => {
    rafRef.current = null
    const next = pendingRef.current
    if (next) {
      pendingRef.current = null
      onChangeRef.current(next)
    }
  }
  const schedule = (next: View) => {
    pendingRef.current = next
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush)
  }

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    // --- Wheel: zoom (vertical) + pan (horizontal) -------------------------
    let gestureTimer: ReturnType<typeof setTimeout> | null = null
    const endSoon = () => {
      if (gestureTimer) clearTimeout(gestureTimer)
      // Wheel has no "end" event; treat a short idle as the gesture ending.
      gestureTimer = setTimeout(() => endCbRef.current?.(), 140)
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault() // stop the page/region from scrolling
      const { startMs, spanMs } = pendingRef.current ?? viewRef.current
      const rect = el.getBoundingClientRect()
      const width = rect.width || 1
      startCbRef.current?.()

      // Horizontal intent (trackpad swipe or shift-wheel) → pan.
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey
      if (horizontal) {
        const delta = e.shiftKey ? e.deltaY : e.deltaX
        const nextStart = startMs + (delta / width) * spanMs
        schedule({ startMs: nextStart, spanMs })
        endSoon()
        return
      }

      // Vertical → cursor-anchored zoom. Pointer time stays pinned.
      const cursorX = e.clientX - rect.left
      const frac = cursorX / width
      const tCursor = startMs + frac * spanMs
      const nextSpan = clampSpan(spanMs * Math.exp(e.deltaY * ZOOM_K))
      const nextStart = tCursor - frac * nextSpan
      schedule({ startMs: nextStart, spanMs: nextSpan })
      endSoon()
    }

    el.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      el.removeEventListener("wheel", onWheel)
      if (gestureTimer) clearTimeout(gestureTimer)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
    // viewportRef is stable; bounds rarely change. Re-bind only if they do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportRef, minSpan, maxSpan])

  // --- Drag-to-pan: returned handler for the empty-track surface -----------
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = viewportRef.current
    const width = el?.getBoundingClientRect().width ?? 1
    const startX = e.clientX
    const base = pendingRef.current ?? viewRef.current
    const startView = base.startMs
    const span = base.spanMs
    startCbRef.current?.()
    const move = (ev: PointerEvent) => {
      const deltaMs = ((ev.clientX - startX) / width) * span
      schedule({ startMs: startView - deltaMs, spanMs: span })
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      endCbRef.current?.()
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  return { onPointerDown }
}
