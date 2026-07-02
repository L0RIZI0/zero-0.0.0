"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useZeroNav } from "@/lib/zero/nav-store"
import { getTimelineOccurrences, getInheritedAccent } from "@/lib/zero/data"
import { entityInterval } from "@/lib/zero/timeline-index"
import { KIND_META } from "@/lib/zero/kinds"
import { rangeText, NOW_COLOR } from "@/lib/zero/timeline-format"
import { DAYLINE_ROW_H } from "@/lib/zero/layout"
import { useNow } from "@/lib/zero/use-now"
import { cn } from "@/lib/utils"
import { NodeGlyph } from "./node-glyph"

// ============================================================================
// The DAYLINE — the Individual's at-a-glance insight on their day.
// ----------------------------------------------------------------------------
// This is NOT a region component you add to any space. It is an Individual-
// SPECIFIC piece of title chrome: the SECOND ROW of the header overlay, directly
// below the top bar (avatar+handle / date+time / version+search+logo). It is a
// constant-height row (DAYLINE_ROW_H) so the focus-window stage region below the
// header never moves as the user dives (matching the header's fixed-box rule).
//
// A single thin lane buckets ~one day (24h) and overlays EVERY planned occurrence
// from across the Individual's world onto one line. No chrome: no ribbon title, no
// nav arrows, no date label, no graduation. Ticks/bars highlight on hover and surface
// a helper (glyph + title + time range / recurrence rule) that opens DOWNWARD.
//
// PAN + AUTO-SHIFT (simple, linear, no zoom):
//   • Drag the lane left/right — or scroll/wheel — to pan its 24h window through time.
//     Double-click recenters on the live "now" window.
//   • The NOW marker lives its own life: it sits at the true time position within the
//     shown window and advances minute by minute, sliding off-screen when you pan away.
//   • AUTO-SHIFT: when the marker reaches the RIGHT edge *on its own* — i.e. time (not a
//     pan) carries `now` past the window end — the lane jumps forward one natural 24h
//     window, landing the marker back at the LEFT edge. Un-panned, that boundary is 5am
//     daily. A pan that pushes the marker past the edge does NOT trigger this; only a
//     time transition does.
//
// RIPPLE PAN (the "feel"):
//   • `viewStart` remains the logical truth — the real time position content lands at.
//     The ripple is a purely-visual, TRANSIENT per-column `translateX` layered on top
//     that always decays back to 0, so the effect never corrupts where things actually
//     are (safe for the marker's minute clock + auto-shift).
//   • The lane is split into RIPPLE_COLS fixed SCREEN columns, each a critically-damped
//     spring (no bounce — pure inertial landing). A pan injects lag into every column
//     scaled by its distance from the cursor: the column under the cursor moves instantly
//     (lag≈0) while farther columns are held back and then catch up with delayed
//     acceleration — a travelling wave that settles smoothly.
//   • Driven imperatively from a single rAF loop writing `style.transform` on registered
//     nodes via refs (no per-frame React state); the loop self-starts on a pan and
//     self-stops at rest. `prefers-reduced-motion` disables it (instant pan).
//
// The timeline⇄dayline MORPH is intentionally NOT here yet.
// ============================================================================

const DAY_MS = 86_400_000
// The day "bucket" runs 5am→5am so a normal day (and its late-evening items)
// land inside one window instead of being split at midnight.
const DAY_START_HOUR = 5
const NEUTRAL = "oklch(0.72 0.004 75)"

