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
// PAN + AUTO-SHIFT (linear, no zoom) + RIPPLE:
//   • Drag the lane or scroll to pan its 24h window through time. Double-click
//     recenters on the live "now" window.
//   • RIPPLE (see the "Ripple pan" section below): a pan doesn't move every item
//     rigidly — items UNDER the cursor track the pan tightly (move first / fastest),
//     while items further away lag and then elastically catch up, like the lane were
//     an elastic sheet pinned under the cursor. Purely visual (per-item transform);
//     the committed window (`viewStart`) is unaffected, so time math never drifts.
//   • The NOW marker sits at the true time position within the shown window and
//     advances minute by minute, sliding off-screen when you pan away.
//   • AUTO-SHIFT: when the marker reaches the RIGHT edge *on its own* — i.e. time (not a
//     pan) carries `now` past the window end — the lane jumps forward one natural 24h
//     window, landing the marker back at the LEFT edge. Un-panned, that boundary is 5am
//     daily. A pan that pushes the marker past the edge does NOT trigger this; only a
//     time transition does.
//
// The timeline⇄dayline MORPH is intentionally NOT here yet.
// ============================================================================

const DAY_MS = 86_400_000
// The day "bucket" runs 5am→5am so a normal day (and its late-evening items)
// land inside one window instead of being split at midnight.
const DAY_START_HOUR = 5
const NEUTRAL = "oklch(0.72 0.004 75)"

