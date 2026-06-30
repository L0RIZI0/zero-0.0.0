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
  /** Re-bind the wheel listener once this flips true. The strip swaps a
   *  pre-hydration PLACEHOLDER (which transiently carries `viewportRef`) for the
   *  REAL viewport element after mount; since `viewportRef`/bounds are otherwise
   *  stable, this flag is what re-runs the bind effect so the listener lands on
   *  the live element instead of the discarded placeholder. */
  enabled?: boolean
  /** When false the window-level proximity wheel handler bails (e.g. while the Atlas
   *  backdrop owns input and forwards wheel into the viewport itself). The viewport's
   *  own listener stays bound so forwarded/synthetic events still zoom. Defaults true. */
  active?: boolean
  /** Horizontal / vertical padding (px) added around the viewport to form the
   *  PROXIMITY HOT-ZONE: the wheel zooms/pans whenever the cursor is within the strip
   *  PLUS this margin, so you can scroll while merely *near* the timeline and — crucially
   *  — keep zooming when the strip shrinks (rows collapse on zoom-out) and slips out from
   *  under the cursor. Sensible defaults; tune from the strip if needed. */
  hotMarginX?: number
  hotMarginY?: number
  /** Called when a gesture starts / ends (drives the strip's "moving" flag, and
   *  lets it stop any running tween). `kind` distinguishes a wheel zoom/pan from a pointer
   *  drag so the strip can keep the cursor-lean alive during a zoom (which doesn't move the
   *  pointer) but suppress it during a drag (whose pointer motion already drives the offset). */
  onGestureStart?: (kind: "wheel" | "drag") => void
  onGestureEnd?: (kind: "wheel" | "drag") => void
  // Fired SYNCHRONOUSLY at pointerup, before any release-momentum glide. Distinct from
  // onGestureEnd (which is deferred until the horizontal glide settles): use this for release
  // reactions that must start immediately and run alongside the glide — e.g. the vertical
  // rubber-band bounce, which shouldn't wait for the horizontal fling to finish.
  onRelease?: () => void
  /** Optional sink for the live ZOOM velocity (the log-span spring's velocity, in log-span
   *  units/s). Written every ease frame and zeroed on settle/reset. The strip drives the
   *  elastic "dive" lens off this so the bulge tracks how fast you're CURRENTLY zooming —
   *  a continuous scroll yields one sustained dive instead of a pulse per wheel notch. */
  zoomVelRef?: RefObject<number>
  /** Enables VERTICAL drag-to-reposition alongside the horizontal time-pan. */
  verticalDrag?: boolean
  /** Per-move callback with the *effective* vertical delta (px) for this frame — already
   *  soft-axis attenuated (see below). The strip accumulates it into a persistent yOffset and
   *  drives the float transform; the hook stays agnostic about bounds/rendering.
   *  SOFT AXIS: horizontal time-pan is always 1:1 and never attenuated; vertical is multiplied
   *  by a gain derived from the drag's direction so an obviously-horizontal drag only nudges
   *  vertically (resisted, not locked), while a diagonal/vertical drag opens up to full 2D. */
  onVerticalDrag?: (effectiveDeltaY: number) => void
}

/** smoothstep(edge0, edge1, x) → eased 0..1 ramp. */
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

// Wheel sensitivity (per normalized pixel of deltaY). The ease loop glides between
// notches, so each notch nudges the TARGET span by exp(dy·ZOOM_K) and the spring eases
// the rest. Tuned DOWN over time (0.0022 → 0.0015 → 0.0012): at 0.0022 a single notch
// (dy≈100) jumped the target ~25% in one step, a "strong tick" lurch; 0.0012 makes one
// notch ~13%, a soft step the spring eases through almost imperceptibly. Notches
// ACCUMULATE on the target (base = targetRef ?? current), so a fast multi-notch flick
// still travels just as far — only each individual tick is softer.
const ZOOM_K = 0.0012
// The committed view chases the target with a CRITICALLY-DAMPED SPRING rather than
// plain exponential smoothing. A spring has inertia: it eases *in* (velocity ramps
// from zero) as well as out, and — because velocity carries across wheel notches —
// successive notches build natural momentum, then it settles with no overshoot.
// This reads markedly silkier than exponential decay (which starts at full speed),
// for the price of one velocity float per dimension and a couple of multiplies/frame.
  // OMEGA is the angular frequency (rad/s): higher = snappier, lower = more languid.
  // Settle time ≈ 6/(ζ·OMEGA). Lowered 6 → 5 for an even silkier, longer glide (settle
  // ~1.2s vs ~1.0s) — the zoom carries momentum and keeps gliding well after each notch
  // instead of arriving quickly, so mouse-wheel notches accumulate into one long,
  // continuous, elastic glide. This is the playful, weighted feel to show off.
  const OMEGA = 5