// --- Ripple tuning -----------------------------------------------------------
// ⚠️ DAYLINE-SPECIFIC. This whole ripple block is tuned for the CURRENT dayline lane and
// its mounted-tick density. A future "build on dayline" (à la timeline) must NOT blindly
// copy these numbers — re-tune per that view's width/column density. Kept intentionally
// LOW-LOAD (see perf note below) so it never competes with heavier future dayline work.
//
// PERF: per-frame cost splits in two —
//   • paintRipple() is O(mounted tick nodes) and is INDEPENDENT of RIPPLE_COLS (it just
//     looks up off[col]). The node count is the real load lever, not the column count.
//   • the sim loop is O(substeps × RIPPLE_COLS) of trivial float math (~3×32/frame here) —
//     negligible. So RIPPLE_COLS is effectively free to raise; we keep it modest anyway.
//
// Screen is divided into this many fixed columns; each is one node in the coupled chain.
// Bumped 16 → 32 for a finer, glassier water surface (≈45min per column over a typical
// lane). Raising this is cheap (see PERF above); the visual wave SPEED depends on COUPLING
// (see below), not on resolution, once COUPLING is scaled to match.
const RIPPLE_COLS = 32
// Critically-damped spring: damping = 2*sqrt(stiffness) → fastest settle w/ NO overshoot.
// Softer stiffness = slower, more visible catch-up (a longer, more pronounced trailing
// wave) while staying critically damped (no bounce). Softened 34 → 20 for an extra-fluid,
// longer-settling liquid trail behind the pan.
const RIPPLE_STIFFNESS = 20
const RIPPLE_DAMPING = 2 * Math.sqrt(RIPPLE_STIFFNESS)
// Neighbor COUPLING: each column is linked to its left/right neighbors (a damped wave
// equation / chain of masses) instead of being an isolated spring. This is what makes it
// feel like WATER — a disturbance PROPAGATES column→column with a natural delay and sloshes
// back, rather than every cell pulsing in unison.
// The visual wave speed ≈ √(COUPLING) · laneWidth / RIPPLE_COLS, so COUPLING must scale
// ∝ RIPPLE_COLS² to keep the same travel speed at higher resolution. Scaled 150 → 600
// alongside the 16 → 32 column bump (2× cols ⇒ 4× coupling) so the finer surface still
// slosh-travels at the same pace. Damping stays under-damped for those modes → gentle slosh.
// (Stability: ω_max = √(4·COUPLING+STIFFNESS) ≈ 49 rad/s; substep h ≈ 0.006s ⇒ hω ≈ 0.3,
// well inside the semi-implicit Euler limit of 2.)
const RIPPLE_COUPLING = 600
// Max fraction of a pan step a far column lags behind by (0 = none, 1 = fully held back).
// Near 1 → far columns almost freeze on each step, then snap-catch-up for a big ripple.
const RIPPLE_LAG = 0.99
// Falloff exponent for lag vs normalized cursor distance. <1 = concave: lag ramps up
// FAST right off the cursor column (a SMALL "lens" — near-cursor content reacts
// strongly) while far columns still sit near max lag, so the far effect is preserved.
const RIPPLE_FALLOFF = 0.7
// Clamp per-column offset so a rapid scroll burst can't fling content far off-lane.
// Raised 220 → 320 so far columns can trail further for a bigger, more fluid wave.
const RIPPLE_MAX_OFFSET = 320

// Wheel pan sensitivity: fraction of a raw wheel-notch's px distance that the lane pans.
// A physical mouse notch (~120px) felt like it flung the lane too far. Damped further
// 0.4 → 0.25 — one notch still felt too "steppy"/wide, so each notch now covers ~25%.
const WHEEL_PAN_SENSITIVITY = 0.25
// Wheel drain ease-out rate: fraction of the remaining buffered pan consumed per 60fps
// frame (dt-normalized). Higher = snappier/less lag; lower = smoother/floatier.
const WHEEL_DRAIN = 0.3
// While draining, the base pan is applied as an imperative transform (no React render);
// we only FLUSH it into `viewStart` (React truth) once it crosses this fraction of the
// lane width, or when the gesture settles — keeping renders rare so panning stays smooth
// while items stay fresh enough (the mounted ±day buffer covers the gap).
const WHEEL_FLUSH_FRAC = 0.35
// Below this |offset| (px) and |velocity| a column is snapped to rest. Set above the
// sub-pixel range so critical damping's slow asymptotic tail can't leave a lingering
// (invisible) transform hanging around after the wave has visually landed.
const RIPPLE_REST = 0.4
// We mount a BOUNDED buffer of time beyond the visible 24h window on each side, so
// nearby days (today / tomorrow / the day after, and a bit behind) stay mounted and
// ripple-lagged ticks never pop out early — the lane's overflow-hidden clip hides the
// extra until the wave brings them in. Keeping this bounded matters because the buffer
// also bounds recurrence materialization (an unbounded range = infinite occurrences).
// The buffer's recurrence expansion is memoized on a quantized day anchor (see below),
// so a wider buffer costs nothing per pan frame; only the cheap position remap re-runs.
const RENDER_MARGIN_MS = DAY_MS * 1.5

/** [start,end) of the 5am→5am window containing `now`. */
function dayWindow(now: number): [number, number] {
  const d = new Date(now)
  d.setHours(DAY_START_HOUR, 0, 0, 0)
  let start = d.getTime()
  if (now < start) start -= DAY_MS // before 5am → the window opened at yesterday's 5am
  return [start, start + DAY_MS]
}

interface DayItem {
  key: string
  id: string
  kind: Parameters<typeof NodeGlyph>[0]["kind"]
  title: string
  color: string
  leftPct: number
  widthPct: number
  isDuration: boolean
  centerPct: number
  range: string
  /** Glyph fills only for completable kinds once done; otherwise it's a silhouette. */
  filled: boolean
}