// --- Ripple pan tunables ----------------------------------------------------
// The ripple is a per-item spring: each pan injects a LAG offset (px) into every
// item that OPPOSES the pan — near-cursor items get ~none (they track the pan and so
// appear to "lead"), far items get up to LAG_MAX of the pan delta — then a spring
// eases every offset back to 0, so the far items catch up (with a touch of elastic
// overshoot). Everything runs in refs + one rAF loop (no per-frame React state), and
// the whole effect is disabled under prefers-reduced-motion.
const LAG_MAX = 0.9 // far-from-cursor items lag by up to this fraction of a pan step
const LAG_SPREAD = 0.55 // normalized cursor-distance (in lane widths) over which lag ramps 0→MAX
const SPRING_K = 0.12 // catch-up spring stiffness (higher = snappier return)
const SPRING_D = 0.8 // catch-up spring damping (lower = more elastic overshoot)
const LAG_CAP = 160 // px clamp so an item can never rip far from its true position
const NOW_KEY = "__now__" // ripple key for the NOW marker (it rides the ripple too)

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
// Hermite smoothstep — a soft 0→1 ramp used for the cursor-distance falloff.
const smoothstep = (a: number, b: number, x: number) => {
  const t = clampN((x - a) / (b - a || 1), 0, 1)
  return t * t * (3 - 2 * t)
}

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
  // Ripple pan — imperative, ref-driven, one rAF loop, no per-frame re-render.
  // ==========================================================================
  const laneRef = useRef<HTMLDivElement>(null)
  // Per-item spring state: key → { x: current lag px, v: velocity }. Settled entries
  // are deleted so the map stays small (a handful of visible items).
  const lagRef = useRef<Map<string, { x: number; v: number }>>(new Map())
  // key → the element whose `transform` we drive (the item/marker's outer wrapper).
  const wrapRef = useRef<Map<string, HTMLElement>>(new Map())
  // key → centerPct (0–100) of every rippleable thing this render (items + NOW marker),
  // rebuilt below each render so injection knows each item's screen position + distance.
  const centerRef = useRef<Map<string, number>>(new Map())
  const cursorLaneXRef = useRef(0) // cursor x within the lane (px)
  const laneWidthRef = useRef(1)
  const rafRef = useRef<number | null>(null)
  const reducedRef = useRef(false)

  useEffect(() => {
    reducedRef.current =
      typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  }, [])

  // Ref callback factory: register/unregister an element's wrapper by ripple key.
  const setWrap = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) wrapRef.current.set(key, el)
      else wrapRef.current.delete(key)
    },
    [],
  )

  // The catch-up loop: spring every lag offset toward 0, writing it as a translateX on
  // each wrapper. Self-stops once all offsets settle (and prunes them). The wrappers'
  // `transform` is driven ONLY here (never via React style), so a viewStart re-render
  // updating `left`/`width` never clobbers the in-flight ripple.
  const frame = useCallback(() => {
    const lags = lagRef.current
    let active = false
    lags.forEach((rec, key) => {
      rec.v += -SPRING_K * rec.x
      rec.v *= SPRING_D
      rec.x += rec.v
      if (Math.abs(rec.x) < 0.05 && Math.abs(rec.v) < 0.05) {
        // Settled — snap home, clear the transform, and drop the entry.
        const el = wrapRef.current.get(key)
        if (el) el.style.transform = ""
        lags.delete(key)
      } else {
        active = true
        const el = wrapRef.current.get(key)
        if (el) el.style.transform = `translateX(${rec.x.toFixed(2)}px)`
      }
    })
    rafRef.current = active ? requestAnimationFrame(frame) : null
  }, [])

  const ensureLoop = useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(frame)
  }, [frame])

  // Cache lane geometry + cursor position from a pointer/wheel event's clientX.
  const syncCursor = useCallback((clientX: number) => {
    const lane = laneRef.current
    if (!lane) return
    const r = lane.getBoundingClientRect()
    laneWidthRef.current = r.width || 1
    cursorLaneXRef.current = clientX - r.left
  }, [])

  // Pan by `deltaView` ms AND inject the ripple. `deltaView>0` slides the window forward
  // (content moves left); we push each item's lag to the RIGHT (opposing the motion) by
  // an amount scaled by its distance from the cursor, so near-cursor items barely lag
  // (lead the pan) and far ones trail, then the spring reels them all back in.
  const panByView = useCallback(
    (deltaView: number) => {
      setViewStart((vs) => vs + deltaView)
      if (reducedRef.current || deltaView === 0) return
      const w = laneWidthRef.current || 1
      const shiftPx = (deltaView / DAY_MS) * w // signed screen px the content moves this step
      const cursorX = cursorLaneXRef.current
      centerRef.current.forEach((centerPct, key) => {
        const screenX = (centerPct / 100) * w
        const dist = Math.abs(screenX - cursorX) / w // in lane widths
        const factor = LAG_MAX * smoothstep(0, LAG_SPREAD, dist)
        if (factor <= 0) return
        const rec = lagRef.current.get(key) ?? { x: 0, v: 0 }
        rec.x = clampN(rec.x + shiftPx * factor, -LAG_CAP, LAG_CAP)
        lagRef.current.set(key, rec)
      })
      ensureLoop()
    },
    [ensureLoop],
  )

  // --- Drag panning (incremental, so each move injects its own ripple step) -------
  const dragRef = useRef<{ startX: number; lastX: number } | null>(null)
  // Set true once a drag passes threshold; suppresses the click that would otherwise
  // fire on pointerup, reset on the next pointerdown.
  const draggedRef = useRef(false)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    draggedRef.current = false
    dragRef.current = { startX: e.clientX, lastX: e.clientX }
    laneRef.current?.setPointerCapture(e.pointerId)
  }, [])
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const w = laneRef.current?.clientWidth || 1
      if (Math.abs(e.clientX - d.startX) > 3) draggedRef.current = true
      const dxInc = e.clientX - d.lastX
      d.lastX = e.clientX
      if (dxInc === 0) return
      syncCursor(e.clientX)
      // Drag right → reveal earlier time (window slides back), and vice-versa.
      panByView(-(dxInc / w) * DAY_MS)
    },
    [panByView, syncCursor],
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
  // (down / right) reveals LATER time, mirroring the drag. Each notch injects a ripple
  // anchored at the pointer (wheel events carry clientX).
  useEffect(() => {
    const lane = laneRef.current
    if (!lane) return
    const onWheel = (e: WheelEvent) => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (delta === 0) return
      e.preventDefault()
      const w = lane.clientWidth || 1
      syncCursor(e.clientX)
      panByView((delta / w) * DAY_MS)
    }
    lane.addEventListener("wheel", onWheel, { passive: false })
    return () => lane.removeEventListener("wheel", onWheel)
  }, [panByView, syncCursor])

  // Cancel the loop on unmount.
  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }, [])

  // Rebuild the center map for THIS render so injection sees current positions. Cheap
  // (a handful of items); done in render (not an effect) so it's ready before any pan.
  const centers = new Map<string, number>()
  for (const it of items) centers.set(it.key, it.centerPct)
  if (mounted && nowInView) centers.set(NOW_KEY, nowPct)
  centerRef.current = centers

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
          Drag to pan (linear, with ripple), double-click to recenter on now.
          `touch-action: none` and `select-none` keep horizontal drags from
          scrolling/selecting. */}
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
            if (it.isDuration) {
              // Wrapper carries left/width + the ripple transform (driven imperatively);
              // the inner bar handles vertical centering, so its translateY never
              // collides with the wrapper's translateX ripple.
              return (
                <div
                  key={it.key}
                  ref={setWrap(it.key)}
                  className="absolute top-0 h-full [will-change:transform]"
                  style={{ left: `${it.leftPct}%`, width: `max(3px, ${it.widthPct}%)` }}
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
                    className="absolute inset-x-0 top-1/2 -translate-y-1/2 cursor-default rounded-[3px] transition-[filter,height] duration-150"
                    style={{
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
            // Instant → a thin solid vertical tick spanning the lane. Wrapper (width 0)
            // sits at leftPct + ripple transform; the inner tick centers on it.
            return (
              <div
                key={it.key}
                ref={setWrap(it.key)}
                className="absolute top-0 h-full [will-change:transform]"
                style={{ left: `${it.leftPct}%` }}
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
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-default rounded-full transition-[filter,height,width] duration-150"
                  style={{
                    left: 0,
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
            painted above every item. A small downward cap at the top edge mirrors the
            timeline's now-marker so the live-time indicator reads identically on both.
            Gated on `mounted`: its position is time-derived, so it must not render on the
            server (would mismatch the client's clock). Also hidden when panned out of view
            (`nowInView`) so it doesn't spill past the overflow-visible lane into the header.
            It rides the ripple too (outer wrapper carries left + the ripple transform). */}
        {mounted && nowInView && (
          <div
            ref={setWrap(NOW_KEY)}
            aria-hidden
            className="pointer-events-none absolute -bottom-px -top-px z-30 [will-change:transform]"
            style={{ left: `${nowPct}%` }}
          >
            <div
              className="pointer-events-auto absolute inset-y-0 w-[2px] -translate-x-1/2 rounded-full"
              style={{ backgroundColor: NOW_COLOR, boxShadow: `0 0 4px ${NOW_COLOR}` }}
            >
              {/* Invisible, wider hit zone so the 2px line is hoverable in practice; it
                  toggles the time pill via React state. */}
              <span
                className="absolute -bottom-1 -top-1 left-1/2 w-4 -translate-x-1/2 cursor-default"
                onMouseEnter={() => setNowHover(true)}
                onMouseLeave={() => setNowHover(false)}
              />
              {/* Downward cap at the top edge. */}
              <span
                className="absolute -top-1 left-1/2 -translate-x-1/2"
                style={{
                  width: 0,
                  height: 0,
                  borderLeft: "3px solid transparent",
                  borderRight: "3px solid transparent",
                  borderTop: `5px solid ${NOW_COLOR}`,
                }}
              />
              {/* Matching upward cap at the bottom edge (mirror of the top triangle). */}
              <span
                className="absolute -bottom-1 left-1/2 -translate-x-1/2"
                style={{
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
