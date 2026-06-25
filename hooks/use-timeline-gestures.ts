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
// SMOOTHNESS MODEL (why this isn't a 1:1 wheel handler):
//   Physical mice — especially on Windows — fire wheel events as large discrete
//   "notches" (deltaY ≈ 100–150, sometimes in LINE units). Applying each notch
//   directly makes zoom/pan lurch in hard steps. So we separate a TARGET view
//   (where the accumulated input wants to go) from the COMMITTED view, and run a
//   single rAF loop that eases the committed view toward the target every frame
//   (geometric ease on span, linear on start). Notches stack onto the target and
//   the view glides there — buttery on a notched mouse, still immediate-feeling
//   on a trackpad (which just keeps nudging the target). deltaMode is normalized
//   to pixels so line/page-based devices don't over- or under-shoot.
//
// Drag-to-pan stays 1:1 (no easing) — pointer panning must track the cursor
// exactly; lag there feels broken rather than smooth.
//
// Finger pinch is intentionally NOT handled yet (deferred), but the math is
// isolated here so a pointer-based pinch can be added without touching the strip.
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
  /** Commit a new view (already rAF-paced by the hook's ease loop). */
  onChange: (next: View) => void
  /** Clamp bounds for the span. */
  minSpan: number
  maxSpan: number
  /** Called when a gesture starts / ends (drives the strip's "moving" flag, and
   *  lets it stop any running tween). */
  onGestureStart?: () => void
  onGestureEnd?: () => void
}

// Wheel sensitivity (per normalized pixel of deltaY). Lower than before because
// the ease loop now glides between notches, so each notch can be gentler.
const ZOOM_K = 0.0009
// Smoothing TIME CONSTANT (seconds), not a per-frame fraction. Each frame we move
// the committed view toward the target by `1 - exp(-dt / TAU)`, which is the
// frame-rate-INDEPENDENT form of exponential smoothing: the glide takes the same
// wall-clock time whether the display is 60, 120, or 144 Hz (a fixed per-frame
// fraction would settle ~2.4× faster on a 144 Hz panel and lurch on a slow one).
// ~0.13 s reads as a luxurious-but-responsive slide; raise it for a longer glide.
const TAU = 0.13
// Clamp dt so a tab regaining focus (huge dt) can't teleport the view in one step.
const MAX_DT = 1 / 30
// Settle thresholds: stop the loop once we're within these of the target.
const SPAN_EPS = 1e-3 // in log-ratio
const START_EPS = 1e-4 // as a fraction of span

/** Normalize a wheel delta to pixels regardless of the device's deltaMode
 *  (0 = pixel, 1 = line, 2 = page). Windows mice often report lines. */
