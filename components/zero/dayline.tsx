"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useZeroNav } from "@/lib/zero/nav-store"
import { getTimelineOccurrences, getInheritedAccent } from "@/lib/zero/data"
import { entityInterval } from "@/lib/zero/timeline-index"
import { KIND_META } from "@/lib/zero/kinds"
import { rangeText, NOW_COLOR } from "@/lib/zero/timeline-format"
import { placementKey } from "@/lib/zero/placement"
import { DAYLINE_ROW_H, DAYLINE_COMPACT_LIFT, shellStageFor } from "@/lib/zero/layout"
import { DURATION_S, MORPH_CSS_EASE } from "@/lib/zero/flip-stage"
import { useNow } from "@/lib/zero/use-now"
import { cn } from "@/lib/utils"
import { isSleepTitle, sleepSkyBackground } from "@/lib/zero/sleep-sky"
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
// GAIN on the lag ramp. The hold fraction is CLAMPED to ≤ 1 (see injectPan — anything
// beyond 1 would reverse a column's motion), so gain no longer sets amplitude; it sets
// how quickly the ramp reaches the frozen far plateau, i.e. how WIDE that plateau is.
// 1.0 = asymptotic freeze only at the far edge; higher = a broader frozen region. Kept
// modestly >1 (1.2) for a fuller wave while leaving most of the lane graduated so the
// lens stays local and the pan doesn't read as a whole-lane jerk.
const RIPPLE_GAIN = 1.2
// Falloff exponent for lag vs normalized cursor distance. <1 = concave: lag ramps up
// FAST right off the cursor column, so only a TIGHT zone under the pointer stays in sync
// (a SMALL "lens") while everything around it reacts. Lowered 0.7 → 0.5 to shrink that
// lens further — the ripple now concentrates right at the cursor instead of spreading wide.
const RIPPLE_FALLOFF = 0.5
// Clamp per-column offset so a rapid scroll burst can't fling content far off-lane.
// Raised 220 → 320 so far columns can trail further for a bigger, more fluid wave.
const RIPPLE_MAX_OFFSET = 320

// Pan sensitivity = fraction of a raw scroll delta (px) the lane ultimately travels.
// SPLIT BY INPUT TYPE, because the two devices report very different deltas:
//   • MOUSE WHEEL fires large, coarse notches (~100px+, or line/page mode). Mapping 1:1
//     flings the lane, so it stays damped.
//   • TRACKPAD / precision devices fire small, frequent pixel deltas the user expects to
//     track their finger ~1:1 — damping those is what felt sluggish / "capped".
// NOTE: there is NO hard velocity cap anywhere in the momentum model; the "cap reached
// too early" feel was purely this scalar throttling the trackpad's steady-state speed.
const WHEEL_PAN_SENSITIVITY = 0.42 // physical mouse-wheel notch
const TRACKPAD_PAN_SENSITIVITY = 1.0 // fine-grained trackpad / precision scroll (near 1:1)
// A single raw PIXEL delta at/above this reads as a coarse mouse-wheel notch; smaller
// pixel deltas read as trackpad. (deltaMode !== 0 is always a wheel regardless.)
const WHEEL_NOTCH_MIN_PX = 50
// MOMENTUM MODEL (replaced the old "drain a fraction of a distance buffer" ease-out —
// that emptied the buffer within a few frames of the last notch, so the lane braked hard
// the instant you stopped scrolling, and the ripple's held-back columns snapped back with
// a little bounce). Now each notch injects VELOCITY (px/s); the loop moves by vel·dt each
// frame and decays vel with friction e^(−dt/τ). So while scrolling the lane tracks the
// input speed, and when input stops it KEEPS gliding at that speed and eases to rest over
// ~τ — real inertia, no brake, no bounce. One notch's TOTAL glide distance = Δv·τ, so we
// derive the per-notch velocity impulse as (sensitivity·rawPx)/τ to preserve calibration.
// FRICTION_TAU: velocity decay time-constant (s). Larger = longer, floatier coast.
// Dropped 0.5 → 0.28 → 0.19 to keep tightening the coast so ticks stop sliding on their
// own so much — the lane grips to a stop soon after input ends instead of drifting.
// (Total glide = Δv·τ = sensitivity·rawPx, independent of τ, so this trims the tail
// without changing how far a notch ultimately travels.)
const WHEEL_FRICTION_TAU = 0.19
// End the glide once the pan speed falls below this (px/s) — the tail is imperceptible.
const WHEEL_STOP_V = 14
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
  /** A sleep Moment paints a procedural night-sky fill instead of a flat accent bar. */
  sky: string | null
}