export function Dayline() {
  const { stack, dataVersion, open } = useZeroNav()
  const rootId = stack[0]

  // `now` advances minute by minute and drives the NOW marker. It comes from the SHARED
  // minute clock (`useNow`) — the same source the header time reads — so the marker
  // tooltip and the header can never drift onto different minutes. It is time-dependent,
  // so SSR and the client's first paint would disagree and trip a hydration mismatch;
  // we therefore keep all time-positioned content (items, NOW marker, helper) OUT of the
  // server render: `mounted` starts false (server + first client render → identical empty
  // lane), then flips true in an effect, after which `now` drives the real content.
  const now = useNow()
  const [mounted, setMounted] = useState(false)
  // `viewStart` is the left edge of the shown 24h window. Panning moves it directly;
  // the auto-shift advances it on a time boundary. Independent of `now` so a pan never
  // drags the marker's true position and the marker never drags the window.
  const [viewStart, setViewStart] = useState(0)
  const prevNowRef = useRef(0)
  useEffect(() => {
    const n = Date.now()
    setMounted(true)
    setViewStart(dayWindow(n)[0])
    prevNowRef.current = n
  }, [])

  // AUTO-SHIFT — fires ONLY on a `now` transition (this effect depends on `now`, never
  // on `viewStart`, so panning can't trigger it). When time carries `now` across the
  // shown window's right edge on its own, jump to the natural 24h window containing
  // `now` (un-panned, that boundary is 5am daily) — landing the marker at the left edge.
  useEffect(() => {
    if (!mounted) return
    const prev = prevNowRef.current
    prevNowRef.current = now
    setViewStart((vs) => {
      const viewEnd = vs + DAY_MS
      // Crossing detected as prev<edge && now>=edge → it's time, not a pan. A pan that
      // already left `now` outside the window has no transition here, so it's ignored.
      return prev < viewEnd && now >= viewEnd ? dayWindow(now)[0] : vs
    })
  }, [now, mounted])

  const winStart = viewStart

  const [hovered, setHovered] = useState<string | null>(null)
  // Hover state for the NOW marker's time tooltip (React-driven, like the chips —
  // the Tailwind `group-hover` variant isn't reliably compiled in this project).
  const [nowHover, setNowHover] = useState(false)

  // Query anchor QUANTIZED to the day: it only changes when panning crosses into a new
  // day (viewStart drifts at most ±½ day from it), so the EXPENSIVE recurrence expansion
  // re-runs at most once per day panned — never per frame. The ±RENDER_MARGIN_MS buffer
  // (≥1 day beyond the visible window even at the quantization extremes) keeps nearby
  // days mounted and safely bounds recurrence materialization.
  const queryAnchor = mounted ? Math.round(viewStart / DAY_MS) * DAY_MS : 0

  // EXPENSIVE: expand recurring series into concrete occurrences over the buffered range.
  // Memoized on the quantized anchor so a pan within a day doesn't re-expand anything.
  const occurrences = useMemo(() => {
    if (!mounted) return []
    return getTimelineOccurrences(rootId, queryAnchor - RENDER_MARGIN_MS, queryAnchor + DAY_MS + RENDER_MARGIN_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId, queryAnchor, dataVersion, mounted])

  // CHEAP: remap the (stable) occurrences to window-relative positions each pan frame —
  // pure arithmetic, no recurrence work. Positions come from the FULL, UNCLAMPED st/en so
  // every bar keeps its true width and rigidly translates (no squeeze against the render
  // boundary); the lane's overflow-hidden clip trims any overhang at the edges.
  const items = useMemo<DayItem[]>(() => {
    const out: DayItem[] = []
    for (const e of occurrences) {
      const [st, en] = entityInterval(e)
      const leftPct = ((st - winStart) / DAY_MS) * 100
      const widthPct = Math.max(0, ((en - st) / DAY_MS) * 100)
      const isDuration = en > st
      out.push({
        key: e.occKey,
        id: e.id,
        kind: e.kind,
        title: e.title,
        color: getInheritedAccent(e.parentId ?? "s_root") ?? NEUTRAL,
        leftPct,
        widthPct,
        isDuration,
        centerPct: leftPct + widthPct / 2,
        range: rangeText(st, en, e.schedule?.repeat),
        filled: KIND_META[e.kind].fillGlyphWhenDone && !!e.completed,
      })
    }
    // Paint durations first so the thin instant ticks sit visually on top.
    return out.sort((a, b) => Number(b.isDuration) - Number(a.isDuration))
  }, [occurrences, winStart])

  const hoveredItem = hovered ? items.find((i) => i.key === hovered) : null
  // NOW marker position within the shown window; off-screen (outside 0–100) when panned away.
  const nowPct = ((now - winStart) / DAY_MS) * 100
  const nowInView = nowPct >= 0 && nowPct <= 100

  // ==========================================================================
  // RIPPLE — per-column critically-damped springs, driven imperatively.
  // ==========================================================================
  const laneRef = useRef<HTMLDivElement>(null)
  // Live visual offset (px) + velocity for each screen column. Kept in refs so the rAF
  // loop mutates them without triggering React renders.
  const offsetRef = useRef<Float64Array>(new Float64Array(RIPPLE_COLS))
  const velRef = useRef<Float64Array>(new Float64Array(RIPPLE_COLS))
  // Scratch snapshot of positions per substep so neighbor-coupling forces read the PREVIOUS
  // state (Jacobi update) — otherwise left/right coupling would use half-updated neighbors.
  const prevXRef = useRef<Float64Array>(new Float64Array(RIPPLE_COLS))
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef(0)
  // Column the cursor is currently over (defaults to lane center). Pan lag radiates from here.
  const cursorColRef = useRef((RIPPLE_COLS - 1) / 2)
  const reducedRef = useRef(false)
  // Wheel-pan smoothing. A physical mouse wheel fires large discrete notches (often
  // line/page deltaMode, ~100px+ each), so applying a whole notch at once jumps the lane.
  // Instead each notch ADDS to a pending px buffer that a rAF loop eases out a fraction at
  // a time — turning stepped mouse ticks into a continuous glide (trackpads already send
  // tiny continuous deltas, so they just pass through smoothly).
  const wheelPendingRef = useRef(0)
  const wheelRafRef = useRef<number | null>(null)
  const wheelTsRef = useRef(0)
  // Base pan applied imperatively (via `panWrapRef` transform) but not yet flushed into
  // `viewStart`. Invariant: (viewStart's wheel delta, in px) + wheelCommitRef == total pan
  // consumed, so base + ripple always agree with no jump when we flush.
  const wheelCommitRef = useRef(0)
  // The in-progress wheel pan is applied as a `translateX` to TWO layers that share the
  // same offset: the ticks CONTENT (inside the fixed overflow-hidden clip) and the NOW
  // marker (which lives OUTSIDE the clip for its edge bleed). Crucially the transform is
  // NOT on the clip itself — translating the clip would drag its window off the lane and
  // keep incoming ticks hidden. Only the content slides within a fixed clip window.
  const ticksPanRef = useRef<HTMLDivElement>(null)
  const markerPanRef = useRef<HTMLDivElement>(null)
  const applyPan = useCallback((px: number) => {
    const t = px ? `translateX(${px}px)` : ""
    if (ticksPanRef.current) ticksPanRef.current.style.transform = t
    if (markerPanRef.current) markerPanRef.current.style.transform = t
  }, [])
  // Bridge so the ripple loop (defined above) can trigger the deferred wheel-pan flush
  // once the ripple settles — assigned below where `maybeFlushAtRest` is defined.
  const flushAtRestRef = useRef<() => void>(() => {})
  // Registered nodes to displace each frame, keyed so unmounts clean themselves up. Each
  // node carries a live `data-col` attribute (updated by React every render) that the loop
  // reads — so a node whose column changes mid-pan always uses its CURRENT screen column.
  const rippleNodesRef = useRef<Map<string, HTMLElement>>(new Map())

  const registerRipple = useCallback((key: string) => {
    return (el: HTMLElement | null) => {
      const map = rippleNodesRef.current
      if (el) map.set(key, el)
      else map.delete(key)
    }
  }, [])

  // Detect reduced-motion once (and keep it current).
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const sync = () => (reducedRef.current = mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])

  const pctToCol = useCallback((clientX: number) => {
    const lane = laneRef.current
    if (!lane) return (RIPPLE_COLS - 1) / 2
    const r = lane.getBoundingClientRect()
    const pct = r.width > 0 ? (clientX - r.left) / r.width : 0.5
    return Math.max(0, Math.min(RIPPLE_COLS - 1, Math.round(pct * (RIPPLE_COLS - 1))))
  }, [])

  // Write the current per-column offsets onto every registered node. Reading `data-col`
  // live keeps a node in sync with the fixed SCREEN column it currently sits under.
  // OFF-SCREEN SKIP: a node's `data-left` (leftPct, updated by React each render) lets us
  // cheaply skip ticks far outside the lane — they're clipped anyway, so mounting a wide
  // buffer of nearby-day ticks costs ~nothing per frame. The ±40 threshold clears the max
  // ripple displacement (~18% of a day) so a lagged tick can't be skipped while it's still
  // visually on-screen. A skipped node is cleared once so no stale transform lingers.
  const paintRipple = useCallback(() => {
    const off = offsetRef.current
    for (const el of rippleNodesRef.current.values()) {
      const left = +(el.dataset.left ?? "") || 0
      if (left < -40 || left > 140) {
        if (el.style.transform) el.style.transform = ""
        continue
      }
      const col = +(el.dataset.col ?? "") || 0
      const x = off[col] || 0
      el.style.transform = x ? `translateX(${x}px)` : ""
    }
  }, [])

  const tick = useCallback(
    (ts: number) => {
      const off = offsetRef.current
      const vel = velRef.current
      let dt = (ts - lastTsRef.current) / 1000
      lastTsRef.current = ts
      if (!(dt > 0)) dt = 1 / 60
      dt = Math.min(dt, 0.05)
      // Fixed-size substeps keep the (now higher-frequency, coupled) springs stable
      // regardless of frame length.
      const steps = Math.max(1, Math.ceil(dt / 0.008))
      const h = dt / steps
      const prev = prevXRef.current
      // Integrate the whole COUPLED chain together per substep. Each column is pulled by
      // its neighbors (wave propagation) plus a restoring term toward 0 (eventual settle)
      // and damping. Coupling forces read `prev` (snapshot before this substep) so all
      // columns update from a consistent state (Jacobi), giving a clean traveling wave.
      for (let s = 0; s < steps; s++) {
        for (let c = 0; c < RIPPLE_COLS; c++) prev[c] = off[c]
        for (let c = 0; c < RIPPLE_COLS; c++) {
          const x = prev[c]
          const v = vel[c]
          // Free (reflecting) boundaries: clamp the neighbor index to self at the edges.
          const xl = c > 0 ? prev[c - 1] : x
          const xr = c < RIPPLE_COLS - 1 ? prev[c + 1] : x
          const a = RIPPLE_COUPLING * (xl + xr - 2 * x) - RIPPLE_STIFFNESS * x - RIPPLE_DAMPING * v
          const nv = v + a * h
          vel[c] = nv
          off[c] = x + nv * h
        }
      }
      // Rest check across the whole chain: only stop once EVERY column has settled (a
      // still-moving column keeps coupling into its neighbors, so we can't stop per-column).
      let active = false
      for (let c = 0; c < RIPPLE_COLS; c++) {
        if (Math.abs(off[c]) < RIPPLE_REST && Math.abs(vel[c]) < RIPPLE_REST) {
          off[c] = 0
          vel[c] = 0
        } else {
          active = true
        }
      }
      paintRipple()
      if (active) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        rafRef.current = null
        // Ripple has come fully to rest — a safe, motionless moment to run the deferred
        // wheel-pan flush (the one React reconcile), so it can't hitch on live motion.
        flushAtRestRef.current()
      }
    },
    [paintRipple],
  )

  const startRipple = useCallback(() => {
    if (rafRef.current != null) return
    lastTsRef.current = performance.now()
    rafRef.current = requestAnimationFrame(tick)
  }, [tick])

  // Inject a pan step (screen px the content just moved by) as distance-scaled lag: the
  // column under the cursor barely lags (moves with the pan), far columns are held back
  // by up to RIPPLE_LAG of the step, then spring back to 0 → the catch-up wave.
  const injectPan = useCallback(
    (shiftPx: number) => {
      if (reducedRef.current || shiftPx === 0) return
      const off = offsetRef.current
      const cc = cursorColRef.current
      const maxDist = Math.max(cc, RIPPLE_COLS - 1 - cc, 1)
      for (let c = 0; c < RIPPLE_COLS; c++) {
        const dist = Math.abs(c - cc) / maxDist // 0 at cursor → 1 at far edge
        const lag = RIPPLE_LAG * Math.pow(dist, RIPPLE_FALLOFF)
        // Hold the column back by −shift*lag; the spring (target 0) then lands it.
        let x = off[c] - shiftPx * lag
        if (x > RIPPLE_MAX_OFFSET) x = RIPPLE_MAX_OFFSET
        else if (x < -RIPPLE_MAX_OFFSET) x = -RIPPLE_MAX_OFFSET
        off[c] = x
      }
      startRipple()
    },
    [startRipple],
  )

  // --- Panning (linear drag, no zoom) ---------------------------------------
  const dragRef = useRef<{ startX: number; startView: number; lastX: number } | null>(null)
  // Set true once a drag moves past threshold; suppresses the chip click that would
  // otherwise fire on pointerup, and reset on the next pointerdown.
  const draggedRef = useRef(false)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      draggedRef.current = false
      dragRef.current = { startX: e.clientX, startView: viewStart, lastX: e.clientX }
      cursorColRef.current = pctToCol(e.clientX)
      laneRef.current?.setPointerCapture(e.pointerId)
    },
    [viewStart, pctToCol],
  )
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current
      const lane = laneRef.current
      // Track cursor column even when not dragging so a wheel pan radiates from the pointer.
      cursorColRef.current = pctToCol(e.clientX)
      if (!d || !lane) return
      const w = lane.clientWidth || 1
      const dx = e.clientX - d.startX
      if (Math.abs(dx) > 3) draggedRef.current = true
      // Incremental screen shift since the last move drives the ripple (content follows
      // the finger, so dragging right by `inc` moves content right by `inc`).
      const inc = e.clientX - d.lastX
      d.lastX = e.clientX
      injectPan(inc)
      // Drag right → reveal earlier time (window slides back), and vice-versa.
      setViewStart(d.startView - (dx / w) * DAY_MS)
    },
    [pctToCol, injectPan],
  )
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null
    if (laneRef.current?.hasPointerCapture(e.pointerId)) laneRef.current.releasePointerCapture(e.pointerId)
  }, [])
  // Double-click snaps back to the live window containing now.
  const recenter = useCallback(() => setViewStart(dayWindow(Date.now())[0]), [])

  // Wheel/trackpad pan. Attached natively (not via React's passive onWheel) so we can
  // preventDefault and stop the page from scrolling while panning the lane. Uses the
  // dominant scroll axis (deltaX on trackpads, deltaY on a plain mouse wheel), mapped
  // linearly to time by the lane width — same scale as the drag. Scrolling forward
  // (down / right) reveals LATER time (window slides forward), mirroring the drag where
  // dragging left reveals later time.
  //
  // SMOOTHING: applying a notch instantly makes a physical mouse wheel jump a big step per
  // tick. Instead each notch adds raw delta px into `wheelPendingRef`, and a rAF loop eases
  // it out with a single dt-normalized ease-OUT (a fraction of the remaining buffer per
  // frame) for a smooth, low-lag glide.
  //
  // JANK FIX: the base pan is applied as an IMPERATIVE transform on `panWrapRef` (which
  // wraps both the ticks and the NOW marker) rather than via `setViewStart` every frame.
  // That (a) avoids a full React re-render + `items` recompute per frame — the source of
  // the lag — and (b) keeps the base pan on the SAME frame as the ripple (also imperative),
  // so they can't desync into a visible jump. We only FLUSH the accumulated transform into
  // `viewStart` when it crosses `WHEEL_FLUSH_FRAC` of the lane or when the gesture settles;
  // a layout effect clears the transform in the same paint as the flush, so there's no jump.
  const flushWheelPan = useCallback(() => {
    const lane = laneRef.current
    const commit = wheelCommitRef.current
    if (!lane || !commit) return
    const w = lane.clientWidth || 1
    wheelCommitRef.current = 0 // cleared BEFORE the state update so the layout effect zeroes the transform
    // Atomic swap without a forced synchronous render: the `viewStart` change re-renders
    // ticks with new `leftPct`, and the `useLayoutEffect` below (keyed on viewStart) clears
    // the pan-wrap transform in the same pre-paint step — base shift + transform removal
    // land together. (flushSync was tried here but only added a mid-motion render hitch.)
    setViewStart((vs) => vs + (commit / w) * DAY_MS)
  }, [])

  // Deferred flush: only commit the imperative pan into `viewStart` (the one React
  // reconcile of all ticks) once BOTH the wheel drain (`wheelRafRef`) and the ripple
  // spring (`rafRef`) are fully at rest. Running the reconcile during the ripple's
  // settle was the source of the visible hitch — at true rest it's motionless and free.
  const maybeFlushAtRest = useCallback(() => {
    if (wheelRafRef.current == null && rafRef.current == null && wheelCommitRef.current !== 0) {
      flushWheelPan()
    }
  }, [flushWheelPan])
  flushAtRestRef.current = maybeFlushAtRest

  useEffect(() => {
    const lane = laneRef.current
    if (!lane) return

    const drain = (ts: number) => {
      const w = lane.clientWidth || 1
      // Frame-time factor: 1 at 60fps, larger on slower frames — keeps rates consistent.
      const dt = wheelTsRef.current ? Math.min((ts - wheelTsRef.current) / 16.67, 3) : 1
      wheelTsRef.current = ts

      const pending = wheelPendingRef.current
      // Single ease-out: consume a dt-normalized fraction of the remaining buffer.
      let slice = pending * (1 - Math.pow(1 - WHEEL_DRAIN, dt))
      // Floor so the tail finishes instead of asymptoting forever.
      if (Math.abs(pending) <= 0.5) slice = pending
      else if (Math.abs(slice) < 0.5) slice = Math.sign(pending) * 0.5

      wheelPendingRef.current = pending - slice
      wheelCommitRef.current += slice
      // Imperative base pan (composited transform, no React render) kept in lockstep with
      // the ripple. Negative because scrolling forward moves content LEFT.
      applyPan(-wheelCommitRef.current)
      injectPan(-slice)

      // Flush to React truth once the imperative offset grows large, so `items`/marker
      // re-anchor and stay fresh (the layout effect re-zeroes the transform seamlessly).
      if (Math.abs(wheelCommitRef.current) > w * WHEEL_FLUSH_FRAC) flushWheelPan()

      if (Math.abs(wheelPendingRef.current) > 0.05) {
        wheelRafRef.current = requestAnimationFrame(drain)
      } else {
        wheelPendingRef.current = 0
        wheelTsRef.current = 0
        wheelRafRef.current = null
        // Don't flush yet if the ripple is still settling — defer to its rest (see
        // `maybeFlushAtRest`). If the ripple is already at rest, this flushes now.
        maybeFlushAtRest()
      }
    }

    const onWheel = (e: WheelEvent) => {
      let delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (delta === 0) return
      e.preventDefault()
      // Normalize non-pixel wheel modes so line/page-based mice map to comparable px.
      if (e.deltaMode === 1) delta *= 16 // lines → px
      else if (e.deltaMode === 2) delta *= lane.clientWidth || 1 // pages → px
      // Sensitivity: a raw mouse notch (~120px) pans the whole lane far too hard, so scale
      // each notch down — the pan covers ~40% of the notch's raw distance.
      delta *= WHEEL_PAN_SENSITIVITY
      cursorColRef.current = pctToCol(e.clientX)
      wheelPendingRef.current += delta
      if (wheelRafRef.current == null) {
        wheelTsRef.current = 0
        wheelRafRef.current = requestAnimationFrame(drain)
      }
    }

    lane.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      lane.removeEventListener("wheel", onWheel)
      if (wheelRafRef.current != null) cancelAnimationFrame(wheelRafRef.current)
      wheelRafRef.current = null
      wheelPendingRef.current = 0
      wheelCommitRef.current = 0
      wheelTsRef.current = 0
    }
  }, [pctToCol, injectPan, flushWheelPan, maybeFlushAtRest, applyPan])

  // Keep the imperative pan-wrap transform consistent with `viewStart`. Runs synchronously
  // after every commit (before paint), so when a wheel flush moves `viewStart` and zeroes
  // `wheelCommitRef`, the residual transform is cleared in the SAME paint — the base % (now
  // updated) and the transform swap seamlessly with no one-frame jump. For drag / any other
  // viewStart change `wheelCommitRef` is 0, so this just clears any stale transform.
  useLayoutEffect(() => {
    applyPan(-wheelCommitRef.current)
  }, [viewStart, applyPan])

  // Stop the loop on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // Column a given lane percentage falls in (for assigning items + marker to a screen column).
  const colOfPct = (p: number) => Math.max(0, Math.min(RIPPLE_COLS - 1, Math.round((p / 100) * (RIPPLE_COLS - 1))))
  const nowCol = colOfPct(Math.max(0, Math.min(100, nowPct)))

  return (
    // Constant-height header row. `pointer-events-none` lets the gaps fall through;
    // the lane + its ticks re-enable pointer events for themselves. px-5 aligns the
    // lane edges with the top bar's content (header paddingLeft/Right = 20).
    // `items-end`: the lane hugs the ROW's bottom edge, which coincides with the
    // window-region top (the region is inset by the full overlay height), so the
    // Dayline sits FLUSH on the View with no gap — the row's slack lives above the
    // lane (next to the header) instead of between the lane and the View.
    <div
      className="pointer-events-none relative z-30 flex w-full items-end px-5"
      style={{ height: DAYLINE_ROW_H }}
    >
      {/* The lane. A thin full-width strip forming the Individual's day insight.
          Time-dependent content is gated on `mounted` to keep SSR == first client paint.
          Drag to pan (linear), double-click to recenter on now. `touch-action: none`
          and `select-none` keep horizontal drags from scrolling/selecting. */}
      <div
        ref={laneRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={recenter}
        className="pointer-events-auto relative h-7 w-full cursor-default select-none overflow-visible rounded-md border border-border/60 bg-card/40 [touch-action:none]"
      >
        {/* Item CLIP layer — FIXED to the lane (never transformed) so it always clips to
            the true lane bounds. Fills the lane and trims ripple-lagged / margin ticks
            exactly at the extremities. The NOW marker + hover helper live OUTSIDE this clip
            so their intentional 1px bleed and downward tooltip are unaffected. */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
          {/* TICKS PAN — the in-progress wheel pan is applied here as an imperative
              `translateX` (see the drain loop): the CONTENT slides within the fixed clip
              window, so ticks entering from either edge reveal correctly during the gesture.
              Identity except mid-wheel-gesture; flushed into `viewStart` on settle. */}
          <div ref={ticksPanRef} className="pointer-events-none absolute inset-0 will-change-transform">
          {mounted &&
            items.map((it) => {
              const isHot = hovered === it.key
            const col = colOfPct(it.centerPct)
            // Each item lives inside a full-lane RIPPLE WRAPPER whose `translateX` the rAF
            // loop drives (imperative, so React never fights it); the inner button keeps
            // its own centering transform untouched. The wrapper is pointer-events-none so
            // empty area still passes drags to the lane; the button re-enables events.
            if (it.isDuration) {
              return (
                <div
                  key={it.key}
                  ref={registerRipple(it.key)}
                  data-col={col}
                  data-left={it.leftPct}
                  className="pointer-events-none absolute inset-0 will-change-transform"
                >
                  <button
                    type="button"
                    aria-label={`${it.title}, ${it.range}`}
                    onMouseEnter={() => setHovered(it.key)}
                    onMouseLeave={() => setHovered((h) => (h === it.key ? null : h))}
                    onClick={() => {
                      if (draggedRef.current) return // a pan, not a tap
                      open(it.id)
                    }}
                    className="pointer-events-auto absolute top-1/2 -translate-y-1/2 cursor-default rounded-[3px] transition-[filter,height] duration-150"
                    style={{
                      left: `${it.leftPct}%`,
                      width: `max(3px, ${it.widthPct}%)`,
                      height: isHot ? 18 : 12,
                      backgroundColor: it.color,
                      opacity: isHot ? 0.9 : 0.42,
                      filter: isHot ? "saturate(1.4) brightness(1.1)" : "none",
                      zIndex: isHot ? 20 : 1,
                    }}
                  />
                </div>
              )
            }
            // Instant → a thin solid vertical tick spanning the lane.
            return (
              <div
                key={it.key}
                ref={registerRipple(it.key)}
                data-col={col}
                data-left={it.leftPct}
                className="pointer-events-none absolute inset-0 will-change-transform"
              >
                <button
                  type="button"
                  aria-label={`${it.title}, ${it.range}`}
                  onMouseEnter={() => setHovered(it.key)}
                  onMouseLeave={() => setHovered((h) => (h === it.key ? null : h))}
                  onClick={() => {
                    if (draggedRef.current) return // a pan, not a tap
                    open(it.id)
                  }}
                  className="pointer-events-auto absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-default rounded-full transition-[filter,height,width] duration-150"
                  style={{
                    left: `${it.leftPct}%`,
                    width: isHot ? 3 : 2,
                    height: isHot ? 22 : 16,
                    backgroundColor: it.color,
                    filter: isHot ? "saturate(1.5) brightness(1.15)" : "none",
                    zIndex: isHot ? 20 : 2,
                  }}
                />
              </div>
            )
          })}
          </div>
        </div>

        {/* NOW marker — a thin, bright-orange vertical tick (discrete but visible),
            painted above every item. Small triangular caps sit just INSIDE the lane at
            the top and bottom edges, pointing inward, mirroring the timeline's now-marker
            so the live-time indicator reads identically on both. Gated on `mounted`: its
            position is time-derived, so it must not render on the server (would mismatch
            the client's clock). Also hidden when panned out of view (`nowInView`) so it
            doesn't spill past the overflow-visible lane into the header. Wrapped in a
            ripple node so it rides the same catch-up wave as the content around it. */}
        {mounted && nowInView && (
          <div ref={markerPanRef} className="pointer-events-none absolute inset-0 z-30 will-change-transform">
          <div
            aria-hidden
            ref={registerRipple("__now__")}
            data-col={nowCol}
            className="pointer-events-none absolute inset-0 will-change-transform"
          >
            <div
              className="pointer-events-auto absolute -bottom-px -top-px w-[2px] -translate-x-1/2 rounded-full"
              style={{ left: `${nowPct}%`, backgroundColor: NOW_COLOR, boxShadow: `0 0 4px ${NOW_COLOR}` }}
            >
              {/* Invisible, wider hit zone so the 2px line is hoverable in practice; it
                  toggles the time pill via React state. */}
              <span
                className="absolute -bottom-1 -top-1 left-1/2 w-4 -translate-x-1/2 cursor-default"
                onMouseEnter={() => setNowHover(true)}
                onMouseLeave={() => setNowHover(false)}
              />
              {/* Downward cap — sits just inside the TOP edge, pointing down into the lane. */}
              <span
                className="absolute left-1/2 -translate-x-1/2"
                style={{
                  top: 1,
                  width: 0,
                  height: 0,
                  borderLeft: "3px solid transparent",
                  borderRight: "3px solid transparent",
                  borderTop: `5px solid ${NOW_COLOR}`,
                }}
              />
              {/* Upward cap — sits just inside the BOTTOM edge, pointing up into the lane. */}
              <span
                className="absolute left-1/2 -translate-x-1/2"
                style={{
                  bottom: 1,
                  width: 0,
                  height: 0,
                  borderLeft: "3px solid transparent",
                  borderRight: "3px solid transparent",
                  borderBottom: `5px solid ${NOW_COLOR}`,
                }}
              />
              {/* Live time tooltip — shown ONLY on hover of the marker, pinned to its center.
                  24h format; tabular-nums keeps the digits from jittering as the minute advances. */}
              <span
                className={cn(
                  "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded border border-border/70 bg-card px-2 py-1 text-[10.5px] font-medium leading-none tracking-tight tabular-nums text-foreground/80 shadow-sm transition-opacity duration-150",
                  nowHover ? "opacity-100" : "opacity-0",
                )}
              >
                {new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
              </span>
            </div>
          </div>
          </div>
        )}
      </div>

      {/* HOVER HELPER — floats just below the lane (the header sits directly above,
          so there's no room to place it on top). Shows glyph + title + time range. */}
      {hoveredItem && (
        <div
          className="pointer-events-none absolute top-full z-40 flex max-w-[40vw] -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded border border-border/70 bg-card px-2 py-1 text-[10.5px] font-medium leading-none tracking-tight text-foreground/80 shadow-sm animate-in fade-in duration-150"
          style={{ left: `calc(${Math.min(94, Math.max(6, hoveredItem.centerPct))}% )`, marginTop: 4 }}
        >
          <span className="h-3 w-3 shrink-0" style={{ color: hoveredItem.color }}>
            <NodeGlyph kind={hoveredItem.kind} filled={hoveredItem.filled} strokeWidth={2} />
          </span>
          <span className="truncate text-foreground">{hoveredItem.title}</span>
          <span className="shrink-0 text-muted-foreground tabular-nums">{hoveredItem.range}</span>
        </div>
      )}
    </div>
  )
}