// ZETA is the damping ratio. 1 = CRITICALLY DAMPED → the spring eases into its target
// and settles with NO overshoot / no bounce-back. We keep it at exactly 1 so zooming is
// a smooth ease-out slide rather than an elastic bounce (the inertia/weight still comes
// from the low OMEGA — momentum carries across wheel notches — but the view never
// crosses past its target and springs back).
const ZETA = 1
// Clamp dt so a tab regaining focus (huge dt) can't teleport the view in one step.
const MAX_DT = 1 / 30
// Settle thresholds: stop the loop once position AND velocity are negligible.
const SPAN_EPS = 1e-3 // log-ratio position
const START_EPS = 1e-4 // start position, as a fraction of span
const VEL_EPS = 1e-3 // velocity, relative (1/s) — keeps the spring from idling
// How long after the last in-zone wheel notch the gesture stays "latched" to the window.
// While latched (or while the ease loop is still running) the proximity hot-zone relaxes its
// VERTICAL bound, so a continuous zoom-out that collapses rows and shrinks the strip away from
// the cursor keeps zooming instead of dropping the moment the cursor falls past the strip edge.
// A touch longer than the gap between physical mouse-wheel notches so a steady scroll stays latched.
const LATCH_MS = 160

// --- Drag-release momentum (horizontal "continuity drag") -------------------
// On release of a horizontal pan we don't stop dead — we keep gliding in the flick
// direction and ease out, so a pan has weight/continuity instead of a hard stop.
// FLING_MIN_V: minimum release speed (px/s) to bother flinging — below it the pan just stops.
const FLING_MIN_V = 90
// FLING_TAU: friction time-constant (s). Velocity decays as e^(−t/τ); larger = longer glide.
const FLING_TAU = 0.32
// Stop the glide once the pointer-equivalent speed drops below this (px/s).
const FLING_STOP_V = 12
// EMA factor for smoothing per-move pointer velocity (0..1, higher = snappier/noisier).
const FLING_SMOOTH = 0.35

/** Analytic one-step solver for a damped harmonic oscillator chasing `target`.
 *  Handles both the underdamped (ζ<1, overshoots) and critically-damped (ζ=1) cases,
 *  advancing position+velocity by exactly `dt` seconds. Frame-rate independent. */
