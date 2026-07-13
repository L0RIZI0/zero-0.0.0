"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { getSegments, useActivityRevision } from "@/lib/zero/activity-log"
import { ROOT_ID, getEntity, getInheritedAccent, getTimelineOccurrences } from "@/lib/zero/data"
import { titleAt } from "@/lib/zero/entity-log"
import { rangeText, NOW_COLOR } from "@/lib/zero/timeline-format"
import { isSleepTitle, sleepSkyBackground } from "@/lib/zero/sleep-sky"
import { DAYLINE_ROW_H } from "@/lib/zero/layout"
import { useNow } from "@/lib/zero/use-now"
import { formatLocale } from "@/lib/zero/format-locale"
import { cn } from "@/lib/utils"

/** Horizontal gap (px) between a day label and its 1px boundary marker in the minimized
 *  in-band overlay, so the two never touch. */
const LABEL_MARKER_GAP = 8

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

// Two-row vertical placement (px from the lane's top) for the combined TODAY lane
// (`tracks="both"`). The lane is 28px tall (`h-7`) with 9px ticks: the UPPER row holds
// elapsed planned ticks (4–13px), the LOWER row holds presence + not-yet-elapsed planned
// (15–24px), so a past-planned and a past-presence tick never stack. A planned tick
// animates between the two as `now` crosses its end.
const ROW_TOP_PX = 4
const ROW_BOTTOM_PX = 15
// Elevation glide — long + eased so the rise reads as a deliberate "filed for the day"
// motion, while hover height/opacity stays snappy.
const ROW_TRANSITION = "top 480ms cubic-bezier(0.22, 1, 0.36, 1), height 150ms ease, opacity 150ms ease"

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
  const isRoot = entityId === ROOT_ID
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
   * PLANNED-only: the occurrence's end has passed `now` (and it isn't ongoing) — i.e. it
   * is DONE FOR THE DAY. In the combined TODAY lane (`tracks="both"`) an elapsed planned
   * tick RISES to the upper row so it never sits on top of a presence tick (both are in
   * the past). Recomputed each minute as `now` advances, so a tick animates up smoothly
   * the moment the NOW marker crosses its end. Absent/false = stays on the lower row.
   */
  elapsed?: boolean
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
  onContextMenuEntity,
  dataRev,
  tracks = "planned",
  trailing,
  minimized = false,
  hideBottomBorder = false,
}: {
  onOpen: (id: string) => void
  /** Right-click a tick → open the entity menu for that occurrence's entity. Optional so
   *  the dayline stays usable standalone; wired from the canvas via the frames. */
  onContextMenuEntity?: (id: string, ev: React.MouseEvent) => void
  dataRev: number
  /** Which lane this instance paints. `"planned"` = scheduled occurrences only;
   *  `"presence"` = the tracked "where I was" band (Activity frame); `"both"` = the TODAY
   *  lane, which overlays BOTH on one band in two rows — elapsed planned ticks ride the
   *  UPPER row, presence + not-yet-elapsed planned ride the LOWER row (see `elapsed`). */
  tracks?: "planned" | "presence" | "both"
  /** Optional node rendered in the header next to the label (e.g. the presence lane's
   *  "3h 56m tracked" total). */
  trailing?: ReactNode
  /** Compact render for a MINIMIZED frame: the header (day labels / tracked total) moves
   *  from ABOVE the band to an overlay INSIDE it, and vertical margins tighten — so a
   *  minimized frame is just the band itself. (This is essentially the pre-v0.3.21 layout
   *  where day labels lived inside the band.) */
  minimized?: boolean
  /** Drop the full-bleed bottom separator + bottom padding — used when the NEXT frame is
   *  also a minimized band, so two adjacent minimized frames merge into one grouped strip
   *  with a single balanced gap between them (no divider). */
  hideBottomBorder?: boolean
}) {
  const isPresence = tracks === "presence"
  // TODAY's combined lane: paint planned + presence together, split across two rows so a
  // past planned tick and a past presence tick never overlap (see the tick render).
  const twoRow = tracks === "both"
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
  // Screen anchor (viewport coords) of the hovered tick, captured on mouse-enter. Used
  // ONLY by the minimized band: its tooltip is portaled to <body> (position:fixed) to
  // escape the canvas collapse wrapper's `overflow-hidden`, so it needs absolute
  // viewport coords rather than the in-lane percent the full-mode tooltip rides.
  const [hoverAnchor, setHoverAnchor] = useState<{ x: number; y: number } | null>(null)
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
    for (const occ of getTimelineOccurrences(ROOT_ID, lo, hi)) {
      const s = occ.schedule
      if (!s) continue
      // start / point / due — a due-only task anchors on its deadline and paints a point.
      const st = s.startAt ?? s.at ?? s.dueAt
      if (st == null) continue
      // ONGOING — an entity with a real start (in the past) but no end yet reads as still
      // running, so its tick GROWS from start to NOW, as if `:end:` were live-set to now. It
      // keeps extending each render until a real end is stamped. Only when the start is a
      // genuine `startAt` (not a due/at point) and it's already begun.
      const ongoing = s.endAt == null && s.startAt != null && s.startAt <= now
      const en = s.endAt ?? (ongoing ? now : st) // else a point (instant/due/no end) = zero span
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
        range: ongoing ? `${rangeText(st, en, s.repeat)} · ongoing` : rangeText(st, en, s.repeat),
        track: "planned",
        point: en <= st,
        // Done for the day → rises to the upper row in the combined TODAY lane. Ongoing
        // (no end yet) stays low: it's still happening, its right edge IS now.
        elapsed: !ongoing && en <= now,
        // An ongoing bar's right edge IS "now" — flag it so it renders anchored (never
        // spilling a min-width tick PAST the now marker), same as an open presence segment.
        openEnded: ongoing,
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
        title: entity ? titleAt(entity, st) : s.entityId === ROOT_ID ? "Home" : "Elsewhere",
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

  // Above-band DAY LABELS live in their own node map (NOT ripple nodes): they must NOT
  // wobble with the ripple — they're STICKY, painted imperatively by `paintDayLabels`.
  const dayLabelNodesRef = useRef<Map<string, HTMLElement>>(new Map())
  const registerDayLabel = useCallback((key: string) => {
    return (el: HTMLElement | null) => {
      const map = dayLabelNodesRef.current
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

  // STICKY-PUSH day labels (above-band strip). Every frame we compute each boundary's
  // real on-screen X — one formula covers BOTH pan paths: `leftPct/100·w − wheelCommit`
  // (drag re-anchors `winStart`, so `leftPct` is already fresh and wheelCommit is 0;
  // wheel keeps `winStart` fixed and slides via wheelCommit). Then, sorted left→right,
  // each label is clamped to `[0, nextBoundaryX − ownWidth]`:
  //   • a label whose boundary is still on-screen sits AT its boundary (flush-right);
  //   • the left-most past boundary PINS to the strip's left edge (x=0);
  //   • as the next day's boundary nears the edge it PUSHES the pinned label out left.
  // Purely imperative (no React state / re-render), mirroring `paintRipple`.
  const paintDayLabels = useCallback(() => {
    const lane = laneRef.current
    if (!lane) return
    const w = lane.clientWidth || 1
    const panPx = -wheelCommitRef.current
    // In the MINIMIZED in-band overlay the label sits ON the band next to its 1px marker,
    // so nudge each one a few px right to clear the line (absolute labels ignore the
    // overlay's padding, so the gap is baked into the transform). Above-band (full) mode
    // keeps labels flush at their boundary — the marker lives below them, not beside them.
    const inset = minimized ? LABEL_MARKER_GAP : 0
    const items: { el: HTMLElement; x: number; wdt: number }[] = []
    for (const el of dayLabelNodesRef.current.values()) {
      const leftPct = +(el.dataset.left ?? "") || 0
      items.push({ el, x: (leftPct / 100) * w + panPx, wdt: el.offsetWidth })
    }
    items.sort((a, b) => a.x - b.x)
    for (let i = 0; i < items.length; i++) {
      const nat = items[i].x
      // The upper clamp keeps a pushed-out label from overrunning the NEXT boundary. In
      // minimized mode both labels carry `+inset`, so subtract `2·inset`: the incoming
      // label keeps its `inset` gap to the RIGHT of the marker, and the pushed label keeps
      // an equal `inset` gap to the LEFT of it (otherwise they'd touch across the marker).
      const upper = i < items.length - 1 ? items[i + 1].x - items[i].wdt - 2 * inset : Infinity
      const x = Math.min(Math.max(nat, 0), upper)
      items[i].el.style.transform = `translateX(${x + inset}px)`
      // Fade out once shoved off the left edge or parked beyond the right edge.
      const off = x + items[i].wdt <= 0 || nat >= w
      items[i].el.style.opacity = off ? "0" : "1"
    }
  }, [minimized])

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
    paintDayLabels()
  }, [paintDayLabels])

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
    // Re-place the sticky day labels after any base-pan settle (drag, wheel flush,
    // initial mount) — the ripple loop is not running at rest, so paint them here.
    paintDayLabels()
  }, [viewStart, applyPan, paintDayLabels])

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
      .toLocaleDateString(formatLocale(), { weekday: "short", month: "short", day: "2-digit" })
      .replace(/,/g, "")
      .toUpperCase(),
    [],
  )

  // DAY-BOUNDARY MARKERS (planned lane only) — one per MIDNIGHT across the buffered window.
  // (The band's visible window is Zero's 5am–5am design choice, but the markers themselves
  // sit at true local midnight, so a day label lands on the calendar-date boundary.) The
  // `leftPct` drives TWO things: the in-band 1px line (a ripple node that slides/clips with
  // the timeline) AND the sticky-push label in the strip ABOVE the band (see paintDayLabels).
  // The ACTIVITY presence lane is intentionally left plain for now.
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

  // Reposition the sticky day labels when they REMOUNT (toggling `minimized` swaps their
  // host container: above-band strip ⇄ in-band overlay) or when the marker SET changes.
  // The base-pan layout effect above only fires on a `viewStart` change, so these two
  // paths would otherwise leave freshly-mounted labels untransformed until the next pan.
  useLayoutEffect(() => {
    paintDayLabels()
  }, [minimized, dayMarkers, paintDayLabels])

  // Header CONTENT, shared between the two layouts. PLANNED = the sticky-push day-label
  // rail (one abs-positioned label per midnight boundary, placed imperatively by
  // `paintDayLabels`); PRESENCE = the "x tracked" total. Registered via `registerDayLabel`
  // regardless of where it's mounted, so the imperative positioning is identical whether
  // the strip sits above the band (full) or overlaid inside it (minimized).
  const headerContent = isPresence ? (
    <span>{trailing}</span>
  ) : (
    dayMarkers.map((dm) => (
      <span
        key={dm.key}
        ref={registerDayLabel(dm.key)}
        data-left={dm.leftPct}
        className="absolute inset-y-0 left-0 flex items-center whitespace-nowrap leading-none will-change-transform"
      >
        {dm.label}
      </span>
    ))
  )

  return (
    <div
      className={cn(
        // Minimized frames want "little margins" — symmetric tight padding so a minimized
        // frame is just the bare band, top and bottom balanced. When the next frame is also
        // a minimized band (`hideBottomBorder`), drop THIS band's bottom padding so the sole
        // inter-band gap is the next band's own top padding — one balanced 4px gap, no divider.
        minimized ? cn("px-2 pt-1", hideBottomBorder ? "pb-0" : "pb-1") : "px-4 pt-3",
        // The PLANNED lane owns a full-bleed bottom separator in BOTH full and minimized
        // modes — mirroring ACTIVITY, whose ActivityBody wrapper is always `border-b`, so
        // the two frames separate identically. The PRESENCE lane never carries it (it flows
        // into its tracked list, and ActivityBody owns ACTIVITY's separator). Dropped when
        // the next frame is also minimized, so two adjacent minimized bands merge.
        !isPresence && !hideBottomBorder && "border-b border-border",
        // Extra bottom padding only in full mode; minimized uses the tight padding above.
        !minimized && (isPresence ? "pb-1" : "pb-3"),
      )}
    >
      {/* ABOVE-BAND HEADER STRIP (faded) — only when NOT minimized. The old "now" button is
          gone (double-click the band still recenters); the live full date+time lives in the
          glued-top clock. When minimized, this same content is overlaid INSIDE the band. */}
      {!minimized &&
        (isPresence ? (
          <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
            {headerContent}
          </div>
        ) : (
          <div className="relative mb-2 h-3 overflow-hidden text-[10px] uppercase tracking-wider text-muted-foreground/60">
            {headerContent}
          </div>
        ))}
      {/* Lane row. Full mode reserves the constant DAYLINE_ROW_H (34px) so the band sits
          at a stable height; minimized lets the row wrap the lane exactly (h-7 = 28px) so
          there's no dead space below the band making the bottom margin look bigger than
          the top. */}
      <div className="relative" style={minimized ? undefined : { height: DAYLINE_ROW_H }}>
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
          {/* IN-BAND HEADER OVERLAY (minimized only) — the same faded header content that
              normally sits ABOVE the band is overlaid INSIDE it, vertically CENTERED
              (`inset-y-0 flex items-center`), so a minimized frame is just the band. The
              presence "x tracked" total is a flex child (respects `pl-2`); the planned day
              labels are absolute and get their marker gap from LABEL_MARKER_GAP in the
              transform. Non-interactive + clipped so it never blocks panning and trims to
              the band; `z-10` keeps it above the ticks. */}
          {minimized && (
            <div className="pointer-events-none absolute inset-y-0 inset-x-0 z-10 flex items-center overflow-hidden pl-2 text-[9px] uppercase leading-none tracking-wider text-muted-foreground/60">
              {headerContent}
            </div>
          )}
          {/* MINIMIZED HOVER TOOLTIP — the same floating design as the full-mode HOVER
              HELPER below, but PORTALED to <body> in fixed/viewport coords. A minimized
              band is exactly band-height and lives inside the canvas's `overflow-hidden`
              collapse wrapper, so an in-flow tooltip above/below the lane is clipped. The
              portal lets it BLEED past that wrapper (what the earlier in-band chip worked
              around), so it reads identically to the non-minimized dayline tooltip. Anchored
              just ABOVE the hovered tick via `hoverAnchor` (its on-screen midpoint), and
              clamped to the viewport so it never runs off-screen. */}
          {minimized &&
            hovered &&
            hoverAnchor &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                className="pointer-events-none fixed z-[60] flex max-w-[40vw] -translate-x-1/2 -translate-y-full items-center gap-1.5 whitespace-nowrap rounded border border-border/70 bg-card px-2 py-1 text-[10.5px] font-medium leading-none tracking-tight text-foreground/80 shadow-sm"
                style={{
                  left: Math.min(window.innerWidth - 8, Math.max(8, hoverAnchor.x)),
                  top: Math.max(8, hoverAnchor.y - 6),
                }}
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
              </div>,
              document.body,
            )}
          {/* CLIP layer — fixed to the lane so it always trims to the true bounds. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
            {/* CONTENT PAN — the in-progress wheel pan is applied here as an imperative
                translateX; the bars slide within the fixed clip window. PLANNED bars
                (colored) sit in the main body; PRESENCE (white ticks) lines the bottom. */}
            <div ref={contentPanRef} className="pointer-events-none absolute inset-0 will-change-transform">
              {/* DAY-BOUNDARY LINES (planned lane) — painted BEHIND the ticks. Each is a
                  ripple node (data-left + registerRipple) so the 1px faded midnight line
                  pans/slides/clips WITH the timeline. The date LABEL is no longer here — it
                  lives in the sticky strip above the band (see paintDayLabels). */}
              {dayMarkers.map((dm) => (
                <div
                  key={dm.key}
                  ref={registerRipple(dm.key)}
                  data-left={dm.leftPct}
                  className="pointer-events-none absolute inset-0 will-change-transform"
                >
                  <div
                    className="absolute inset-y-0 w-px bg-muted-foreground/25"
                    style={{ left: `${dm.leftPct}%`, zIndex: 2 }}
                  />
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
                (twoRow ? [...planned, ...presence] : isPresence ? presence : planned).map((p) => {
                  const isHot = hoveredKey === p.key
                  // Combined TODAY lane: elapsed planned rises to the upper row; presence
                  // and not-yet-elapsed planned stay on the lower row.
                  const elevated = twoRow && p.track === "planned" && !!p.elapsed
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
                        onMouseEnter={(ev) => {
                          setHoveredKey(p.key)
                          // Capture the tick's on-screen midpoint for the minimized band's
                          // portaled tooltip (anchored above the tick, in viewport coords).
                          const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
                          setHoverAnchor({ x: r.left + r.width / 2, y: r.top })
                        }}
                        onMouseLeave={() => {
                          setHoveredKey((h) => (h === p.key ? null : h))
                          setHoverAnchor(null)
                        }}
                        onClick={() => {
                          if (draggedRef.current) return // a pan, not a tap
                          onOpen(p.id)
                        }}
                        onContextMenu={
                          onContextMenuEntity ? (ev) => onContextMenuEntity(p.id, ev) : undefined
                        }
                        className={cn(
                          "pointer-events-auto absolute cursor-default",
                          // SINGLE-track lanes keep the CSS transition + centered placement
                          // (top-1/2 + -translate-y-1/2). The two-row lane drives `top` and
                          // its own transition via inline style instead (see below), so those
                          // classes are dropped there.
                          !twoRow && "transition-[height,opacity] duration-150",
                          !twoRow && "top-1/2",
                          p.point ? "rounded-full" : "rounded-[2px]",
                          // Translate composes on separate axes: X for a point / open-ended
                          // segment, Y to center every tick. Tailwind's translate utils stack.
                          p.point && "-translate-x-1/2",
                          p.openEnded && "-translate-x-full",
                          !twoRow && "-translate-y-1/2",
                        )}
                        style={{
                          left: p.openEnded ? `${p.leftPct + p.widthPct}%` : `${p.leftPct}%`,
                          // All ticks share ONE height across both tracks; sleep spans no
                          // longer grow taller — the starfield fills the standard band.
                          width: p.point ? 2 : `max(3px, ${p.widthPct}%)`,
                          height: isHot ? 13 : 9,
                          // Two-row lane: place by explicit `top` (upper row for elapsed
                          // planned, lower row otherwise) and animate the rise inline.
                          ...(twoRow
                            ? { top: elevated ? ROW_TOP_PX : ROW_BOTTOM_PX, transition: ROW_TRANSITION }
                            : null),
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
                {new Date(nowHover ? nowSec : now).toLocaleTimeString(formatLocale(), {
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
              two-layer pan-follow as everything else. FULL mode only — a minimized band
              shows the label in-band instead (it would be clipped floating below here). */}
          {!minimized && hovered && (
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