export function Dayline() {
  const { stack, dataVersion, open, activeEntity } = useZeroNav()
  const rootId = stack[0]

  // Open an entity FROM its dayline tick: use the CLICKED tick's own live viewport
  // rect as the morph origin so the window grows out of exactly that tick (same
  // "open-from" law the dock/do-list/timeline launchers use). We build the origin
  // from the clicked element directly rather than resolving by placement key,
  // because a RECURRING entity paints several ticks that all share one id/key — a
  // key lookup would return the first match, not the occurrence the user tapped.
  // The rect is read live (so pan/ripple transforms are already baked in); we still
  // pass the placement key so the CLOSE morph can re-target this appearance. Falls
  // back to a plain center open if the rect is somehow unavailable. Guarded against
  // pan-vs-tap by the caller (`draggedRef`).
  const openFromTick = useCallback(
    (entityId: string, el: HTMLElement | null) => {
      if (!el) {
        open(entityId)
        return
      }
      const r = el.getBoundingClientRect()
      open(entityId, {
        rect: { top: r.top, left: r.left, width: r.width, height: r.height },
        kind: "generic",
        placement: placementKey("dayline", rootId, entityId),
      })
    },
    [open, rootId],
  )
  // At depth ≥ 2 (stage 2) the header shrinks; pull the Dayline a touch closer to it.
  // The View follows via WINDOW_TOP_LIFT[2] (which folds in DAYLINE_COMPACT_LIFT), so it
  // stays flush. Eased on the shared morph curve to match the header's height animation.
  const compact = shellStageFor(activeEntity) === 2

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
        // A sleep Moment (span) gets its own procedural night sky, seeded by the
        // occurrence key so each night differs but stays stable across pans.
        sky: isDuration && e.kind === "event" && isSleepTitle(e.title) ? sleepSkyBackground(e.occKey) : null,
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
  // Last known cursor viewport position + whether it's currently over the lane. Panning
  // (esp. wheel) moves ticks under a STATIONARY cursor via transform, so the browser fires
  // no mouseenter/leave and the hover tooltip would go stale. We re-hit-test the tick under
  // the cursor each pan frame from these coords (see `resolveHoverAtCursor`).
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const pointerInsideRef = useRef(false)
  // Wheel-pan momentum. A physical mouse wheel fires large discrete notches (often
  // line/page deltaMode, ~100px+ each); applying a whole notch at once jumps the lane.
  // Instead each notch injects VELOCITY (px/s) into this ref, and a rAF loop advances the
  // pan by vel·dt each frame while decaying vel with friction — turning stepped ticks into
  // a continuous glide that coasts on after input stops (trackpads send tiny continuous
  // deltas, so they simply keep topping up the velocity and it tracks them smoothly).
  const wheelVelRef = useRef(0)
  const wheelRafRef = useRef<number | null>(null)
  const wheelTsRef = useRef(0)
  // Base pan applied imperatively (via `panWrapRef` transform) but not yet flushed into
  // `viewStart`. Invariant: (viewStart's wheel delta, in px) + wheelCommitRef == total pan
  // consumed, so base + ripple always agree with no jump when we flush.
  const wheelCommitRef = useRef(0)
  // Chunk of `wheelCommitRef` that a mid-gesture flush has requested to bake into `viewStart`
  // but React hasn't committed yet. It is NOT subtracted from `wheelCommitRef` until the
  // layout effect fires on the `viewStart` commit — so the transform keeps including it while
  // the DOM base is still stale, and the subtraction + base move happen in the SAME paint.
  // Without this, a glide frame firing between the flush request and its commit would reset
  // the transform against the old base → the sudden jump seen when scrolling fast.
  const pendingFlushRef = useRef(0)
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

  // Re-resolve which tick sits under the (possibly stationary) cursor and sync `hovered`.
  // Called each pan frame: since ticks slide by transform, the DOM's own hover tracking
  // doesn't fire, so we hit-test the real pixel under the cursor. Only acts while the
  // pointer is over the lane (a true mouseleave already clears hover when it exits). The
  // functional setState no-ops (no re-render) whenever the tick under the cursor is
  // unchanged, so calling this every frame is cheap.
  const resolveHoverAtCursor = useCallback(() => {
    if (!pointerInsideRef.current) return
    const { x, y } = lastPointerRef.current
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const tick = el?.closest("[data-tickkey]") as HTMLElement | null
    const key = tick?.getAttribute("data-tickkey") ?? null
    setHovered((h) => (h === key ? h : key))
  }, [])

  // Write the current per-column offsets onto every registered node.
  //
  // Each node samples the wave at its LIVE, CONTINUOUS screen column and INTERPOLATES
  // between the two adjacent column springs — never snaps to a rounded bucket. This kills
  // two jump sources that surfaced at speed:
  //   • QUANTIZATION — the old code used `off[round(centerPct→col)]`, so a tick crossing a
  //     column boundary jumped by `off[c+1]−off[c]` (nonzero whenever the wave is active).
  //   • STALENESS — `data-col` only refreshes on a React render, but the lane pans
  //     imperatively between flushes, so a moving tick kept reading its OLD column and then
  //     snapped when the next render corrected it. We instead derive the column from the
  //     node's live screen position = its last-rendered `leftPct` PLUS the current imperative
  //     base pan (`-wheelCommitRef`, the same px `applyPan` wrote to the parent), so it
  //     tracks the real position every frame and stays continuous across a flush (the flush
  //     invariant keeps `leftPct + basePan` constant through the base⇄transform handoff).
  // OFF-SCREEN SKIP uses the same live fraction (±0.4 ≈ the max ripple displacement) so a
  // lagged tick can't be skipped while still visually on-screen; skipped nodes clear once.
  const paintRipple = useCallback(() => {
    const off = offsetRef.current
    const maxCol = RIPPLE_COLS - 1
    const lane = laneRef.current
    const w = lane ? lane.clientWidth || 1 : 1
    const baseFrac = -wheelCommitRef.current / w // imperative base pan as a lane fraction
    for (const el of rippleNodesRef.current.values()) {
      const left = +(el.dataset.left ?? "") || 0
      const frac = left / 100 + baseFrac // live screen fraction (0 = left edge, 1 = right)
      if (frac < -0.4 || frac > 1.4) {
        if (el.style.transform) el.style.transform = ""
        continue
      }
      // Continuous column coordinate, then linear interpolation between its neighbors.
      const fcol = Math.max(0, Math.min(maxCol, frac * maxCol))
      const i = Math.floor(fcol)
      const t = fcol - i
      const x0 = off[i] || 0
      const x1 = off[Math.min(maxCol, i + 1)] || 0
      const x = x0 + (x1 - x0) * t
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
        // Hold fraction: how much of THIS pan step the column is held back by. CLAMPED to
        // ≤ 1 — a column can never be held back by MORE than the content actually moved,
        // otherwise its net motion would REVERSE (move opposite the pan) until the base
        // catches up: the "left of the cursor first slides right / contracts" glitch. With
        // the clamp, columns range from moving-with-the-pan (near cursor, hold→0) to
        // momentarily FROZEN (far, hold→1) and then spring-catch-up — a squeeze at the
        // lens with everything still travelling in the pan direction, never backwards.
        // GAIN (>1) only widens the frozen far plateau now; it can no longer over-drive
        // past 1, so it cannot cause reversal. FALLOFF keeps the in-sync lens tight.
        const hold = Math.min(1, RIPPLE_LAG * Math.pow(dist, RIPPLE_FALLOFF) * RIPPLE_GAIN)
        // Hold the column back by −shift*hold; the spring (target 0) then lands it.
        let x = off[c] - shiftPx * hold
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
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      pointerInsideRef.current = true
      // NOTE: we deliberately do NOT setPointerCapture here. Capturing on pointerdown
      // retargets the subsequent `click` to the LANE (the capture target), per the Pointer
      // Events spec — so a plain TAP on a tick never reaches the tick button's onClick and
      // "clicking a tick to open its entity" silently does nothing. We instead capture only
      // once a real drag crosses the move threshold (in onPointerMove), so a tap stays
      // uncaptured and its click lands on the tick, while a genuine pan still captures to
      // keep tracking when the cursor leaves the lane.
    },
    [viewStart, pctToCol],
  )
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current
      const lane = laneRef.current
      // Track cursor column even when not dragging so a wheel pan radiates from the pointer.
      cursorColRef.current = pctToCol(e.clientX)
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      pointerInsideRef.current = true
      if (!d || !lane) return
      const w = lane.clientWidth || 1
      const dx = e.clientX - d.startX
      // On the FIRST frame the move crosses the drag threshold, promote to a drag AND grab
      // pointer capture — so panning keeps tracking if the cursor leaves the lane. Capturing
      // here (not on pointerdown) is what lets a plain tap's click reach the tick button.
      if (Math.abs(dx) > 3 && !draggedRef.current) {
        draggedRef.current = true
        laneRef.current?.setPointerCapture(e.pointerId)
      }
      // Incremental screen shift since the last move drives the ripple (content follows
      // the finger, so dragging right by `inc` moves content right by `inc`).
      const inc = e.clientX - d.lastX
      d.lastX = e.clientX
      injectPan(inc)
      // Drag right → reveal earlier time (window slides back), and vice-versa.
      setViewStart(d.startView - (dx / w) * DAY_MS)
      // Ticks slide under the cursor as we drag — keep the hover/tooltip in sync.
      resolveHoverAtCursor()
    },
    [pctToCol, injectPan, resolveHoverAtCursor],
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
  // SMOOTHING / MOMENTUM: applying a notch instantly makes a physical mouse wheel jump a big
  // step per tick. Instead each notch injects a VELOCITY impulse into `wheelVelRef`, and a rAF
  // loop advances the pan by vel·dt each frame while decaying vel with friction (e^(−dt/τ)) —
  // so the lane tracks the input while scrolling and then COASTS on and eases to rest after
  // input stops, instead of braking the instant the buffer empties. See the momentum consts.
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
    if (!lane) return
    // Skip if a previous flush hasn't committed yet — its chunk is still baking into
    // `viewStart`. We wait for the layout effect to reconcile before requesting another,
    // so `pendingFlushRef` always tracks exactly one in-flight chunk.
    if (pendingFlushRef.current !== 0) return
    const commit = wheelCommitRef.current
    if (!commit) return
    const w = lane.clientWidth || 1
    // Bake `commit` px into `viewStart`, but do NOT zero `wheelCommitRef` here: the DOM base
    // only moves once React commits `viewStart`, so the transform must keep including this
    // chunk until then (otherwise a glide frame firing before the commit resets the transform
    // against the stale base → the visible jump at speed). The layout effect subtracts exactly
    // this chunk atomically with the base move, so the swap is seamless at any scroll speed.
    pendingFlushRef.current = commit
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

    const glide = (ts: number) => {
      const w = lane.clientWidth || 1
      // dt in SECONDS (clamped so a stalled tab can't teleport the pan in one frame).
      const dt = wheelTsRef.current ? Math.min((ts - wheelTsRef.current) / 1000, 0.05) : 1 / 60
      wheelTsRef.current = ts

      const vel = wheelVelRef.current
      // Distance travelled this frame at the current velocity…
      const slice = vel * dt
      // …then friction decays the velocity toward zero (exponential, frame-rate independent).
      // A fresh notch's impulse rides on top of whatever coast is already in flight, so
      // successive notches build momentum rather than resetting it.
      wheelVelRef.current = vel * Math.exp(-dt / WHEEL_FRICTION_TAU)

      wheelCommitRef.current += slice
      // Imperative base pan (composited transform, no React render) kept in lockstep with
      // the ripple. Negative because scrolling forward moves content LEFT.
      applyPan(-wheelCommitRef.current)
      injectPan(-slice)
      // Ticks slide under the stationary cursor during a wheel pan — re-hit-test each
      // frame so the hover highlight + tooltip track whatever tick is now underneath.
      resolveHoverAtCursor()

      // Flush to React truth once the imperative offset grows large, so `items`/marker
      // re-anchor and stay fresh (the layout effect re-zeroes the transform seamlessly).
      if (Math.abs(wheelCommitRef.current) > w * WHEEL_FLUSH_FRAC) flushWheelPan()

      // Keep coasting until the velocity (px/s) falls below the imperceptible floor.
      if (Math.abs(wheelVelRef.current) > WHEEL_STOP_V) {
        wheelRafRef.current = requestAnimationFrame(glide)
      } else {
        wheelVelRef.current = 0
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
      // Classify BEFORE normalizing: a coarse mouse wheel (line/page mode, or a big pixel
      // notch) vs a fine trackpad (small pixel deltas). Each gets its own sensitivity so
      // trackpads track ~1:1 (not sluggish) while wheel notches stay damped (not flung).
      const isMouseWheel = e.deltaMode !== 0 || Math.abs(delta) >= WHEEL_NOTCH_MIN_PX
      if (e.deltaMode === 1) delta *= 16 // lines → px
      else if (e.deltaMode === 2) delta *= lane.clientWidth || 1 // pages → px
      delta *= isMouseWheel ? WHEEL_PAN_SENSITIVITY : TRACKPAD_PAN_SENSITIVITY
      cursorColRef.current = pctToCol(e.clientX)
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      pointerInsideRef.current = true
      // Inject the notch as a VELOCITY impulse. Since a coasting velocity v decays as
      // v·e^(−t/τ), its integral (total distance) is v��τ — so to make this notch add
      // exactly `delta` px of travel we inject Δv = delta/τ. This preserves the old
      // per-notch reach while giving the motion inertia that outlives the input.
      wheelVelRef.current += delta / WHEEL_FRICTION_TAU
      if (wheelRafRef.current == null) {
        wheelTsRef.current = 0
        wheelRafRef.current = requestAnimationFrame(glide)
      }
    }

    lane.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      lane.removeEventListener("wheel", onWheel)
      if (wheelRafRef.current != null) cancelAnimationFrame(wheelRafRef.current)
      wheelRafRef.current = null
      wheelVelRef.current = 0
      wheelCommitRef.current = 0
      pendingFlushRef.current = 0
      wheelTsRef.current = 0
    }
  }, [pctToCol, injectPan, flushWheelPan, maybeFlushAtRest, applyPan, resolveHoverAtCursor])

  // Keep the imperative pan-wrap transform consistent with `viewStart`. Runs synchronously
  // after every commit (before paint). When a wheel flush moves `viewStart`, we subtract the
  // just-baked chunk (`pendingFlushRef`) from `wheelCommitRef` and re-apply the transform in
  // the SAME pre-paint step — the base % (now updated) and the reduced transform swap
  // seamlessly with no one-frame jump, regardless of how many glide frames ran in between.
  // For drag / any other viewStart change `pendingFlushRef` is 0, so this just re-syncs.
  useLayoutEffect(() => {
    if (pendingFlushRef.current !== 0) {
      wheelCommitRef.current -= pendingFlushRef.current
      pendingFlushRef.current = 0
    }
    applyPan(-wheelCommitRef.current)
  }, [viewStart, applyPan])

  // Stop the loop on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

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
      style={{
        height: DAYLINE_ROW_H,
        marginTop: compact ? -DAYLINE_COMPACT_LIFT : 0,
        transition: `margin-top ${DURATION_S} ${MORPH_CSS_EASE}`,
      }}
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
        onMouseEnter={() => (pointerInsideRef.current = true)}
        onMouseLeave={() => (pointerInsideRef.current = false)}
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
            // Each item lives inside a full-lane RIPPLE WRAPPER whose `translateX` the rAF
            // loop drives (imperative, so React never fights it); the inner button keeps
            // its own centering transform untouched. The wrapper is pointer-events-none so
            // empty area still passes drags to the lane; the button re-enables events.
            if (it.isDuration) {
              return (
                <div
                  key={it.key}
                  ref={registerRipple(it.key)}
                  data-left={it.leftPct}
                  className="pointer-events-none absolute inset-0 will-change-transform"
                >
                  <button
                    type="button"
                    aria-label={`${it.title}, ${it.range}`}
                    data-placement={placementKey("dayline", rootId, it.id)}
                    data-morph-kind="generic"
                    data-tickkey={it.key}
                    onMouseEnter={() => setHovered(it.key)}
                    onMouseLeave={() => setHovered((h) => (h === it.key ? null : h))}
                    onClick={(e) => {
                      if (draggedRef.current) return // a pan, not a tap
                      openFromTick(it.id, e.currentTarget)
                    }}
                    className="pointer-events-auto absolute top-1/2 -translate-y-1/2 cursor-default overflow-hidden rounded-[3px] transition-[filter,height,opacity] duration-150"
                    style={{
                      left: `${it.leftPct}%`,
                      width: `max(3px, ${it.widthPct}%)`,
                      height: isHot ? 18 : 12,
                      // Sleep Moments paint a vivid procedural night sky; like every
                      // other tick it sits at lowered opacity when idle and lifts to
                      // full on hover.
                      ...(it.sky
                        ? { background: it.sky, opacity: isHot ? 1 : 0.42 }
                        : { backgroundColor: it.color, opacity: isHot ? 0.9 : 0.42 }),
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
                data-left={it.leftPct}
                className="pointer-events-none absolute inset-0 will-change-transform"
              >
                <button
                  type="button"
                  aria-label={`${it.title}, ${it.range}`}
                  data-placement={placementKey("dayline", rootId, it.id)}
                  data-morph-kind="generic"
                  data-tickkey={it.key}
                  onMouseEnter={() => setHovered(it.key)}
                  onMouseLeave={() => setHovered((h) => (h === it.key ? null : h))}
                  onClick={(e) => {
                    if (draggedRef.current) return // a pan, not a tap
                    openFromTick(it.id, e.currentTarget)
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
            data-left={nowPct}
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

        {/* HOVER HELPER — floats just below the lane (the header sits directly above,
            so there's no room to place it on top). Lives INSIDE the lane so its
            `left: centerPct%` shares the ticks' own coordinate space: the outer row is
            px-5 padded, so positioning against that padded box shifted the tip left of
            its tick by the padding. Shows glyph + title + time range. */}
        {hoveredItem && (
          <div
            className="pointer-events-none absolute top-full z-40 flex max-w-[40vw] -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded border border-border/70 bg-card px-2 py-1 text-[10.5px] font-medium leading-none tracking-tight text-foreground/80 shadow-sm animate-in fade-in duration-150"
            style={{ left: `${Math.min(96, Math.max(4, hoveredItem.centerPct))}%`, marginTop: 4 }}
          >
            <span className="h-3 w-3 shrink-0" style={{ color: hoveredItem.color }}>
              <NodeGlyph kind={hoveredItem.kind} filled={hoveredItem.filled} strokeWidth={2} />
            </span>
            <span className="truncate text-foreground">{hoveredItem.title}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{hoveredItem.range}</span>
          </div>
        )}
      </div>
    </div>
  )
}