function springStep(x: number, v: number, target: number, omega: number, zeta: number, dt: number) {
  const a = x - target // current offset from target
  if (zeta < 1) {
    // Underdamped: decaying sinusoid → a gentle overshoot before settling.
    const wd = omega * Math.sqrt(1 - zeta * zeta) // damped frequency
    const e = Math.exp(-zeta * omega * dt)
    const c = Math.cos(wd * dt)
    const s = Math.sin(wd * dt)
    const coB = (v + zeta * omega * a) / wd
    const pos = target + e * (a * c + coB * s)
    const vel = e * (-zeta * omega * (a * c + coB * s) + wd * (-a * s + coB * c))
    return { pos, vel }
  }
  // Critically damped: y(t) = (A + B·t)·e^(−ω·t), no overshoot.
  const b = v + omega * a
  const e = Math.exp(-omega * dt)
  const pos = target + (a + b * dt) * e
  const vel = (b - omega * (a + b * dt)) * e
  return { pos, vel }
}

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
  enabled = true,
  active = true,
  hotMarginX = 64,
  hotMarginY = 44,
    onGestureStart,
    onGestureEnd,
    onRelease,
  zoomVelRef,
  verticalDrag = false,
  onVerticalDrag,
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
  const releaseCbRef = useRef(onRelease)
  releaseCbRef.current = onRelease
  const vDragRef = useRef(onVerticalDrag)
  vDragRef.current = onVerticalDrag
  const verticalDragRef = useRef(verticalDrag)
  verticalDragRef.current = verticalDrag
  // Mirror `active` so the once-bound window listener reads it fresh (Atlas toggling
  // shouldn't force a wheel-listener rebind).
  const activeRef = useRef(active)
  activeRef.current = active
  // Timestamp (perf clock) of the last wheel notch we accepted inside the hot-zone — the
  // basis for the LATCH window (see LATCH_MS).
  const lastInsideRef = useRef(0)

  // Eased-gesture state. `current` is the last view we committed; `target` is
  // where accumulated wheel input wants it to go. Both are null while idle, so a
  // fresh gesture always re-seeds from the authoritative prop `view` (which also
  // reflects external changes like preset buttons / jump-to-now).
  const currentRef = useRef<View | null>(null)
  const targetRef = useRef<View | null>(null)
  const rafRef = useRef<number | null>(null)
  // Timestamp of the previous ease frame, for frame-rate-independent smoothing.
  const lastTRef = useRef<number | null>(null)
  // Spring velocities, one per dimension: zoom runs in LOG-span space (so velocity
  // is geometric, matching how zoom feels) and pan in start-ms space. Carried across
  // frames AND across notches to build momentum; zeroed only when a gesture begins
  // fresh or the loop ends.
  const velLogRef = useRef(0)
  const velStartRef = useRef(0)
  // Active zoom anchor: the time under the cursor (`t`) and its fractional x across
  // the viewport (`frac`). While set, the tick loop DERIVES start from the LIVE span
  // each frame (start = t − frac·span) instead of running a separate pan spring — so
  // the cursor time stays pinned the entire glide with zero horizontal drift / no
  // slide-back. Cleared by a pan, a drag, or when the loop settles.
  const anchorRef = useRef<{ t: number; frac: number } | null>(null)
  // rAF id for the post-release horizontal momentum glide (separate from the wheel ease loop
  // so the two never entangle). A fresh pointerdown or any wheel cancels it.
  const momentumRafRef = useRef<number | null>(null)

  const clampSpan = (s: number) => Math.min(maxSpan, Math.max(minSpan, s))

  const cancelMomentum = () => {
    if (momentumRafRef.current != null) {
      cancelAnimationFrame(momentumRafRef.current)
      momentumRafRef.current = null
    }
  }

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
        if (zoomVelRef) zoomVelRef.current = 0
        return
      }
      const last = lastTRef.current
      lastTRef.current = ts
      // First frame of a loop has no prior timestamp — use a nominal 60 Hz step.
      const dt = last == null ? 1 / 60 : Math.min(MAX_DT, (ts - last) / 1000)

      // Advance the ZOOM (log-span) spring — slightly underdamped for a lively settle.
      const logStep = springStep(Math.log(cur.spanMs), velLogRef.current, Math.log(tgt.spanMs), OMEGA, ZETA, dt)
      velLogRef.current = logStep.vel
      if (zoomVelRef) zoomVelRef.current = velLogRef.current // feed the elastic lens (zoom rate)
      let nextSpan = Math.exp(logStep.pos)

      // PAN: if a zoom anchor is active, DERIVE start from the live span so the cursor
      // time stays pinned every frame (no separate start spring → no horizontal drift
      // or slide-back). Otherwise run start as its own critically-damped spring (ζ=1).
      let nextStart: number
      const anchor = anchorRef.current
      if (anchor) {
        nextStart = anchor.t - anchor.frac * nextSpan
        velStartRef.current = 0
      } else {
        const startStep = springStep(cur.startMs, velStartRef.current, tgt.startMs, OMEGA, 1, dt)
        velStartRef.current = startStep.vel
        nextStart = startStep.pos
      }

      // Settle once BOTH position and velocity are negligible in each dimension —
      // velocity matters too, else the spring could coast past its eps and idle.
      const spanSettled =
        Math.abs(Math.log(tgt.spanMs / nextSpan)) < SPAN_EPS && Math.abs(velLogRef.current) < VEL_EPS
      const startSettled =
        Math.abs(tgt.startMs - nextStart) < tgt.spanMs * START_EPS &&
        Math.abs(velStartRef.current) < tgt.spanMs * VEL_EPS
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
        velLogRef.current = 0
        velStartRef.current = 0
        if (zoomVelRef) zoomVelRef.current = 0
        anchorRef.current = null
        endCbRef.current?.("wheel")
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
    // The core gesture math, given the viewport `rect` (its width/left define the time
    // axis; height is only used to normalize line/page deltas). Shared by the two
    // listeners below so the viewport-direct path and the proximity path behave identically.
    const applyWheel = (e: WheelEvent, rect: DOMRect) => {
      e.preventDefault() // stop the page/region from scrolling
      cancelMomentum() // a wheel gesture supersedes any in-flight release glide
      const width = rect.width || 1
      // Seed gesture state from the live prop the first time, so we glide from
      // exactly where the view currently is — and start the spring at rest.
      if (!currentRef.current) {
        currentRef.current = viewRef.current
        velLogRef.current = 0
        velStartRef.current = 0
      }
      const base = targetRef.current ?? currentRef.current
      startCbRef.current?.("wheel")

      const { dx, dy } = normalizeDelta(e, rect.height)
      // Horizontal intent (trackpad swipe or shift-wheel) → pan.
      const horizontal = Math.abs(dx) > Math.abs(dy) || e.shiftKey
      if (horizontal) {
        anchorRef.current = null // a pan releases the zoom anchor
        const delta = e.shiftKey ? dy : dx
        const nextStart = base.startMs + (delta / width) * base.spanMs
        targetRef.current = { startMs: nextStart, spanMs: base.spanMs }
        ensureLoop()
        return
      }

      // Vertical → cursor-anchored zoom. The cursor time is pinned for the WHOLE glide:
      // we record it as the anchor so the tick loop keeps start = t − frac·span every
      // frame from the live span (target start below is the same relation at target).
      const cursorX = e.clientX - rect.left
      const frac = cursorX / width
      const tCursor = base.startMs + frac * base.spanMs
      anchorRef.current = { t: tCursor, frac }
      const nextSpan = clampSpan(base.spanMs * Math.exp(dy * ZOOM_K))
      const nextStart = tCursor - frac * nextSpan
      targetRef.current = { startMs: nextStart, spanMs: nextSpan }
      ensureLoop()
    }

    // Per-event dedupe: a real wheel over the viewport bubbles through BOTH listeners
    // (viewport fires first, then window). The viewport listener tags the event so the
    // window listener skips it — no double application. WeakSet auto-evicts as events GC.
    const handledEvents = new WeakSet<WheelEvent>()

    // (1) VIEWPORT listener — unchanged role: catches wheel directly over the strip AND the
    // synthetic events the Atlas forwarder dispatches onto the viewport (bubbles:false, so
    // those never reach the window listener).
    const onElWheel = (e: WheelEvent) => {
      handledEvents.add(e)
      lastInsideRef.current = performance.now()
      applyWheel(e, el.getBoundingClientRect())
    }

    // (2) WINDOW listener — the PROXIMITY HOT-ZONE. Catches wheel when the cursor is NEAR
    // the strip (within the margin) or has slipped off it because the strip shrank mid-zoom.
    const onWinWheel = (e: WheelEvent) => {
      if (!activeRef.current) return // Atlas owns input; let the forwarder + viewport listener handle it
      if (handledEvents.has(e)) return // already applied by the viewport listener
      const vpEl = viewportRef.current
      if (!vpEl) return
      const rect = vpEl.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      const now = performance.now()
      // LATCH: while the ease loop is still running, or within LATCH_MS of the last accepted
      // notch, a gesture is "in progress" — relax the vertical bound so a zoom-out that
      // collapses rows and shrinks the strip past the cursor keeps zooming.
      const gestureActive = rafRef.current != null || now - lastInsideRef.current < LATCH_MS
      const inX = e.clientX >= rect.left - hotMarginX && e.clientX <= rect.right + hotMarginX
      const inY = e.clientY >= rect.top - hotMarginY && e.clientY <= rect.bottom + hotMarginY
      // Horizontal is always required (never hijack scrolls in a different column); vertical is
      // required only when NOT mid-gesture.
      if (!inX || (!inY && !gestureActive)) return
      lastInsideRef.current = now
      applyWheel(e, rect)
    }

    el.addEventListener("wheel", onElWheel, { passive: false })
    window.addEventListener("wheel", onWinWheel, { passive: false })
    return () => {
      el.removeEventListener("wheel", onElWheel)
      window.removeEventListener("wheel", onWinWheel)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      cancelMomentum()
      rafRef.current = null
      lastTRef.current = null
      velLogRef.current = 0
      velStartRef.current = 0
      anchorRef.current = null
      currentRef.current = null
      targetRef.current = null
    }
    // `enabled` is included so the listener re-binds when the real viewport
    // replaces the pre-hydration placeholder. viewportRef is stable; bounds rarely
    // change. `active` and the latch timestamp are read via refs so toggling them never
    // rebinds; the hot-zone margins are stable but included for correctness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportRef, minSpan, maxSpan, enabled, hotMarginX, hotMarginY])

  // Did the most recent pointer interaction travel far enough to count as a DRAG
  // (rather than a click)? Children of the viewport (ribbons) have their own onClick;
  // a drag-pan that starts over a ribbon would otherwise also fire that click on
  // pointerup. The strip reads this ref in its collapse/expand handlers to ignore a
  // click that was really the tail of a drag. Reset on every fresh pointerdown.
  const draggedRef = useRef(false)
  // Px the pointer must move before we treat the gesture as a drag (small, so a
  // genuine click with tiny jitter still registers as a click).
  const DRAG_THRESHOLD = 4

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
      velLogRef.current = 0
      velStartRef.current = 0
    }
    cancelMomentum() // grabbing the strip again kills any in-flight release glide
    anchorRef.current = null // a drag releases any zoom anchor
    targetRef.current = null
    draggedRef.current = false // fresh press — not a drag until it moves past threshold
    const startX = e.clientX
    const startY = e.clientY
    let lastY = e.clientY // previous pointer Y, for per-frame vertical deltas
    // Pointer X velocity (px/s), EMA-smoothed across moves, for the release fling.
    let velX = 0
    let lastVX = e.clientX
    let lastVT = performance.now()
    const base = currentRef.current ?? viewRef.current
    const startView = base.startMs
    const span = base.spanMs
    startCbRef.current?.("drag")
    const move = (ev: PointerEvent) => {
      // Once the pointer travels past the threshold, latch this gesture as a drag so
      // the click it produces on release is suppressed by the strip.
      if (!draggedRef.current && Math.hypot(ev.clientX - startX, ev.clientY - startY) > DRAG_THRESHOLD) {
        draggedRef.current = true
      }
      // Track smoothed horizontal pointer speed for the release momentum.
      const tNow = performance.now()
      const dtv = Math.max(1, tNow - lastVT) / 1000
      const instVX = (ev.clientX - lastVX) / dtv
      velX = velX * (1 - FLING_SMOOTH) + instVX * FLING_SMOOTH
      lastVX = ev.clientX
      lastVT = tNow
      // Horizontal time-pan — always 1:1, never attenuated.
      const deltaMs = ((ev.clientX - startX) / width) * span
      const next = { startMs: startView - deltaMs, spanMs: span }
      currentRef.current = next
      onChangeRef.current(next)
      // Vertical reposition — SOFT AXIS. Gain rises with how vertical the *overall* drag is:
      // ratio = |dy| / (|dx|+|dy|) is 0 for a pure-horizontal drag, ~0.5 at 45°, 1 for vertical.
      // smoothstep(0.18,0.55) gives a deadzone near horizontal then opens to full 2D by ~diagonal;
      // a 0.06 floor keeps a faint "shown but resisted" nudge even on an obviously-horizontal drag.
      if (verticalDragRef.current && vDragRef.current) {
        const totalDx = ev.clientX - startX
        const totalDy = ev.clientY - startY
        const ratio = Math.abs(totalDy) / (Math.abs(totalDx) + Math.abs(totalDy) + 1e-3)
        const gain = 0.06 + 0.94 * smoothstep(0.18, 0.55, ratio)
        vDragRef.current((ev.clientY - lastY) * gain)
      }
      lastY = ev.clientY
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      releaseCbRef.current?.() // immediate: lets the vertical bounce start now, not after the glide
      // CONTINUITY DRAG: if the release carried real horizontal speed, keep gliding and ease out
      // instead of stopping dead. We DON'T fire endCb yet — the strip keeps its "dragging" flag
      // (lean + hover stay suppressed) until the glide actually settles. If the pointer paused
      // just before release, velX is stale → don't fling.
      const idleMs = performance.now() - lastVT
      const fling = idleMs > 60 ? 0 : velX
      if (draggedRef.current && Math.abs(fling) > FLING_MIN_V) {
        let vStart = -(span / width) * fling // px/s → startMs/s (start moves opposite the pointer)
        let t0 = performance.now()
        const glide = () => {
          const t = performance.now()
          const dt = Math.min(MAX_DT, (t - t0) / 1000)
          t0 = t
          vStart *= Math.exp(-dt / FLING_TAU) // exponential friction
          const cur = currentRef.current ?? viewRef.current
          const next = { startMs: cur.startMs + vStart * dt, spanMs: cur.spanMs }
          currentRef.current = next
          onChangeRef.current(next)
          if (Math.abs(vStart) * (width / span) < FLING_STOP_V) {
            momentumRafRef.current = null
            currentRef.current = null
            endCbRef.current?.("drag")
            return
          }
          momentumRafRef.current = requestAnimationFrame(glide)
        }
        momentumRafRef.current = requestAnimationFrame(glide)
      } else {
        currentRef.current = null
        endCbRef.current?.("drag")
      }
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  return { onPointerDown, draggedRef }
}