function normalizeDelta(e: WheelEvent, viewportH: number): { dx: number; dy: number } {
  let { deltaX: dx, deltaY: dy } = e
  if (e.deltaMode === 1) {
    dx *= 16
    dy *= 16
  } else if (e.deltaMode === 2) {
    dx *= viewportH || 800
    dy *= viewportH || 800
  }
  return { dx, dy }
}

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

  // Eased-gesture state. `current` is the last view we committed; `target` is
  // where accumulated wheel input wants it to go. Both are null while idle, so a
  // fresh gesture always re-seeds from the authoritative prop `view` (which also
  // reflects external changes like preset buttons / jump-to-now).
  const currentRef = useRef<View | null>(null)
  const targetRef = useRef<View | null>(null)
  const rafRef = useRef<number | null>(null)
  // Timestamp of the previous ease frame, for frame-rate-independent smoothing.
  const lastTRef = useRef<number | null>(null)

  const clampSpan = (s: number) => Math.min(maxSpan, Math.max(minSpan, s))

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    // Ease the committed view one step toward the target each frame. The approach
    // fraction `a` is derived from the real elapsed time, so the glide is smooth and
    // identical regardless of the display's refresh rate.
    const tick = (ts: number) => {
      const cur = currentRef.current
      const tgt = targetRef.current
      if (!cur || !tgt) {
        rafRef.current = null
        lastTRef.current = null
        return
      }
      const last = lastTRef.current
      lastTRef.current = ts
      // First frame of a loop has no prior timestamp — use a nominal 60 Hz step.
      const dt = last == null ? 1 / 60 : Math.min(MAX_DT, (ts - last) / 1000)
      const a = 1 - Math.exp(-dt / TAU) // frame-rate-independent smoothing factor

      let nextSpan = cur.spanMs * Math.pow(tgt.spanMs / cur.spanMs, a)
      let nextStart = cur.startMs + (tgt.startMs - cur.startMs) * a

      const spanSettled = Math.abs(Math.log(tgt.spanMs / nextSpan)) < SPAN_EPS
      const startSettled = Math.abs(tgt.startMs - nextStart) < tgt.spanMs * START_EPS
      if (spanSettled && startSettled) {
        // Snap exactly onto target and end the gesture.
        nextSpan = tgt.spanMs
        nextStart = tgt.startMs
        const settled = { startMs: nextStart, spanMs: nextSpan }
        currentRef.current = settled
        onChangeRef.current(settled)
        currentRef.current = null
        targetRef.current = null
        rafRef.current = null
        lastTRef.current = null
        endCbRef.current?.()
        return
      }
      const next = { startMs: nextStart, spanMs: nextSpan }
      currentRef.current = next
      onChangeRef.current(next)
      rafRef.current = requestAnimationFrame(tick)
    }
    const ensureLoop = () => {
      if (rafRef.current == null) {
        lastTRef.current = null
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    // --- Wheel: zoom (vertical) + pan (horizontal) -------------------------
    const onWheel = (e: WheelEvent) => {
      e.preventDefault() // stop the page/region from scrolling
      const rect = el.getBoundingClientRect()
      const width = rect.width || 1
      // Seed gesture state from the live prop the first time, so we glide from
      // exactly where the view currently is.
      if (!currentRef.current) currentRef.current = viewRef.current
      const base = targetRef.current ?? currentRef.current
      startCbRef.current?.()

      const { dx, dy } = normalizeDelta(e, rect.height)
      // Horizontal intent (trackpad swipe or shift-wheel) → pan.
      const horizontal = Math.abs(dx) > Math.abs(dy) || e.shiftKey
      if (horizontal) {
        const delta = e.shiftKey ? dy : dx
        const nextStart = base.startMs + (delta / width) * base.spanMs
        targetRef.current = { startMs: nextStart, spanMs: base.spanMs }
        ensureLoop()
        return
      }

      // Vertical → cursor-anchored zoom. Pointer time stays pinned (anchored on
      // the TARGET so repeated notches keep the same pivot under the cursor).
      const cursorX = e.clientX - rect.left
      const frac = cursorX / width
      const tCursor = base.startMs + frac * base.spanMs
      const nextSpan = clampSpan(base.spanMs * Math.exp(dy * ZOOM_K))
      const nextStart = tCursor - frac * nextSpan
      targetRef.current = { startMs: nextStart, spanMs: nextSpan }
      ensureLoop()
    }

    el.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      el.removeEventListener("wheel", onWheel)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      lastTRef.current = null
      currentRef.current = null
      targetRef.current = null
    }
    // viewportRef is stable; bounds rarely change. Re-bind only if they do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportRef, minSpan, maxSpan])

  // --- Drag-to-pan: returned handler for the empty-track surface -----------
  // Stays 1:1 with the pointer (no easing) — interrupts any running ease loop.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = viewportRef.current
    const width = el?.getBoundingClientRect().width ?? 1
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      lastTRef.current = null
    }
    targetRef.current = null
    const startX = e.clientX
    const base = currentRef.current ?? viewRef.current
    const startView = base.startMs
    const span = base.spanMs
    startCbRef.current?.()
    const move = (ev: PointerEvent) => {
      const deltaMs = ((ev.clientX - startX) / width) * span
      const next = { startMs: startView - deltaMs, spanMs: span }
      currentRef.current = next
      onChangeRef.current(next)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      currentRef.current = null
      endCbRef.current?.()
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  return { onPointerDown }
}
