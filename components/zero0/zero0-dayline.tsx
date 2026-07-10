"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { getSegments, useActivityRevision } from "@/lib/zero/activity-log"
import { getEntity, getInheritedAccent, getTimelineOccurrences } from "@/lib/zero/data"
import { titleAt } from "@/lib/zero/entity-log"
import { rangeText, NOW_COLOR } from "@/lib/zero/timeline-format"
import { isSleepTitle, sleepSkyBackground } from "@/lib/zero/sleep-sky"
import { DAYLINE_ROW_H } from "@/lib/zero/layout"
import { useNow } from "@/lib/zero/use-now"
import { cn } from "@/lib/utils"

// ============================================================================
// The ZERO0 DAYLINE — a PRESENCE-ONLY port of the /2 dayline into root `/0`.
// ----------------------------------------------------------------------------
// This vendors the /2 dayline's *fluid* machinery VERBATIM — the ripple pan
// (coupled critically-damped spring chain), wheel/trackpad momentum glide, and
// the live NOW marker — but strips it to what root actually has: the PRESENCE
// band ("where I was"), fed by root's ISOLATED activity log (`zero:root-activity:v1`).
//
// Now carries BOTH tracks: PLANNED occurrences (recurrence-expanded, accent-colored,
// with sleep-titled moments painting the procedural /0 night sky) AND the PRESENCE
// band. Deliberately DROPPED from the /2 version (zero0 stays dep-free): the GSAP
// `useZeroNav().open` morph launcher and the GSAP `NodeGlyph`. Opening a bar calls
// the `onOpen` prop
// (zero0's `navigateTo`, which drills the canvas into that place); the hover
// tooltip shows the title the place had AT that time (`titleAt` fold), matching
// the rest of the root activity tracker.
//
// The ripple TUNING below is copied from the /2 dayline and is specific to this
// lane's width/density — do not blind-copy elsewhere without re-tuning.
// ============================================================================

const DAY_MS = 86_400_000
// The day "bucket" runs 5am→5am so a normal day (and its late-evening items)
// land inside one window instead of being split at midnight.
const DAY_START_HOUR = 5
const NEUTRAL = "oklch(0.72 0.004 75)"
// Sentinel color marking the COLORLESS ROOT place (the root Individual with no accent
// and no colored ancestor). It's never painted as a fill — at render it maps to a
// transparent tick + grey hairline (a quiet outline). Kept distinct so render detects it.
const DEFAULT_PRESENCE = "#ffffff"

/**
 * Resolve the two colors a dayline tick paints, shared by BOTH tracks (planned +
 * presence):
 *   • `fill`   — the entity's OWN color: its `accent` (`:color:`), else the nearest
 *                ancestor SPACE accent, else neutral grey. The root uses the
 *                DEFAULT_PRESENCE sentinel (→ transparent fill at render). A sleep span
 *                paints its night-sky OVER this fill (handled at the call site).
 *   • `stroke` — the HAIRLINE, shown only when the entity sits inside at least one
 *                Space ancestor: it takes the PARENT's resolved color (parent accent,
 *                else the parent's inherited space accent), else neutral grey when no
 *                ancestor is colored. The ROOT keeps its grey hairline as a special case;
 *                a top-level entity directly under the Individual (no Space ancestor) has
 *                no hairline (`null`).
 * `getInheritedAccent` walks SPACE accents from the given node UPWARD (skipping the node
 * itself), which is exactly "the parent's resolved color" when seeded with the parent.
 */
function paintFor(entityId: string): { fill: string; stroke: string | null } {
  const e = getEntity(entityId)
  const isRoot = entityId === "s_root"
  const own = e?.accent ?? getInheritedAccent(e?.parentId ?? null)
  const fill = own ?? (isRoot ? DEFAULT_PRESENCE : NEUTRAL)

  // Walk ancestors (from the parent up) to (a) detect a Space container and (b) resolve
  // the parent's display color for the hairline.
  const parent = e?.parentId ? getEntity(e.parentId) : undefined
  const parentColor = parent ? (parent.accent ?? getInheritedAccent(parent.parentId)) : undefined
  let cursor = parent
  let inSpace = false
  while (cursor) {
    if (cursor.kind === "space") {
      inSpace = true
      break
    }
    cursor = cursor.parentId ? getEntity(cursor.parentId) : undefined
  }

  const stroke = isRoot ? NEUTRAL : inSpace ? (parentColor ?? NEUTRAL) : null
  return { fill, stroke }
}

