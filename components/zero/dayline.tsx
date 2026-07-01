"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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

// --- Ripple tuning ----------------------------------------------------------
// Screen is divided into this many fixed columns; each is one spring. ~16 over a
// typical lane width ≈ 1–2h per column, matching the requested "cell" feel.
const RIPPLE_COLS = 16
// Critically-damped spring: damping = 2*sqrt(stiffness) → fastest settle w/ NO overshoot.
// Softer stiffness = slower, more visible catch-up (a longer, more pronounced trailing
// wave) while staying critically damped (no bounce).
const RIPPLE_STIFFNESS = 34
const RIPPLE_DAMPING = 2 * Math.sqrt(RIPPLE_STIFFNESS)
// Max fraction of a pan step a far column lags behind by (0 = none, 1 = fully held back).
// Near 1 → far columns almost freeze on each step, then snap-catch-up for a big ripple.
const RIPPLE_LAG = 0.99
// Falloff exponent for lag vs normalized cursor distance. <1 = concave: lag ramps up
// FAST right off the cursor column (a SMALL "lens" — near-cursor content reacts
// strongly) while far columns still sit near max lag, so the far effect is preserved.
const RIPPLE_FALLOFF = 0.7
// Clamp per-column offset so a rapid scroll burst can't fling content far off-lane.
const RIPPLE_MAX_OFFSET = 220
// Below this |offset| (px) and |velocity| a column is snapped to rest. Set above the
// sub-pixel range so critical damping's slow asymptotic tail can't leave a lingering
// (invisible) transform hanging around after the wave has visually landed.
const RIPPLE_REST = 0.4

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
  const winEnd = viewStart + DAY_MS

  const [hovered, setHovered] = useState<string | null>(null)
  // Hover state for the NOW marker's time tooltip (React-driven, like the chips —
  // the Tailwind `group-hover` variant isn't reliably compiled in this project).
  const [nowHover, setNowHover] = useState(false)

  const items = useMemo<DayItem[]>(() => {
    if (!mounted) return []
    const occ = getTimelineOccurrences(rootId, winStart, winEnd)
    const out: DayItem[] = []
    for (const e of occ) {
      const [st, en] = entityInterval(e)
      // One-offs are NOT range-clipped by the query, so intersect the window here.
      if (en < winStart || st > winEnd) continue
      const cs = Math.max(st, winStart)
      const ce = Math.min(en, winEnd)
      const leftPct = ((cs - winStart) / DAY_MS) * 100
      const widthPct = Math.max(0, ((ce - cs) / DAY_MS) * 100)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId, winStart, winEnd, dataVersion, mounted])

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
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef(0)
  // Column the cursor is currently over (defaults to lane center). Pan lag radiates from here.
  const cursorColRef = useRef((RIPPLE_COLS - 1) / 2)
  const reducedRef = useRef(false)
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
  const paintRipple = useCallback(() => {
    const off = offsetRef.current
    for (const el of rippleNodesRef.current.values()) {
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
      // Fixed-size substeps keep the stiff spring stable regardless of frame length.
      const steps = Math.max(1, Math.ceil(dt / 0.008))
      const h = dt / steps
      let active = false
      for (let c = 0; c < RIPPLE_COLS; c++) {
        let x = off[c]
        let v = vel[c]
        if (x === 0 && v === 0) continue
        for (let s = 0; s < steps; s++) {
          const a = -RIPPLE_STIFFNESS * x - RIPPLE_DAMPING * v
          v += a * h
          x += v * h
        }
        if (Math.abs(x) < RIPPLE_REST && Math.abs(v) < RIPPLE_REST) {
          x = 0
          v = 0
        } else {
          active = true
        }
        off[c] = x
        vel[c] = v
      }
      paintRipple()
      if (active) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        rafRef.current = null
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
  // dragging left reveals later time. Each notch also feeds the ripple (content moves
  // LEFT by `delta`, so the injected shift is −delta).
  useEffect(() => {
    const lane = laneRef.current
    if (!lane) return
    const onWheel = (e: WheelEvent) => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (delta === 0) return
      e.preventDefault()
      const w = lane.clientWidth || 1
      cursorColRef.current = pctToCol(e.clientX)
      injectPan(-delta)
      setViewStart((vs) => vs + (delta / w) * DAY_MS)
    }
    lane.addEventListener("wheel", onWheel, { passive: false })
    return () => lane.removeEventListener("wheel", onWheel)
  }, [pctToCol, injectPan])

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
    <div
      className="pointer-events-none relative z-30 flex w-full items-center px-5"
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

        {/* NOW marker — a thin, bright-orange vertical tick (discrete but visible),
            painted above every item. Small triangular caps sit just INSIDE the lane at
            the top and bottom edges, pointing inward, mirroring the timeline's now-marker
            so the live-time indicator reads identically on both. Gated on `mounted`: its
            position is time-derived, so it must not render on the server (would mismatch
            the client's clock). Also hidden when panned out of view (`nowInView`) so it
            doesn't spill past the overflow-visible lane into the header. Wrapped in a
            ripple node so it rides the same catch-up wave as the content around it. */}
        {mounted && nowInView && (
          <div
            aria-hidden
            ref={registerRipple("__now__")}
            data-col={nowCol}
            className="pointer-events-none absolute inset-0 z-30 will-change-transform"
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