// --- Ripple tuning (copied verbatim from the /2 dayline) ---------------------
const RIPPLE_COLS = 32
const RIPPLE_STIFFNESS = 20
const RIPPLE_DAMPING = 2 * Math.sqrt(RIPPLE_STIFFNESS)
const RIPPLE_COUPLING = 600
const RIPPLE_LAG = 0.99
const RIPPLE_GAIN = 1.2
const RIPPLE_FALLOFF = 0.5
const RIPPLE_MAX_OFFSET = 320

// --- Wheel / trackpad momentum (copied verbatim) -----------------------------
const WHEEL_PAN_SENSITIVITY = 0.42
const TRACKPAD_PAN_SENSITIVITY = 1.0
const WHEEL_NOTCH_MIN_PX = 50
const WHEEL_FRICTION_TAU = 0.19
const WHEEL_STOP_V = 14
const WHEEL_FLUSH_FRAC = 0.35
const RIPPLE_REST = 0.4
const RENDER_MARGIN_MS = DAY_MS * 1.5

/** [start,end) of the 5am→5am window containing `now`. */
function dayWindow(now: number): [number, number] {
  const d = new Date(now)
  d.setHours(DAY_START_HOUR, 0, 0, 0)
  let start = d.getTime()
  if (now < start) start -= DAY_MS // before 5am → the window opened at yesterday's 5am
  return [start, start + DAY_MS]
}

// A bar on the lane. Two TRACKS share one geometry/hover model:
//  • "planned"  — a SCHEDULED occurrence (moment/instant/scheduled space) from the
//    real entity graph, COLORED by the entity's `accent` (set via `:color:`), else an
//    inherited space accent, else neutral. This is the "intent".
//  • "presence" — a TRACKED activity segment ("where I actually was"), drawn as a
//    PURE-WHITE hairline tick along the bottom edge. This is "what happened".
interface DaylineBar {
  key: string
  id: string
  title: string
  /** The tick's FILL — the entity's own resolved color (see {@link paintFor}). */
  color: string
  /**
   * The tick's HAIRLINE color, or `null` for no outline. Set (to the parent's color)
   * only when the entity sits inside a Space; the root keeps a grey hairline.
   */
  stroke: string | null
  leftPct: number
  widthPct: number
  centerPct: number
  range: string
  track: "planned" | "presence"
  /** A single-point occurrence (instant / zero-length) renders as a thin tick. */
  point: boolean
  /**
   * A presence segment that is still OPEN (`leftAt === null`) — its right edge IS
   * "now". Rendered anchored to its right edge (growing leftward) so its min-width
   * never spills a tick PAST the NOW marker.
   */
  openEnded?: boolean
  /**
   * For a sleep-titled planned Moment: a procedural night-sky CSS `background`
   * string (see {@link sleepSkyBackground}) painted INSTEAD of the flat accent, so
   * a night's sleep reads as a tiny starfield. Absent for every other bar.
   */
  sky?: string
}

/**
 * Root `/0` dayline. Renders PLANNED scheduled occurrences (colored) and TRACKED
 * presence (white ticks) on one fluid, pannable lane. `onOpen(id)` drills the canvas
 * into an entity when its bar is tapped (guarded against pans by `draggedRef`).
 * `dataRev` is the canvas's mutation counter — bumping it re-derives the planned bars
 * after a `:color:` / `:start:` / create edit.
 */
export function Zero0Dayline({
  onOpen,
  dataRev,
  tracks = "planned",
  trailing,
}: {
  onOpen: (id: string) => void
  dataRev: number
  /** Which lane this instance paints. The main "dayline · today" shows PLANNED
   *  (scheduled occurrences); the presence lane ("where I was") is split off into its
   *  own instance inside the Activity frame so the two no longer share a band. */
  tracks?: "planned" | "presence"
  /** Optional node rendered in the header next to the label (e.g. the presence lane's
   *  "3h 56m tracked" total). */
  trailing?: ReactNode
}) {
  const isPresence = tracks === "presence"
  const now = useNow()
  const [mounted, setMounted] = useState(false)
  // `viewStart` is the left edge of the shown 24h window. Panning moves it directly;
  // the auto-shift advances it on a time boundary. Independent of `now`.
  const [viewStart, setViewStart] = useState(0)
  const prevNowRef = useRef(0)
  useEffect(() => {
    const n = Date.now()
    setMounted(true)
    setViewStart(dayWindow(n)[0])
    prevNowRef.current = n
  }, [])

  // AUTO-SHIFT — fires ONLY on a `now` transition (never on `viewStart`, so panning
  // can't trigger it). When time carries `now` past the window's right edge, jump to
  // the natural 24h window containing `now`, landing the marker at the left edge.
  useEffect(() => {
    if (!mounted) return
    const prev = prevNowRef.current
    prevNowRef.current = now
    setViewStart((vs) => {
      const viewEnd = vs + DAY_MS
      return prev < viewEnd && now >= viewEnd ? dayWindow(now)[0] : vs
    })
  }, [now, mounted])

  const winStart = viewStart

  // Hover key for ANY bar (planned or presence) — drives its tooltip + highlight.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  // Hover state for the NOW marker's time tooltip.
  const [nowHover, setNowHover] = useState(false)
  // A per-SECOND clock, live ONLY while the NOW marker is hovered, so the marker's
  // tooltip can tick seconds without the whole app running a 1s interval (`useNow`
  // is per-minute). Idle otherwise.
  const [nowSec, setNowSec] = useState(() => Date.now())
  useEffect(() => {
    if (!nowHover) return
    setNowSec(Date.now())
    const id = setInterval(() => setNowSec(Date.now()), 1000)
    return () => clearInterval(id)
  }, [nowHover])

  const lo = winStart - RENDER_MARGIN_MS
  const hi = winStart + DAY_MS + RENDER_MARGIN_MS

  // PLANNED bars — SCHEDULED occurrences from the real entity graph (whole tree from
  // s_root), expanded across the window by the recurrence engine. Colored by the
  // entity's own `accent` (set via `:color:`), else an inherited space accent, else
  // neutral. `dataRev` re-derives after a create / `:color:` / `:start:` edit; `now`
  // is only a dep so a point exactly at "now" stays consistent with the marker.
  const planned = useMemo<DaylineBar[]>(() => {
    if (!mounted) return []
    const out: DaylineBar[] = []
    for (const occ of getTimelineOccurrences("s_root", lo, hi)) {
      const s = occ.schedule
      if (!s) continue
      // start / point / due — a due-only task anchors on its deadline and paints a point.
      const st = s.startAt ?? s.at ?? s.dueAt
      if (st == null) continue
      const en = s.endAt ?? st // a point (instant / due / no end) has zero span
      if (en < lo || st > hi) continue
      const leftPct = ((st - winStart) / DAY_MS) * 100
      const widthPct = ((en - st) / DAY_MS) * 100
      // A sleep-titled DURATION moment paints a procedural night sky instead of a
      // flat accent bar (seeded per-occurrence so it's stable yet unique per night).
      const isSleepSpan = en > st && occ.kind === "moment" && isSleepTitle(occ.title)
      // fill = the occurrence's own color; stroke = its parent's color (only inside a Space).
      const { fill, stroke } = paintFor(occ.id)
      out.push({
        key: `plan:${occ.occKey}`,
        id: occ.id,
        title: occ.title,
        color: fill,
        stroke,
        leftPct,
        widthPct,
        centerPct: leftPct + widthPct / 2,
        range: rangeText(st, en, s.repeat),
        track: "planned",
        point: en <= st,
        sky: isSleepSpan ? sleepSkyBackground(occ.occKey) : undefined,
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winStart, lo, hi, now, mounted, dataRev])

  // PRESENCE bars — tracked activity ("where I was"). Titles fold `titleAt` so a past
  // segment reads with the name the place had THEN. `useActivityRevision()` re-derives
  // on any log change; `now` grows the open segment + keeps it in step with the marker.
  const activityRevision = useActivityRevision()
  const presence = useMemo<DaylineBar[]>(() => {
    if (!mounted) return []
    const nowMs = now
    const out: DaylineBar[] = []
    for (const s of getSegments()) {
      const st = s.enteredAt
      const en = s.leftAt ?? nowMs
      if (en <= st) continue // zero/negative width — skip
      if (en < lo || st > hi) continue // fully outside the buffered window
      const leftPct = ((st - winStart) / DAY_MS) * 100
      const widthPct = ((en - st) / DAY_MS) * 100
      const entity = getEntity(s.entityId)
      // Same paint model as the planned bar: fill = the place's own color, stroke = its
      // parent's color (a hairline, only when the place sits inside a Space).
      const { fill, stroke } = paintFor(s.entityId)
      out.push({
        key: `pres:${s.entityId}:${s.enteredAt}`,
        id: s.entityId,
        // Historical title — the name the place carried at the segment's start.
        title: entity ? titleAt(entity, st) : s.entityId === "s_root" ? "Home" : "Elsewhere",
        color: fill,
        stroke,
        leftPct,
        widthPct,
        centerPct: leftPct + widthPct / 2,
        range: rangeText(st, en),
        track: "presence",
        point: false,
        openEnded: s.leftAt == null,
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winStart, lo, hi, now, mounted, activityRevision])

  // One lookup for the hovered bar's tooltip, across both tracks.
  const byKey = useMemo(() => {
    const m = new Map<string, DaylineBar>()
    for (const b of planned) m.set(b.key, b)
    for (const b of presence) m.set(b.key, b)
    return m
  }, [planned, presence])
  const hovered = hoveredKey ? byKey.get(hoveredKey) ?? null : null

  // NOW marker position within the shown window; off-screen (outside 0–100) when panned.
  const nowPct = ((now - winStart) / DAY_MS) * 100
  const nowInView = nowPct >= 0 && nowPct <= 100

  // ==========================================================================
  // RIPPLE — per-column critically-damped springs, driven imperatively.
  // (Machinery copied verbatim from the /2 dayline.)
  // ==========================================================================
  const laneRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef<Float64Array>(new Float64Array(RIPPLE_COLS))
  const velRef = useRef<Float64Array>(new Float64Array(RIPPLE_COLS))
  const prevXRef = useRef<Float64Array>(new Float64Array(RIPPLE_COLS))
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef(0)
  const cursorColRef = useRef((RIPPLE_COLS - 1) / 2)
  const reducedRef = useRef(false)
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const pointerInsideRef = useRef(false)
  const wheelVelRef = useRef(0)
  const wheelRafRef = useRef<number | null>(null)
  const wheelTsRef = useRef(0)
  const wheelCommitRef = useRef(0)
  const pendingFlushRef = useRef(0)
  // Base pan applied imperatively to both the presence CONTENT (inside the fixed clip)
  // and the NOW marker + presence tooltip (which live outside the clip for edge bleed).
  const contentPanRef = useRef<HTMLDivElement>(null)
  const markerPanRef = useRef<HTMLDivElement>(null)
  const presTooltipPanRef = useRef<HTMLDivElement>(null)
  const applyPan = useCallback((px: number) => {
    const t = px ? `translateX(${px}px)` : ""
    if (contentPanRef.current) contentPanRef.current.style.transform = t
    if (markerPanRef.current) markerPanRef.current.style.transform = t
    if (presTooltipPanRef.current) presTooltipPanRef.current.style.transform = t
  }, [])
  const flushAtRestRef = useRef<() => void>(() => {})
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

  // Re-resolve which PRESENCE bar sits under the (possibly stationary) cursor and sync
  // `presHovered`. Called each pan frame: bars slide by transform, so the DOM's own hover
  // doesn't fire — we hit-test the real pixel under the cursor. No-ops (no re-render) when
  // the bar under the cursor is unchanged, so it's cheap to call every frame.
  const resolveHoverAtCursor = useCallback(() => {
    if (!pointerInsideRef.current) return
    const { x, y } = lastPointerRef.current
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const bar = el?.closest("[data-barkey]") as HTMLElement | null
    const key = bar?.getAttribute("data-barkey") ?? null
    setHoveredKey((h) => (h === key ? h : key))
  }, [])

  const paintRipple = useCallback(() => {
    const off = offsetRef.current
    const maxCol = RIPPLE_COLS - 1
    const lane = laneRef.current
    const w = lane ? lane.clientWidth || 1 : 1
    const baseFrac = -wheelCommitRef.current / w
    for (const el of rippleNodesRef.current.values()) {
      const left = +(el.dataset.left ?? "") || 0
      const frac = left / 100 + baseFrac
      if (frac < -0.4 || frac > 1.4) {
        if (el.style.transform) el.style.transform = ""
        continue
      }
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
      const steps = Math.max(1, Math.ceil(dt / 0.008))
      const h = dt / steps
      const prev = prevXRef.current
      for (let s = 0; s < steps; s++) {
        for (let c = 0; c < RIPPLE_COLS; c++) prev[c] = off[c]
        for (let c = 0; c < RIPPLE_COLS; c++) {
          const x = prev[c]
          const v = vel[c]
          const xl = c > 0 ? prev[c - 1] : x
          const xr = c < RIPPLE_COLS - 1 ? prev[c + 1] : x
          const a = RIPPLE_COUPLING * (xl + xr - 2 * x) - RIPPLE_STIFFNESS * x - RIPPLE_DAMPING * v
          const nv = v + a * h
          vel[c] = nv
          off[c] = x + nv * h
        }
      }
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

  const injectPan = useCallback(
    (shiftPx: number) => {
      if (reducedRef.current || shiftPx === 0) return
      const off = offsetRef.current
      const cc = cursorColRef.current
      const maxDist = Math.max(cc, RIPPLE_COLS - 1 - cc, 1)
      for (let c = 0; c < RIPPLE_COLS; c++) {
        const dist = Math.abs(c - cc) / maxDist
        const hold = Math.min(1, RIPPLE_LAG * Math.pow(dist, RIPPLE_FALLOFF) * RIPPLE_GAIN)
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
  const draggedRef = useRef(false)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      draggedRef.current = false
      dragRef.current = { startX: e.clientX, startView: viewStart, lastX: e.clientX }
      cursorColRef.current = pctToCol(e.clientX)
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      pointerInsideRef.current = true
    },
    [viewStart, pctToCol],
  )
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current
      const lane = laneRef.current
      cursorColRef.current = pctToCol(e.clientX)
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      pointerInsideRef.current = true
      if (!d || !lane) return
      const w = lane.clientWidth || 1
      const dx = e.clientX - d.startX
      if (Math.abs(dx) > 3 && !draggedRef.current) {
        draggedRef.current = true
        laneRef.current?.setPointerCapture(e.pointerId)
      }
      const inc = e.clientX - d.lastX
      d.lastX = e.clientX
      injectPan(inc)
      setViewStart(d.startView - (dx / w) * DAY_MS)
      resolveHoverAtCursor()
    },
    [pctToCol, injectPan, resolveHoverAtCursor],
  )
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null
    if (laneRef.current?.hasPointerCapture(e.pointerId)) laneRef.current.releasePointerCapture(e.pointerId)
  }, [])
  const recenter = useCallback(() => setViewStart(dayWindow(Date.now())[0]), [])

  const flushWheelPan = useCallback(() => {
    const lane = laneRef.current
    if (!lane) return
    if (pendingFlushRef.current !== 0) return
    const commit = wheelCommitRef.current
    if (!commit) return
    const w = lane.clientWidth || 1
    pendingFlushRef.current = commit
    setViewStart((vs) => vs + (commit / w) * DAY_MS)
  }, [])

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
      const dt = wheelTsRef.current ? Math.min((ts - wheelTsRef.current) / 1000, 0.05) : 1 / 60
      wheelTsRef.current = ts
      const vel = wheelVelRef.current
      const slice = vel * dt
      wheelVelRef.current = vel * Math.exp(-dt / WHEEL_FRICTION_TAU)
      wheelCommitRef.current += slice
      applyPan(-wheelCommitRef.current)
      injectPan(-slice)
      resolveHoverAtCursor()
      if (Math.abs(wheelCommitRef.current) > w * WHEEL_FLUSH_FRAC) flushWheelPan()
      if (Math.abs(wheelVelRef.current) > WHEEL_STOP_V) {
        wheelRafRef.current = requestAnimationFrame(glide)
      } else {
        wheelVelRef.current = 0
        wheelTsRef.current = 0
        wheelRafRef.current = null
        maybeFlushAtRest()
      }
    }

    const onWheel = (e: WheelEvent) => {
      let delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (delta === 0) return
      e.preventDefault()
      const isMouseWheel = e.deltaMode !== 0 || Math.abs(delta) >= WHEEL_NOTCH_MIN_PX
      if (e.deltaMode === 1) delta *= 16
      else if (e.deltaMode === 2) delta *= lane.clientWidth || 1
      delta *= isMouseWheel ? WHEEL_PAN_SENSITIVITY : TRACKPAD_PAN_SENSITIVITY
      cursorColRef.current = pctToCol(e.clientX)
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      pointerInsideRef.current = true
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

  useLayoutEffect(() => {
    if (pendingFlushRef.current !== 0) {
      wheelCommitRef.current -= pendingFlushRef.current
      pendingFlushRef.current = 0
    }
    applyPan(-wheelCommitRef.current)
  }, [viewStart, applyPan])

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // Short "FRI JUL 10" formatter for day-boundary labels + the header's left-edge tag.
  // Commas are stripped so the label reads as a clean uppercase triple (some locales
  // render "Fri, Jul 10").
  const shortDay = useCallback(
    (epoch: number) =>
      new Date(epoch)
        .toLocaleDateString(undefined, { weekday: "short", month: "short", day: "2-digit" })
        .replace(/,/g, "")
        .toUpperCase(),
    [],
  )

  // The PLANNED (AGENDA/"TODAY") lane's header slot now shows — faded — the day currently
  // in view at the LEFT-MOST extremity of the band (its `winStart` 5am bucket), in the
  // same short "FRI JUL 10" format as the on-band day markers. It updates as panning
  // settles the window. The live full date+time moved to the glued-top clock; the
  // presence lane keeps its `trailing` "x tracked" total instead.
  const leftEdgeDay = mounted && !isPresence ? shortDay(winStart) : null

  // DAY-BOUNDARY MARKERS (planned lane only) — one per MIDNIGHT across the buffered window.
  // (The band's visible window is Zero's 5am–5am design choice, but the markers themselves
  // sit at true local midnight, so a day label lands on the calendar-date boundary.) Each
  // rides INSIDE the content-pan layer (registered as a ripple node with its `data-left`),
  // so it pans/ripples/clips exactly like a bar: scrolling slides the labels along the band
  // and the left-most one clips off the lane's left edge. A 1px faded grey line marks the
  // boundary; the short date label sits at the TOP, flush-right of the line (labelling the
  // day that starts there). The ACTIVITY presence lane is intentionally left plain for now.
  const dayMarkers = useMemo(() => {
    if (!mounted || isPresence) return [] as { key: string; leftPct: number; label: string }[]
    const out: { key: string; leftPct: number; label: string }[] = []
    const firstMidnight = new Date(lo)
    firstMidnight.setHours(0, 0, 0, 0)
    for (let t = firstMidnight.getTime(); t <= hi; t += DAY_MS) {
      out.push({ key: `day:${t}`, leftPct: ((t - winStart) / DAY_MS) * 100, label: shortDay(t) })
    }
    return out
  }, [mounted, isPresence, lo, hi, winStart, shortDay])

  return (
    <div
      className={cn(
        "px-4 pt-3",
        // The presence instance flows straight into its tracked list below, so it drops
        // the bottom divider + bottom padding; the planned instance keeps both.
        isPresence ? "pb-1" : "border-b border-border pb-3",
      )}
    >
      {/* Controls row — both slots are FADED. The PLANNED lane shows the day at the
          band's left-most edge ("FRI JUL 10", short) which updates as you pan; the
          PRESENCE lane shows its "x tracked" total. The recenter "now" button sits on
          the right. (The live full date+time now lives in the glued-top clock.) */}
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground/60">
        {isPresence ? <span>{trailing}</span> : <span>{leftEdgeDay}</span>}
        <button
          type="button"
          onClick={recenter}
          className="normal-case text-muted-foreground/60 transition-colors hover:text-foreground"
          aria-label="Recenter dayline on now"
        >
          now
        </button>
      </div>
      {/* Constant-height lane row. */}
      <div className="relative" style={{ height: DAYLINE_ROW_H }}>
        <div
          ref={laneRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onMouseEnter={() => (pointerInsideRef.current = true)}
          onMouseLeave={() => (pointerInsideRef.current = false)}
          onDoubleClick={recenter}
          className="relative h-7 w-full cursor-default select-none overflow-visible rounded-md border border-border/60 bg-card/40 [touch-action:none]"
        >
          {/* CLIP layer — fixed to the lane so it always trims to the true bounds. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
            {/* CONTENT PAN — the in-progress wheel pan is applied here as an imperative
                translateX; the bars slide within the fixed clip window. PLANNED bars
                (colored) sit in the main body; PRESENCE (white ticks) lines the bottom. */}
            <div ref={contentPanRef} className="pointer-events-none absolute inset-0 will-change-transform">
              {/* DAY-BOUNDARY MARKERS (planned lane) — painted BEHIND the ticks. Each is a
                  ripple node (data-left + registerRipple) so it pans/slides/clips with the
                  band: a 1px faded grey line at the 5am boundary + the short date label just
                  to its right, labelling the day that begins there. */}
              {dayMarkers.map((dm) => (
                <div
                  key={dm.key}
                  ref={registerRipple(dm.key)}
                  data-left={dm.leftPct}
                  className="pointer-events-none absolute inset-0 will-change-transform"
                >
                  <div className="absolute inset-y-0" style={{ left: `${dm.leftPct}%`, zIndex: 2 }}>
                    <div className="absolute inset-y-0 w-px bg-muted-foreground/25" />
                    <span className="absolute left-px top-0.5 whitespace-nowrap text-[8px] uppercase leading-none tracking-wider text-muted-foreground/50">
                      {dm.label}
                    </span>
                  </div>
                </div>
              ))}
              {/* TICK BAND — ONE generic loop for BOTH tracks. Each instance paints its
                  own list (`planned` scheduled occurrences OR `presence` tracked segments),
                  but the rendering is identical: a rounded chip (or a thin point for a
                  zero-length occurrence) whose FILL is the entity color (sleep paints a
                  night-sky, root → transparent) and whose HAIRLINE is the parent color.
                  The ONLY per-track difference is vertical alignment: PLANNED rides the
                  TOP of the lane, TRACKED is vertically CENTERED. */}
              {mounted &&
                (isPresence ? presence : planned).map((p) => {
                  const isHot = hoveredKey === p.key
                  return (
                    <div
                      key={p.key}
                      ref={registerRipple(p.key)}
                      data-left={p.leftPct}
                      className="pointer-events-none absolute inset-0 will-change-transform"
                    >
                      <button
                        type="button"
                        data-barkey={p.key}
                        aria-label={isPresence ? `Was in ${p.title}, ${p.range}` : `${p.title}, ${p.range}`}
                        onMouseEnter={() => setHoveredKey(p.key)}
                        onMouseLeave={() => setHoveredKey((h) => (h === p.key ? null : h))}
                        onClick={() => {
                          if (draggedRef.current) return // a pan, not a tap
                          onOpen(p.id)
                        }}
                        className={cn(
                          "pointer-events-auto absolute cursor-default transition-[height,opacity] duration-150",
                          // Vertical alignment is the sole per-track difference: PLANNED
                          // hugs the TOP of the lane; TRACKED is CENTERED (top-1/2 + the
                          // -translate-y-1/2 below), so the two bands read distinctly.
                          isPresence ? "top-1/2" : "top-[3px]",
                          p.point ? "rounded-full" : "rounded-[2px]",
                          // Translate composes: X for a point / open-ended segment, Y to
                          // center a tracked bar. Tailwind's translate utilities stack.
                          p.point && "-translate-x-1/2",
                          p.openEnded && "-translate-x-full",
                          isPresence && "-translate-y-1/2",
                        )}
                        style={{
                          left: p.openEnded ? `${p.leftPct + p.widthPct}%` : `${p.leftPct}%`,
                          // All ticks share ONE height across both tracks; sleep spans no
                          // longer grow taller — the starfield fills the standard band.
                          width: p.point ? 2 : `max(3px, ${p.widthPct}%)`,
                          height: isHot ? 13 : 9,
                          // FILL = entity color (sleep → night sky; root sentinel →
                          // transparent). HAIRLINE = parent color, only inside a Space.
                          background: p.color === DEFAULT_PRESENCE ? "transparent" : (p.sky ?? p.color),
                          border: p.stroke ? `1px solid ${p.stroke}` : "none",
                          // Both tracks read as a faint layer; hovering one snaps to full.
                          opacity: isHot ? 1 : 0.4,
                          zIndex: isHot ? 16 : 8,
                        }}
                      />
                    </div>
                  )
                })}
            </div>
          </div>

          {/* NOW marker — a thin bright vertical tick, painted above the bars. Hidden
              when panned out of view. Rides the same catch-up wave as the content. */}
          {mounted && nowInView && (
            <div ref={markerPanRef} className="pointer-events-none absolute inset-0 z-30 will-change-transform">
              <div
                aria-hidden
                ref={registerRipple("__now__")}
                data-left={nowPct}
                className="pointer-events-none absolute inset-0 will-change-transform"
              >
                <div
                  className="pointer-events-auto absolute -bottom-px -top-px w-px -translate-x-1/2"
                  style={{ left: `${nowPct}%`, backgroundColor: NOW_COLOR }}
                >
                  <span
                    // Narrow hit strip hugging the marker LINE only (was w-4/16px, which
                    // overhung nearby ticks and stole their hover). ~6px keeps the marker
                    // easy to hover without blanketing adjacent presence/planned ticks.
                    className="absolute -bottom-1 -top-1 left-1/2 w-1.5 -translate-x-1/2 cursor-default"
                    onMouseEnter={() => setNowHover(true)}
                    onMouseLeave={() => setNowHover(false)}
                  />
                  <span
                    className={cn(
                      // Float ABOVE the marker (its bottom edge sits just over the
                      // marker's top) instead of superposed on the line.
                      "pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded border border-border/70 bg-card px-2 py-1 text-[10.5px] font-medium leading-none tracking-tight tabular-nums text-foreground/80 shadow-sm transition-opacity duration-150",
                      // A hovered BAR always wins: suppress the NOW tooltip so a tick near
                      // the marker shows its own tooltip instead of the clock.
                      nowHover && !hovered ? "opacity-100" : "opacity-0",
                    )}
                  >
                    {new Date(nowHover ? nowSec : now).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    })}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* HOVER HELPER — floats just below the lane for the hovered bar (either
              track): a color chip + title + clock range. Presence reads "in {title}"
              (the historical name); planned reads just the title. Rides the same
              two-layer pan-follow as everything else. */}
          {hovered && (
            <div ref={presTooltipPanRef} className="pointer-events-none absolute inset-0 z-40 will-change-transform">
              <div
                ref={registerRipple("__prestooltip__")}
                data-left={hovered.leftPct}
                className="pointer-events-none absolute inset-0 will-change-transform"
              >
                <div
                  className="pointer-events-none absolute top-full flex max-w-[40vw] -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded border border-border/70 bg-card px-2 py-1 text-[10.5px] font-medium leading-none tracking-tight text-foreground/80 shadow-sm"
                  style={{ left: `${Math.min(96, Math.max(4, hovered.centerPct))}%`, marginTop: 4 }}
                >
                  <span
                    aria-hidden
            className="h-2 w-2 shrink-0 rounded-full border"
            style={{
              backgroundColor: hovered.color === DEFAULT_PRESENCE ? "transparent" : hovered.color,
              borderColor: hovered.stroke ?? "var(--border)",
            }}
                  />
                  {hovered.track === "presence" && <span className="shrink-0 text-muted-foreground">in</span>}
                  <span className="truncate text-foreground">{hovered.title}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">{hovered.range}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
