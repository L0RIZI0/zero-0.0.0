"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { getSegments, useActivityRevision } from "@/lib/zero/activity-log"
import { ROOT_ID, getEntitiesWithSessions, getEntity, getInheritedAccent, getDaylineOccurrences } from "@/lib/zero/data"
import type { TimelineOccurrence } from "@/lib/zero/data"

/** A top-rail occurrence's dispatch identity, surfaced for the per-occurrence right-click menu (v0.2.249). */
export type DaylineOccRef = NonNullable<TimelineOccurrence["occRef"]>
 import { titleAt } from "@/lib/zero/entity-log"
 import { webLabel } from "@/lib/zero/web-resources"
 import type { Entity } from "@/lib/zero/types"
 import { isClosed, computeCloseAt, effectiveScheduleEnd } from "@/lib/zero/kinds"
import { rangeText, fmtTime, NOW_COLOR } from "@/lib/zero/timeline-format"
import { isSleepTitle, sleepSkyBackground } from "@/lib/zero/sleep-sky"
import { DAYLINE_ROW_H } from "@/lib/zero/layout"
import { useNowSeconds, useAnimationFrameNow } from "@/lib/zero/use-now"
import { formatLocale } from "@/lib/zero/format-locale"
import { Zero0Glyph } from "./zero0-glyph"
import { cn } from "@/lib/utils"

/** The label shown for an entity on the dayline (bars + hover tooltip). A WEB RESOURCE uses its
 *  concise DISPLAYED title CROPPED to the same width as ENTITY CONTENT (`webLabel().display`,
 *  {@link WEB_TITLE_MAX_LEN} chars) — so a bar/tooltip reads "v0 by Vercel -…" instead of the full
 *  fetched `<title>` or the visually heavy raw `https://www.v0.app`. A curated human name stays
 *  full (never cropped). Everything else keeps the historical `titleAt` fold (the name the place
 *  carried at that time). */
function daylineLabel(entity: Entity, at: number): string {
  if (entity.webUrl) {
    return webLabel({
      webUrl: entity.webUrl,
      webResourceId: entity.webResourceId,
      webTitle: entity.displayTitle,
      title: entity.title,
    }).display
  }
  return titleAt(entity, at)
}

/** Horizontal gap (px) between a day label and its 1px boundary marker in the minimized
 *  in-band overlay, so the two never touch. */
const LABEL_MARKER_GAP = 8
// Minimum horizontal breathing room kept between two day labels when the timeline is scrolled and
// one boundary's label is pushed toward the next (v0.2.287) — stops "…07SAT AUG 08" from reading as
// glued. In the MINIMIZED overlay the `2·LABEL_MARKER_GAP` inset already exceeds this; this floor is
// what the full/maximized above-band strip (inset 0) relies on.
const LABEL_COLLIDE_GAP = 12

// ============================================================================
// The ZERO0 DAYLINE — an ACCESS-ONLY port of the /2 dayline into root `/0`.
// ----------------------------------------------------------------------------
// This vendors the /2 dayline's *fluid* machinery VERBATIM — the ripple pan
// (coupled critically-damped spring chain), wheel/trackpad momentum glide, and
// the live NOW marker — but strips it to what root actually has: the ACCESS
// band ("where I was"), fed by root's ISOLATED activity log (`zero:root-activity:v1`).
//
// Now carries BOTH tracks: PLANNED occurrences (recurrence-expanded, accent-colored,
// with sleep-titled moments painting the procedural /0 night sky) AND the ACCESS
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
const HOUR_MS = 3_600_000
const MIN_MS = 60_000
// DRAG RE-TIME (v0.2.286). Loris chose FREE-DRAG to the MINUTE (no hour/quarter snap), so a
// dragged edge lands on the nearest whole minute. `MIN_OCC_MS` is the floor a RESIZE can shrink a
// span to (1 minute) so an occurrence can't be dragged inside-out to zero/negative length.
const MIN_OCC_MS = MIN_MS
const roundToMinute = (t: number) => Math.round(t / MIN_MS) * MIN_MS
// VIEW_SPAN_MS — the DEFAULT width of the VISIBLE window (how much time the band shows at once).
// This is DECOUPLED from DAY_MS (which stays the calendar-day length for the 5am day bucket
// + midnight markers). It is now the INITIAL value of the `viewSpan` STATE (v0.2.303): the user
// pinch-zooms the band live between MIN_VIEW_SPAN_MS and MAX_VIEW_SPAN_MS, and the whole geometry
// (bar positions/widths, day/hour markers, now marker, pan px↔ms scale) reads the live span. When
// span === DAY_MS the geometry is identical to the classic 24h dayline (the resting default).
const VIEW_SPAN_MS = DAY_MS
// PINCH-ZOOM bounds (v0.2.303) — how far the trackpad pinch can zoom the band. IN to 30 minutes
// (short sessions read wide), OUT to 7 days (a week at a glance). The default DAY_MS sits between.
const MIN_VIEW_SPAN_MS = 30 * MIN_MS
const MAX_VIEW_SPAN_MS = 7 * DAY_MS
// How aggressively a pinch changes the span. The pinch arrives as ctrl+wheel `deltaY`; span scales
// by exp(deltaY·k) so zoom is exponential (feels linear to the hand) and symmetric in/out.
const ZOOM_SENSITIVITY = 0.01
// The day "bucket" runs 5am→5am so a normal day (and its late-evening items)
// land inside one window instead of being split at midnight.
const DAY_START_HOUR = 5
const NEUTRAL = "oklch(0.72 0.004 75)"
// Sentinel color marking the COLORLESS ROOT place (the root Individual with no accent
// and no colored ancestor). At render it maps to a THEME-BACKGROUND fill (near-black in
// dark, near-white in light) + grey hairline — a solid outlined chip. Kept distinct so
// render detects it (rather than tinting it like a real accent).
const ROOT_SENTINEL_COLOR = "#ffffff"

// THREE-RAIL model (v0.6.21) — on the COMBINED TODAY lane (`tracks="both"`) the band is a MIDDLE
// spine flanked by two rails, framed as FUTURE · PRESENT · MANUAL-HISTORY:
//   • the PLANNED rail (TOP) — DECLARED/planned spans only (the plan): scheduled occurrences,
//     past or future, incl. an ongoing declared span (clock inside a declared start→end).
//   • the MIDDLE spine — the COLLAPSED-ACCESS leaf-spine: at each instant, the DEEPEST open focus
//     session (the current leaf). One continuous, non-overlapping line — the declarable/correctable
//     ACCESS record (`--sessionStart/End` slides it). Ancestor focus sessions still exist for state
//     + rollup but are NOT drawn (killing the old A>B>C>D overlap mud). See the `spine` memo.
//   • the RECORDED rail (BOTTOM) — PLAYED sessions (v0.2.257): BOTH auto (started by ENTERING an
//     ongoing-on-enter kind) AND remote (a deliberate glyph/menu Play that survives navigation) —
//     every `via:"play"` session. Focus sessions are the middle spine (NOT here); instant marks
//     now live only as the glyph pulse.
// The MIDDLE spine IS the access machine truth (leaf-collapsed). The standalone ACTIVITY dayline
// (`tracks="access"`) renders the SAME access record on its own surface (uncollapsed). Both are the
// one canonical enter/exit-driven "where I was" — there is no second, separately-named record.
// Within the TOP + BOTTOM rails, OVERLAPPING spans PACK into sub-lanes (see `packLanes`); the middle
// spine is single-lane by construction. Overflow policy:
// the BAND GROWS TALLER rather than shrinking ticks — every sub-lane keeps its full fixed
// height, and the band's total height = (planned sub-lanes + recorded sub-lanes) laid out at
// full size. So a busy day makes a taller band, not thinner ticks.
const RAIL_PAD = 4 // breathing room in EACH half (above the planned ticks / below the recorded ticks)
// FIXED per-lane tick heights (never shrink). One sub-lane per rail = the resting band.
const PLANNED_LANE_H = 11
const RECORDED_LANE_H = 10
// MIDDLE rail (v0.6.21 THREE-RAIL model) = the collapsed-ACCESS leaf-spine, ONE non-overlapping
// lane sitting ON the seam (the band's axis). PLANNED stacks UP from just above it, PLAYED stacks
// DOWN from just below it. Its height is the band's fixed center strip.
const MIDDLE_LANE_H = 10
// Height of an access tick on the STANDALONE ACTIVITY dayline (`tracks="access"`).
const ACCESS_HEIGHT_PX = 10
// (v0.2.260 — the display-only SESSION_MERGE_GAP_MS coalesce was removed; each stored session now
// renders as its own recorded tick. See the sessions memo for the rationale.)

// Band metrics for the COMBINED lane. The SEAM sits at the VERTICAL CENTER of the band (equal
// halves) and the WHOLE band grows as either rail gains sub-lanes: each half is sized to the
// TALLER rail's content plus `RAIL_PAD`, so the seam stays centered no matter the lane counts.
// PLANNED ticks stack UPWARD from the seam (bottom-aligned, hugging it); RECORDED ticks stack
// DOWNWARD from the seam (top-aligned, hugging it). Resting (1 sub-lane each): half = 11+4 = 15,
// so seam = 15, band = 30.
// v0.6.21: a MIDDLE leaf-spine strip (MIDDLE_LANE_H) now sits centered on the seam. Each half is
// sized to the taller of its rail's content + RAIL_PAD, and the middle strip is inserted between
// them, so the seam (spine center) = topHalf + MIDDLE_LANE_H/2. `middle=false` (legacy / non-
// combined) collapses to the original two-rail band with no center strip.
function bandMetrics(plannedCount: number, recordedCount: number, middle = false) {
  const plannedH = Math.max(1, plannedCount) * PLANNED_LANE_H
  const recordedH = Math.max(1, recordedCount) * RECORDED_LANE_H
  const half = Math.max(plannedH, recordedH) + RAIL_PAD
  const mid = middle ? MIDDLE_LANE_H : 0
  return { seam: half + mid / 2, bandH: half * 2 + mid, half, mid }
}
// NOTE: the day label centers across the WHOLE top half [0, seam] (flex-centered) so it has
// SYMMETRIC top/bottom margins between the band top and the (centered) seam — see its render below.

// Greedy interval LANE-PACKING (generalizes the old ongoing stack). Assigns each bar to the
// lowest lane whose last-placed bar ends at/before this bar's start (no overlap); opens a new
// lane when none is free. `compare` sets placement order: planned packs by START (minimal lanes,
// tiling spans share lane 0); recorded packs LONGEST-FIRST so the longest session hugs the
// seam. All bars share the [leftPct, leftPct+widthPct] x-range.
// v0.2.258 — an OPEN-ENDED bar (still ongoing; its right edge is pinned to the live `now`) OWNS
// its lane INDEFINITELY (lane-end = +∞). Two concurrent ongoing spans both have right≈now, and a
// freshly-started one has left≈now too, so the old finite `right = left+width` made the packer read
// them as merely TOUCHING (`laneEnd <= newLeft + EPS`) and drop the second into the first's lane —
// they stacked for ~1s until the per-second clock advanced `now` and they reflowed. Infinity lane-
// ends make a second concurrent open bar always open a FRESH lane on the very first frame. A closed
// bar that ended before an open bar began is unaffected (its own lane-end stays finite).
type LanePack = { laneOf: Map<string, number>; laneCount: number }
function packLanes(
  bars: { key: string; leftPct: number; widthPct: number; openEnded?: boolean }[],
  compare: (a: { leftPct: number; widthPct: number }, b: { leftPct: number; widthPct: number }) => number,
): LanePack {
  const laneOf = new Map<string, number>()
  const laneEnds: number[] = [] // rightPct of the last bar placed in each lane
  const EPS = 0.001
  for (const b of [...bars].sort(compare)) {
    const left = b.leftPct
    const right = b.openEnded ? Number.POSITIVE_INFINITY : b.leftPct + Math.max(b.widthPct, 0)
    let placed = laneEnds.findIndex((end) => end <= left + EPS)
    if (placed === -1) {
      placed = laneEnds.length
      laneEnds.push(right)
    } else {
      laneEnds[placed] = right
    }
    laneOf.set(b.key, placed)
  }
  return { laneOf, laneCount: laneEnds.length }
}
// ENTITY-GROUPED lane packing for the RECORDED (bottom) rail (v0.2.260, Loris ask). Unlike the
// generic packLanes (which packs individual bars longest-first), this keeps ALL sessions of the SAME
// entity on ONE lane whenever their intervals don't overlap — so a stop→restart of an entity lines
// up HORIZONTALLY with its earlier session (the uzer reads "one entity = one row"). Lanes are ordered
// MOST-POPULATED-FIRST: the entity with the most ticks is placed first and takes the lowest lane
// index, which on the recorded rail is NEAREST THE SEAM (= "on top"); ties break by earliest start.
// An open-ended session occupies [left, right=now] (its CURRENT extent) — NOT [left, +∞). Using now
// (v0.2.262) is what keeps the lane layout STABLE across a stop: an ongoing tick closes at endedAt ≈
// now, so its interval barely changes, so nothing re-packs and `laneCount`/seam don't shift. The old
// +∞ made an open tick "block" the whole right side, so on close other entities suddenly packed
// tighter, laneCount dropped, the seam moved, and EVERY rail (incl. the middle spine) slid over the
// 200ms `top` transition — the "lane top margin jump" that read like a scaleY. Two CONCURRENT opens
// still both extend to now ⇒ they overlap ⇒ still separate lanes (correct). Nothing is ever to the
// right of now, so "now" preserves the "nothing packs past an open tick" property too.
function packLanesByEntity(
  bars: { key: string; id: string; leftPct: number; widthPct: number; openEnded?: boolean }[],
): LanePack {
  const laneOf = new Map<string, number>()
  const EPS = 0.001
  type Iv = { lo: number; hi: number }
  type Grp = { bars: typeof bars; ivs: Iv[]; count: number; minLeft: number }
  const groups = new Map<string, Grp>()
  for (const b of bars) {
    const lo = b.leftPct
    // Finite extent for BOTH open and closed ticks (open right edge = leftPct+widthPct = nowPct).
    const hi = b.leftPct + Math.max(b.widthPct, 0)
    let g = groups.get(b.id)
    if (!g) {
      g = { bars: [], ivs: [], count: 0, minLeft: lo }
      groups.set(b.id, g)
    }
    g.bars.push(b)
    g.ivs.push({ lo, hi })
    g.count += 1
    g.minLeft = Math.min(g.minLeft, lo)
  }
  // most-populated first → lowest lane index (nearest seam = top); tie-break by earliest start.
  const ordered = [...groups.values()].sort((a, b) => b.count - a.count || a.minLeft - b.minLeft)
  const lanes: Iv[][] = [] // intervals already committed to each lane
  const clear = (gi: Iv, li: Iv) => gi.hi <= li.lo + EPS || li.hi <= gi.lo + EPS
  for (const g of ordered) {
    let placed = lanes.findIndex((laneIvs) => g.ivs.every((gi) => laneIvs.every((li) => clear(gi, li))))
    if (placed === -1) {
      placed = lanes.length
      lanes.push([])
    }
    lanes[placed].push(...g.ivs)
    for (const b of g.bars) laneOf.set(b.key, placed)
  }
  return { laneOf, laneCount: lanes.length }
}
// Geometry (fixed height + band-pixel center) for a bar in a rail's sub-lane, given the current
// `seam`. Ticks HUG THE SEAM: PLANNED lane 0 sits bottom-aligned just ABOVE the seam and higher
// lanes stack UPWARD; RECORDED lane 0 sits top-aligned just BELOW the seam and higher lanes stack
// DOWNWARD. Heights are FIXED (no shrink) — the band grows instead (see bandMetrics).
// v0.6.21: `mid` = the middle strip's height (0 when there's no middle rail). PLANNED lane 0 hugs
// just ABOVE the strip (its band edge = seam - mid/2); RECORDED lane 0 hugs just BELOW it
// (seam + mid/2); MIDDLE is the single spine lane centered ON the seam.
function laneGeom(rail: "planned" | "recorded" | "middle", laneIndex: number, seam: number, mid = 0) {
  if (rail === "middle") {
    return { height: MIDDLE_LANE_H, center: seam }
  }
  if (rail === "planned") {
    const edge = seam - mid / 2
    return { height: PLANNED_LANE_H, center: edge - (laneIndex * PLANNED_LANE_H + PLANNED_LANE_H / 2) }
  }
  const edge = seam + mid / 2
  return { height: RECORDED_LANE_H, center: edge + laneIndex * RECORDED_LANE_H + RECORDED_LANE_H / 2 }
}

// When an entity is FOCUSED from elsewhere in the canvas — its ENTITY CONTENT row is
// hovered, or it's the currently-open context — every tick that belongs to it grows to
// this height and snaps fully opaque, so the dayline echoes "this is the thing you're
// looking at". Taller than any resting tick (20px planned / 10px access) so a lit tick
// clearly pops above the lane. Animated via the tick's height/opacity transition.
const HIGHLIGHT_HEIGHT_PX = 26

// UNKNOWN-END FADE — a planned tick whose end is genuinely unknown (a concrete start with
// no declared/implied end, not yet closed) doesn't just stop: it FADES OUT rightward from
// its right edge to signal "still going, end unknown." For an ONGOING tick that right edge
// IS the now marker, so the fade trails PAST now into the future; for a FUTURE open-ended
// start it trails rightward from the start point. The mirror `fadingStart` fades in from the
// LEFT for an unknown-start tick.
//
// v0.2.312: the fade is now a fixed TIME span, not a fixed pixel length. It's expressed as a
// percentage of the lane (FADE_MS / viewSpan) so it GROWS/SHRINKS with the pinch-zoom exactly
// like every other tick, and — because it's a `%` and never a `px` — the zoom transform-glide's
// scaleX scales it precisely and it commits to the same value (no elongate-then-snap, the same
// artifact the .310 tick-floor removal fixed). ~5min reads as a short "continues" blend at the
// day view while staying proportional at any zoom. Kept a clean linear ramp (0%→100%).
const FADE_MS = 5 * MIN_MS
// UNKNOWN-START (left-end) fade — kept a FIXED pixel length regardless of zoom (Loris ask), unlike
// the right-end fade above. It reads as a constant qualitative "starts before here" lead-in rather
// than a measured duration, so a fixed px is intentional here. (Trade-off: a fixed-px extension is
// momentarily stretched by the zoom transform-glide's scaleX and snaps back at commit — acceptable
// for a small lead-in that only appears on unknown-start ticks.)
const START_FADE_PX = 20

/**
 * Resolve the two colors a dayline tick paints, shared by BOTH tracks (planned +
 * access):
 *   • `fill`   — the entity's OWN color: its `accent` (`:color:`), else the nearest
 *                ancestor SPACE accent, else neutral grey. The root uses the
 *                ROOT_SENTINEL_COLOR sentinel (→ transparent fill at render). A sleep span
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
  const own = e?.color ?? getInheritedAccent(e?.parentId ?? null)
  const fill = own ?? (isRoot ? ROOT_SENTINEL_COLOR : NEUTRAL)

  // Walk ancestors (from the parent up) to (a) detect a Space container and (b) resolve
  // the parent's display color for the hairline.
  const parent = e?.parentId ? getEntity(e.parentId) : undefined
  const parentColor = parent ? (parent.color ?? getInheritedAccent(parent.parentId)) : undefined
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
/** [start,end) of the `span`-wide window containing `now`, aligned to the 5am day grid.
 *  With span === DAY_MS this is exactly the classic 5am→5am day window (idx always 0); when zoomed
 *  in it returns the span-sized sub-window of the current day that holds `now`; when zoomed OUT past
 *  a day the window simply starts at the current day's 5am and runs `span` forward. */
function dayWindow(now: number, span: number): [number, number] {
  const d = new Date(now)
  d.setHours(DAY_START_HOUR, 0, 0, 0)
  let dayStart = d.getTime()
  if (now < dayStart) dayStart -= DAY_MS // before 5am → the day opened at yesterday's 5am
  const idx = Math.max(0, Math.floor((now - dayStart) / span))
  const start = dayStart + idx * span
  return [start, start + span]
}

// A bar on the lane. Two TRACKS share one geometry/hover model:
//  • "planned"  — a SCHEDULED occurrence (moment/instant/scheduled space) from the
//    real entity graph, COLORED by the entity's `accent` (set via `:color:`), else an
//    inherited space accent, else neutral. This is the "intent".
//  • "access"   — a TRACKED access segment ("where I actually was" — the machine truth,
//    never user-editable), drawn as a PURE-WHITE hairline tick along the bottom edge.
//    This is "what happened".
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
  // Which conceptual rail this bar belongs to (used for styling + a11y wording; the actual
  // rail ROUTING in the combined lane is by lane-index / `sess:` key, not this field):
  //   planned  = top rail    — declared/scheduled OCCURRENCES (the plan)
  //   recorded = bottom rail  — remote-play stopwatches only (non-auto `via:"play"` sessions)
  //   middle   = middle spine — current-leaf ACCESS on the combined TODAY lane
  //   access   = the standalone Activity dayline's ACCESS band (same machine truth, own surface)
  track: "planned" | "recorded" | "access" | "middle"
  /** A single-point occurrence (instant / zero-length) renders as a thin tick. */
  point: boolean
  /**
   * An INSTANT occurrence MARK — a zero-length `via:"mark"` session. Renders as a small
   * downward-triangle instant glyph (not a bare 2px tick) so an occurrence reads as "an
   * Instant on the dayline" rather than an easy-to-miss sliver.
   */
  markGlyph?: boolean
  /**
   * A PLANNED instant occurrence (`kind === "instant"`). Instead of a bare 2px point tick,
   * it renders on the TOP rail as a small FILLED instant glyph (the down-triangle) with the
   * entity's title beside it, both painted in the entity's own color — so a placed instant
   * reads as a labelled point on the plan, not an easy-to-miss sliver.
   */
  instant?: boolean
  /**
   * An access segment that is still OPEN (`leftAt === null`) — its right edge IS
   * "now". Rendered anchored to its right edge (growing leftward) so its min-width
   * never spills a tick PAST the NOW marker.
   */
  openEnded?: boolean
  /**
   * PLANNED bars: the tick's end is genuinely UNKNOWN — a concrete start with no
   * declared/implied end that hasn't closed (covers BOTH an ongoing tick, whose right
   * edge is the now marker, and a still-future open-ended start). Renders a rightward
   * fade off the tick's right edge (see {@link FADE_MS}). A closed tick, a
   * point with a known instant, and any bar with an effective end never set this.
   */
  unknownEnd?: boolean
  /**
   * PLANNED/SESSION bars: the tick's START is genuinely UNKNOWN — a real (declared/implied) END but no
   * concrete start, and not a point/due anchor. Renders a LEFTWARD fade off the tick's left edge, the
   * mirror of {@link unknownEnd}'s right fade (see {@link FADE_MS}). (v0.2.249)
   */
  unknownStart?: boolean
  /**
   * For a sleep-titled planned Moment: a procedural night-sky CSS `background`
   * string (see {@link sleepSkyBackground}) painted INSTEAD of the flat accent, so
   * a night's sleep reads as a tiny starfield. Absent for every other bar.
   */
  sky?: string
  /**
   * PLANNED (top-rail) bars: the occurrence's dispatch identity (v0.2.249), so a right-click opens the
   * per-occurrence menu (Edit time / Cancel / Delete) acting on THAT occurrence — the same origin-
   * discriminated address the §0 block uses. Absent for session/spine/access bars (they open the
   * whole-entity menu).
   */
  occRef?: NonNullable<TimelineOccurrence["occRef"]>
  /**
   * ABSOLUTE epoch bounds of this occurrence (v0.2.286) — its start and effective end in ms,
   * carried so an edge / move DRAG can map a pixel delta straight back to a concrete new time
   * and commit it through the occurrence writers. Set on every PLANNED bar; `startMs` is absent
   * for an end-only (`unknownStart`) tick, which is never edge-editable anyway.
   */
  startMs?: number
  endMs?: number
  /**
   * RECORDED (bottom-rail) bars only (v0.2.293): the anchor id of the log entry that opened this
   * recorded session — its {@link Session.anchorId}. Carried so a right-click on the bar can open the
   * recorded-session menu (Edit time / Delete) via {@link onSessionMenu}, the exact bottom-rail mirror
   * of {@link occRef} for the top rail. Present only on a CLOSED, anchored `via:"play"` tick (the same
   * editability gate the §0 list uses); absent ⇒ the bar falls back to the whole-entity menu.
   */
  sessionAnchorId?: number
  /**
   * ACCESS bars only. A "session of using Zero" is a RUN of contiguous access
   * segments (leaving one place enters the next at the same instant; a gap only opens
   * when the app was backgrounded). `roundLeft` marks the FIRST tick of such a run (its
   * left corners round); `roundRight` marks the LAST (its right corners round). Ticks in
   * the MIDDLE of a run stay fully square, so a session reads as one continuous pill.
   */
  roundLeft?: boolean
  roundRight?: boolean
}

/**
 * Root `/0` dayline. Renders PLANNED scheduled occurrences (colored) and TRACKED
 * access (white ticks) on one fluid, pannable lane. `onOpen(id)` drills the canvas
 * into an entity when its bar is tapped (guarded against pans by `draggedRef`).
 * `dataRev` is the canvas's mutation counter — bumping it re-derives the planned bars
 * after a `:color:` / `:start:` / create edit.
 */
export function Zero0Dayline({
  onOpen,
  onContextMenuEntity,
  onOccurrenceMenu,
  onSessionMenu,
  onOccurrenceRetime,
  onSessionRetime,
  dataRev,
  tracks = "planned",
  trailing,
  minimized = false,
  hideBottomBorder = false,
  highlightId = null,
}: {
  onOpen: (id: string) => void
  /** Right-click a tick → open the entity menu for that occurrence's entity. Optional so
   *  the dayline stays usable standalone; wired from the canvas via the frames. */
  onContextMenuEntity?: (id: string, ev: React.MouseEvent) => void
  /** Right-click a TOP-rail (planned) tick → open the PER-OCCURRENCE menu (Edit time / Cancel /
   *  Delete) for that specific occurrence, using its dispatch identity (v0.2.249). Falls back to
   *  `onContextMenuEntity` when absent or when the tick carries no `occRef`. Middle/bottom ticks
   *  never use this (they're not occurrences). */
  onOccurrenceMenu?: (
    entityId: string,
    occ: NonNullable<TimelineOccurrence["occRef"]>,
    ev: React.MouseEvent,
  ) => void
  /** Right-click a BOTTOM-rail (recorded) tick that carries a `sessionAnchorId` → open the per-session
   *  menu (Edit time / Delete) for THAT recorded session, keyed by its anchor id (v0.2.293) — the exact
   *  bottom-rail mirror of `onOccurrenceMenu`. Falls back to `onContextMenuEntity` when absent or when
   *  the tick has no anchor (open/legacy session). */
  onSessionMenu?: (entityId: string, anchorId: number, ev: React.MouseEvent) => void
  /** COMMIT a drag re-time of a planned occurrence (v0.2.286) — the new absolute start/end (ms,
   *  already rounded to the minute) for the occurrence addressed by `occ`. Wired from the canvas
   *  to `setDefiniteOccurrenceTime` / `setRuleOccurrenceTime`. Absent ⇒ edge/move handles are inert. */
  onOccurrenceRetime?: (
    entityId: string,
    occ: NonNullable<TimelineOccurrence["occRef"]>,
    start: number,
    end: number,
  ) => void
  /** COMMIT a drag re-time of a RECORDED session (v0.2.294) — the new absolute start/end (ms, rounded to
   *  the minute) for the session addressed by `anchorId`. Wired from the canvas to `editSession`. Absent ⇒
   *  recorded ticks' edge/move handles are inert (they fall back to click-open + right-click menu only). */
  onSessionRetime?: (entityId: string, anchorId: number, start: number, end: number) => void
  dataRev: number
  /** Which lane this instance paints. `"planned"` = scheduled occurrences only;
   *  `"access"` = the tracked "where I was" band (Activity frame — the machine-truth
   *  access record); `"both"` = the TODAY lane, which overlays BOTH on one centered band,
   *  telling them apart by HEIGHT — planned ticks a fixed 20px, access a fixed 10px (see
   *  the height constants). */
  tracks?: "planned" | "access" | "both"
  /** Optional node rendered in the header next to the label (e.g. the access lane's
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
  /** The entity id currently HOVERED in ENTITY CONTENT (hover-only — NOT the open context;
   *  the canvas clears this on navigation so drilling in never leaves a tick lit). Every tick
   *  whose `id` matches grows + goes fully opaque — a cross-component "this is the row you're
   *  pointing at" echo. `null` = nothing hovered. */
  highlightId?: string | null
}) {
  const isAccess = tracks === "access"
  // TODAY's combined lane: paint planned + access together on one centered band,
  // distinguished by height (taller planned, shorter access — see the tick render).
  const combined = tracks === "both"
  // v0.6.24: the dayline runs on the PER-SECOND clock (was per-minute `useNow`). Two reasons:
  //   • LAG — with a per-minute clock the ongoing bars + spine only advanced/recomputed once a
  //     minute, so a just-punched leaf's tick appeared "a couple seconds late" (whenever the memo
  //     next happened to re-run). Per-second = smooth, ≤1s to appear.
  //   • MARKER SYNC — the now marker and every open-segment right edge now read the SAME `now`, so
  //     an open tick can never render to the RIGHT of the marker (the old bug came from the spine
  //     using real `Date.now()` while the marker used the stale per-minute value).
  const now = useNowSeconds()
  const [mounted, setMounted] = useState(false)
  // SMOOTH visual clock (v0.2.261) — a rAF-driven `now` used ONLY for the continuously-moving
  // geometry (the NOW marker + open-tick right edges). The per-second `now` above still drives all
  // DATA derivation (open/closed classification, projections, the day window), so the marker-sync
  // invariant holds: both the marker and open edges below read THIS same smooth value, so an open
  // tick can never render to the right of the marker (the reason the clock was unified originally).
  // True while a pan/ripple/wheel gesture is in motion (set by the pan loop below). The smooth clock
  // SKIPS its re-render while this is true so it never stacks a 30fps React commit on top of the
  // imperative, transform-only pan loop (which owns the main thread during a drag). v0.2.262.
  const panActiveRef = useRef(false)
  const smoothNowRaw = useAnimationFrameNow(mounted, 33, () => !panActiveRef.current)
  // Fall back to the per-second `now` until the first rAF frame lands (and on the server).
  const smoothNow = smoothNowRaw || now
  // `viewStart` is the left edge of the shown window. Panning moves it directly;
  // the auto-shift advances it on a time boundary. Independent of `now`.
  const [viewStart, setViewStart] = useState(0)
  // `viewSpan` is the WIDTH of the shown window in ms — the live PINCH-ZOOM level (v0.2.303).
  // Defaults to VIEW_SPAN_MS (one day); the pinch handler drives it between the MIN/MAX bounds.
  const [viewSpan, setViewSpan] = useState(VIEW_SPAN_MS)
  // Refs mirror both so EVENT callbacks (pan/drag/zoom, which fire off-render) read the live values
  // without stale closures or added dep-array churn; render + memos read the state directly.
  const viewStartRef = useRef(0)
  const viewSpanRef = useRef(VIEW_SPAN_MS)
  useEffect(() => {
    // While a zoom glide is running, the glide OWNS these refs (stepZoom advances them toward the
    // eased target and nudgeZoom reads them for the cursor anchor). A pan flush that commits mid-glide
    // (setViewStart) must NOT overwrite them with the flushed pan value, or the anchor drifts and the
    // zoom snaps at commit (v0.2.312). The next gesture re-reads committed state via committedStartRef.
    if (zoomGlidingRef.current) return
    viewStartRef.current = viewStart
  }, [viewStart])
  useEffect(() => {
    if (zoomGlidingRef.current) return
    viewSpanRef.current = viewSpan
  }, [viewSpan])
  const prevNowRef = useRef(0)
  useEffect(() => {
    const n = Date.now()
    setMounted(true)
    setViewStart(dayWindow(n, viewSpanRef.current)[0])
    prevNowRef.current = n
  }, [])

  // AUTO-SHIFT — fires ONLY on a `now` transition (never on `viewStart`, so panning
  // can't trigger it). When time carries `now` past the window's right edge, jump to
  // the natural window containing `now`, landing the marker at the left edge.
  useEffect(() => {
    if (!mounted) return
    const prev = prevNowRef.current
    prevNowRef.current = now
    setViewStart((vs) => {
      const viewEnd = vs + viewSpanRef.current
      return prev < viewEnd && now >= viewEnd ? dayWindow(now, viewSpanRef.current)[0] : vs
    })
  }, [now, mounted])

  const winStart = viewStart

  // Hover key for ANY bar (planned or access) — drives its tooltip + highlight.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  // EDGE-EDIT GUIDES (v0.2.285) — while the cursor is over a resizable tick's edge handle, the
  // dayline fades in faint HOURLY vertical markers as a time reference for the (upcoming) drag; they
  // fade back out when no edge is hovered. `hourGuidesOn` drives the opacity transition. The OFF is
  // DEBOUNCED (~80ms) so sliding between a tick's two handles — which briefly crosses the non-handle
  // tick body — doesn't flicker the guides off and on.
  const [hourGuidesOn, setHourGuidesOn] = useState(false)
  const guideOffTimerRef = useRef<number | null>(null)
  const showHourGuides = useCallback(() => {
    if (guideOffTimerRef.current != null) {
      clearTimeout(guideOffTimerRef.current)
      guideOffTimerRef.current = null
    }
    setHourGuidesOn(true)
  }, [])
  const hideHourGuides = useCallback(() => {
    if (guideOffTimerRef.current != null) clearTimeout(guideOffTimerRef.current)
    guideOffTimerRef.current = window.setTimeout(() => {
      setHourGuidesOn(false)
      guideOffTimerRef.current = null
    }, 80)
  }, [])
  useEffect(() => {
    return () => {
      if (guideOffTimerRef.current != null) clearTimeout(guideOffTimerRef.current)
    }
  }, [])
  // Off-screen render headroom scales with the zoom level so a pan always has bars queued either side.
  const renderMargin = viewSpan * 1.5
  const lo = winStart - renderMargin
  const hi = winStart + viewSpan + renderMargin

  // PLANNED bars — SCHEDULED occurrences from the real entity graph (whole tree from
  // s_root), expanded across the window by the recurrence engine. Colored by the
  // entity's own `accent` (set via `:color:`), else an inherited space accent, else
  // neutral. `dataRev` re-derives after a create / `:color:` / `:start:` edit; `now`
  // is only a dep so a point exactly at "now" stays consistent with the marker.
  // One activity-log revision counter, used by the access/session memos — bumps whenever a segment is
  // logged/edited so they re-derive. (The planned rail no longer reads it: coverage was retired in .249.)
  const activityRevision = useActivityRevision()
  const planned = useMemo<DaylineBar[]>(() => {
    if (!mounted) return []
    const out: DaylineBar[] = []
    // TOP RAIL (v0.2.249) — sourced from getDaylineOccurrences, i.e. the SAME projectOccurrences engine
    // the §0 block uses. This is what makes additional series[] (.246), edited-instance times via
    // exceptions (.248), and the repeatAnchor decoupling (.247) finally show on the dayline — the old
    // getTimelineOccurrences walker was blind to all three. Each occ carries its dispatch identity
    // (occ.occRef) for the per-occurrence right-click menu.
    for (const occ of getDaylineOccurrences(lo, hi, now)) {
      const s = occ.schedule
      if (!s) continue
      // "whenever" has no fixed clock time, so it never anchors a planned dayline bar.
      const startNum = typeof s.startDate === "number" ? s.startDate : undefined
      // start / point / due — a due-only task anchors on its deadline and paints a point. May be
      // undefined for an END-ONLY occurrence (declared end, no start) — handled below.
      const st = startNum ?? s.at ?? s.dueDate
      // Effective end = declared endAt OR (concrete start + duration). A start+duration span
      // therefore paints a FIXED-LENGTH bar and never reads as ongoing — same rule the state
      // model uses (effectiveScheduleEnd). `endNum` is undefined only when there's genuinely
      // no known end (open-ended start, or a due/at point).
      const endNum = effectiveScheduleEnd(s) ?? undefined
      // Nothing to place when there's NEITHER a start anchor NOR a known end.
      if (st == null && endNum == null) continue
      // CLOSED occurrences are NOT ongoing, even without a declared `endAt`: a closed entity
      // can't still be running. If it lacks an `endAt`, terminate its bar at its actual close
      // time (`computeCloseAt`, the RECORD of when it ended) rather than letting it stretch to
      // now as an eternal ghost. (Covers a closed Moment/Space that had a start but no end and
      // no session — the case `closeSession`-on-close can't reach since there's no session.)
      const closed = isClosed(occ, now)
      const closeAt = closed && endNum == null ? computeCloseAt(occ, now) : undefined
      // ONGOING — an entity with a real start (in the past) but no end yet reads as still
      // running, so its tick GROWS from start to NOW, as if `:end:` were live-set to now. It
      // keeps extending each render until a real end is stamped. Only when the start is a
      // genuine `startAt` (not a due/at point), it's already begun, AND it isn't closed. A
      // start+duration has a known end (endNum) so it's NOT ongoing.
      const ongoing = !closed && endNum == null && startNum != null && startNum <= now
      // UNKNOWN END — a concrete start (real `startAt`) with no declared/implied end that
      // hasn't closed. Superset of `ongoing`: it ALSO covers a still-FUTURE open-ended start
      // (startNum > now), which paints as a start point with a rightward fade. Drives the
      // "continues, end unknown" fade in the render.
      const unknownEnd = !closed && endNum == null && startNum != null
      // UNKNOWN START (v0.2.249) — the mirror: a real end but NO start anchor at all (no `startAt`,
      // no `at`, no `dueDate`). Renders a LEFTWARD fade anchored at the end. Reachable via an
      // end-only entity (`:end:` with no `:start:`), which getDaylineOccurrences synthesizes.
      const unknownStart = endNum != null && st == null
      // end = effective end (declared/implied), else the record close time (closed), else now
      // (ongoing), else the start anchor (a point).
      const en = endNum ?? closeAt ?? (ongoing ? now : st!)
      // ANCHOR = the KNOWN edge the tick pins to: the start when we have one, else the end (end-only).
      const anchor = st ?? en
      if (en < lo || anchor > hi) continue
      const leftPct = ((anchor - winStart) / viewSpan) * 100
      // End-only ticks carry no width of their own — they're just the leftward fade tail ending at
      // the anchor; the render's `unknownStart` branch supplies the fade length.
      const widthPct = st == null ? 0 : ((en - anchor) / viewSpan) * 100
      // A sleep-titled DURATION moment paints a procedural night sky instead of a
      // flat accent bar (seeded per-occurrence so it's stable yet unique per night).
      const isSleepSpan = st != null && en > st && occ.kind === "moment" && isSleepTitle(occ.title)
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
        range: unknownStart
          ? `unset – ${fmtTime(en)}`
          : ongoing
            ? `${rangeText(st!, en, s.repeat)} · ongoing`
            : rangeText(st!, en, s.repeat),
        track: "planned",
        point: st != null && en <= st,
        // A planned INSTANT renders as a labelled filled glyph (see the render branch), not a
        // bare point tick.
        instant: occ.kind === "instant",
        // An ongoing bar's right edge IS "now" — flag it so it renders anchored (never
        // spilling a min-width tick PAST the now marker), same as an open access segment.
        openEnded: ongoing,
        // Fade rightward off the right edge when the end is unknown (ongoing → past now;
        // future open-ended → past the start point). Fade LEFT when the start is unknown.
        unknownEnd,
        unknownStart,
        sky: isSleepSpan ? sleepSkyBackground(occ.occKey) : undefined,
        // Per-occurrence dispatch identity for the top-rail right-click menu (v0.2.249).
        occRef: occ.occRef,
        // Absolute span (v0.2.286) — feeds the drag re-time. `st` is null only for an end-only
        // tick (never edge-editable); `en` is the effective end computed just above.
        startMs: st ?? undefined,
        endMs: en,
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winStart, lo, hi, now, mounted, dataRev])

  // SESSION bars — tracked work SESSIONS (`schedule.sessions`), the punch-in/out log behind
  // Play/Stop and dwell-focus. These are what make a "whenever" (no fixed clock time) entity
  // read `ongoing`, so they belong on the ACTIVITY rail even though they never anchor a
  // planned occurrence. We walk the WHOLE subtree (not just timed descendants, since the
  // whole point is un-clocked playables) and emit one bar per session touching the day:
  //   - OPEN session (no endAt) ��� an `openEnded` ongoing bar (right edge = now) that joins
  //     the vertical ongoing stack.
  //   - CLOSED session ⇒ a completed logged span.
  // Both PLAY and FOCUS sessions are shown (per product decision). Bars are clipped to the
  // day window so a session spanning midnight paints only today's slice.
  const sessions = useMemo<DaylineBar[]>(() => {
    if (!mounted) return []
    const out: DaylineBar[] = []
    // v0.6.22: iterate EVERY entity with sessions (not `collectDescendants`, which walks spaces
    // only and hid Resource/Task/Moment leaves from the recorded rail).
    for (const e of getEntitiesWithSessions()) {
      const list = e.schedule?.sessions
      if (!list || list.length === 0) continue
      const { fill, stroke } = paintFor(e.id)
      // v0.2.260 — COALESCE REMOVED (Loris): each stored session renders as its OWN tick, ALWAYS.
      // The old ≤SESSION_MERGE_GAP_MS same-entity merge made a stop→restart within the gap read as
      // ONE uninterrupted span (the first session's start extended to the open end). At a zoomed-in
      // VIEW_SPAN_MS that 60s gap is a large fraction of the window, so legitimate restarts a few
      // seconds apart got silently swallowed into one long tick — exactly the confusing "never
      // interrupted" behaviour. Every played session is now a standalone run; `count` stays 1 so the
      // "· N sessions" merged label never shows.
      type Run = { start: number; end: number; open: boolean; via?: string; auto?: boolean; count: number; anchorId?: number }
      const runs: Run[] = []
      for (const sess of [...list].sort((a, b) => a.startedAt - b.startedAt)) {
        // v0.2.257: the BOTTOM (PLAYED) rail shows EVERY played session — BOTH auto (started by
        // ENTERING an ongoing-on-enter kind) AND remote (a deliberate glyph/menu Play that survives
        // navigation). Both are start→stop played spans, so both render here identically. Skipped:
        // focus/legacy sessions (that's the MIDDLE access spine) and instant MARKs (now only the
        // glyph one-shot pulse, no dayline tick).
        if (sess.via !== "play") continue
        const sOpen = sess.endedAt == null
        const sEnd = sess.endedAt ?? now
        runs.push({ start: sess.startedAt, end: sEnd, open: sOpen, via: sess.via, count: 1, anchorId: sess.anchorId })
      }
      runs.forEach((run, i) => {
        // Every run here is a PLAYED span (auto OR remote) — the collection loop above kept all
        // `via:"play"` sessions and dropped only marks + focus/access sessions (the MIDDLE spine).
        const rawStart = run.start
        const open = run.open
        const rawEnd = open ? now : run.end
        if (rawEnd < lo || rawStart > hi) return // not in today's window
        // Clip to the visible day so a cross-midnight session shows only today's slice. v0.6.24:
        // `Math.min(rawStart, rawEnd)` guards the ≤1s window where a just-started play's start is a
        // hair ahead of the now marker, so the tick sits AT the marker, not a few px to its right.
        const st = Math.max(Math.min(rawStart, rawEnd), lo)
        const en = Math.min(rawEnd, hi)
        const leftPct = ((st - winStart) / viewSpan) * 100
        const widthPct = Math.max(0, ((en - st) / viewSpan) * 100)
        const kindLabel = "play"
        const merged = run.count > 1 ? ` · ${run.count} sessions` : ""
        out.push({
          key: `sess:${e.id}:${i}`,
          id: e.id,
          title: daylineLabel(e, st),
          color: fill,
          stroke,
          leftPct,
          widthPct,
          centerPct: leftPct + widthPct / 2,
          range: open
            ? `${rangeText(rawStart, rawEnd)} · ${kindLabel} · ongoing${merged}`
            : `${rangeText(rawStart, rawEnd)} · ${kindLabel}${merged}`,
    track: "recorded", // bottom rail — PLAYED sessions (auto + remote), v0.2.257
    // EDITABLE handle (v0.2.293): a CLOSED, anchored recorded session gets its anchorId so a right-click
    // opens Edit time / Delete. Open (live) runs and un-anchored legacy runs omit it ⇒ whole-entity menu.
    sessionAnchorId: !open && run.anchorId != null ? run.anchorId : undefined,
    // ABSOLUTE epochs for edge-drag re-time (v0.2.294) — the RAW (unclamped) span, matching how planned
    // ticks carry startMs/endMs. Only a CLOSED run has a fixed pair of edges to drag; an open (live) run
    // omits endMs so it can't be edge-edited (its right edge is the growing now-marker).
    startMs: rawStart,
    endMs: open ? undefined : rawEnd,
    point: en <= st,
          // Open run's right edge IS now → anchored + joins the ongoing stack.
          openEnded: open,
          // An OPEN session run is "happening now, end unknown" — trail the same rightward
          // fade as an open-ended planned bar (e.g. Cook). Closed runs (open===false) stay
          // crisp fixed-length spans. This is what makes `startAt:"whenever"` entities
          // (Zero/Edan), which appear on the dayline ONLY via this session path, read like Cook.
          unknownEnd: open,
        })
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winStart, lo, hi, now, mounted, dataRev, activityRevision])

  // SPINE bars — the MIDDLE rail (v0.6.21): the COLLAPSED-ACCESS leaf-spine. ACCESS sessions
  // (`via` focus / legacy undefined) are punched on EVERY entity on the path, so at any instant
  // the covering intervals are exactly root→leaf and the DEEPEST (latest-started) is the current
  // leaf. We FLATTEN all of them so only the deepest shows at each moment — a single continuous,
  // non-overlapping line: the LEAF-MOST ACCESSED entity over time. This is the MACHINE TRUTH of
  // where the user was (set purely on enter/exit, never user-editable) — the same access record
  // as the standalone ACTIVITY rail, just collapsed to the leaf. Only rendered on the combined lane.
  const spine = useMemo<DaylineBar[]>(() => {
    if (!mounted || !combined) return []
    // 1) Collect focus intervals (end = now while open) across EVERY entity with sessions.
    //    v0.6.22: was `collectDescendants(ROOT_ID)` which walks SPACES only, so a focused
    //    Resource/Task/Moment LEAF (e.g. the v0.app web resource) was invisible and the spine drew
    //    its parent Space instead of the true current leaf. v0.6.24: `end` uses the shared
    //    per-second `now` (same value the marker reads). `Math.max(now, startAt)` guards the ≤1s
    //    window where a just-punched session's start is a hair AHEAD of the last `now` tick, so the
    //    interval still survives (its right edge is clamped back to the marker at emit time).
    type Iv = { id: string; start: number; end: number; open: boolean }
    const ivs: Iv[] = []
    for (const e of getEntitiesWithSessions()) {
      const list = e.schedule?.sessions
      if (!list) continue
      for (const s of list) {
        if (s.via === "play" || s.via === "mark") continue // manual → bottom rail
        const open = s.endedAt == null
        const end = s.endedAt ?? Math.max(now, s.startedAt)
        if (end < s.startedAt) continue
        ivs.push({ id: e.id, start: s.startedAt, end, open })
      }
    }
    if (ivs.length === 0) return []
    // Structural DEPTH of an entity = its number of ancestors (root = 0). Memoized per derive.
    // (v0.2.249) Used to break start-ties in the flatten below.
    const depthCache = new Map<string, number>()
    const depthOf = (id: string): number => {
      const hit = depthCache.get(id)
      if (hit != null) return hit
      let d = 0
      let cur = getEntity(id)?.parentId ?? null
      const seen = new Set<string>()
      while (cur && !seen.has(cur)) {
        seen.add(cur)
        d += 1
        cur = getEntity(cur)?.parentId ?? null
      }
      depthCache.set(id, d)
      return d
    }
    // 2) FLATTEN by max-start-wins: sweep the sorted boundaries; in each gap the visible owner is
    //    the active interval with the greatest start (the deepest / most-recently-entered leaf).
    //    v0.2.249 LEAF FIX: a DIRECT jump to a deep entity punches focus on the WHOLE path
    //    (root→…→leaf) in one tick, so every covering interval shares one `startedAt` and ties on
    //    start. The old strict `v.start > win.start` then kept the FIRST-iterated (shallowest =
    //    PARENT) interval — the "spine shows the parent, not the leaf" bug. Break the start-tie by
    //    structural DEPTH so the deepest (true leaf) wins.
    const bounds = Array.from(new Set(ivs.flatMap((v) => [v.start, v.end]))).sort((a, b) => a - b)
    type Seg = { id: string; start: number; end: number; open: boolean }
    const flat: Seg[] = []
    for (let i = 0; i < bounds.length - 1; i++) {
      const a = bounds[i]
      const b = bounds[i + 1]
      if (b <= a) continue
      let win: Iv | null = null
      for (const v of ivs) {
        if (v.start <= a && v.end >= b) {
          if (
            win == null ||
            v.start > win.start ||
            (v.start === win.start && depthOf(v.id) > depthOf(win.id))
          )
            win = v
        }
      }
      if (!win) continue
      const prev = flat[flat.length - 1]
      // 3) Coalesce consecutive same-owner slivers into one segment.
      if (prev && prev.id === win.id && prev.end === a) {
        prev.end = b
        prev.open = win.open && win.end === b
      } else {
        flat.push({ id: win.id, start: a, end: b, open: win.open && win.end === b })
      }
    }
    // 4) Emit bars, clipped to the visible day window.
    const out: DaylineBar[] = []
    for (let i = 0; i < flat.length; i++) {
      const seg = flat[i]
      // An OPEN segment's right edge IS the now marker (`now`); a CLOSED one ends at its real end.
      const rightEdge = seg.open ? now : seg.end
      if (rightEdge < lo || seg.start > hi) continue
      // v0.6.24: clamp the visible start to `rightEdge` too, so in the ≤1s window where a just-
      // punched session's start is a hair ahead of the marker the tick sits AT the marker instead
      // of a few px to its RIGHT (the reported bug).
      const st = Math.max(Math.min(seg.start, rightEdge), lo)
      const en = Math.min(rightEdge, hi)
      // Keep an OPEN live segment even at ~0 width (renders as the min-width tick) so a
      // just-switched leaf shows instantly; only drop CLOSED zero-width slivers.
      if (en < st || (en === st && !seg.open)) continue
      const leftPct = ((st - winStart) / viewSpan) * 100
      const widthPct = Math.max(0, ((en - st) / viewSpan) * 100)
      const entity = getEntity(seg.id)
      const { fill, stroke } = paintFor(seg.id)
      // v0.6.22: the middle spine does NOT trail the unknown-end fade (`unknownEnd:false`) — it's
      // always "up to now" by construction, so a crisp right edge reads correctly and avoids the
      // fade's cost/lag.
      // `openEnded: seg.open` records whether this spine segment is still live (its right edge IS the
      // now marker). NB anchoring is decided at RENDER time (v0.2.255): EVERY middle-rail tick right-
      // anchors regardless of open/closed (see `anchorRight`), because the spine is always historical
      // (right edge ≤ now), so a min-width nub grows LEFTWARD into the past and never spills past now.
      // `unknownEnd` stays false so the spine never trails the unknown-end fade.
      out.push({
        key: `spine:${seg.id}:${seg.start}`,
        id: seg.id,
        title: entity ? daylineLabel(entity, st) : seg.id === ROOT_ID ? "Home" : "Elsewhere",
        color: fill,
        stroke,
        leftPct,
        widthPct,
        centerPct: leftPct + widthPct / 2,
        range: `${rangeText(seg.start, rightEdge)} · access${seg.open ? " · ongoing" : ""}`,
        track: "middle",
        point: false,
        openEnded: seg.open,
        unknownEnd: false,
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winStart, lo, hi, now, mounted, combined, dataRev, activityRevision])

  // ACCESS bars — tracked activity ("where I was"). Titles fold `titleAt` so a past
  // segment reads with the name the place had THEN. `activityRevision` (shared above)
  // re-derives on any log change; `now` grows the open segment + keeps it in step with
  // the marker.
  const access = useMemo<DaylineBar[]>(() => {
    if (!mounted) return []
    const nowMs = now
    const out: DaylineBar[] = []
    // Raw ordered segments (oldest → newest). Adjacency is computed on the FULL sequence
    // (not the windowed subset) so a session's rounded ends survive panning/clipping.
    const segs = getSegments()
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]
      const st = s.enteredAt
      const en = s.leftAt ?? nowMs
      if (en <= st) continue // zero/negative width — skip
      if (en < lo || st > hi) continue // fully outside the buffered window
      // SESSION ENDS — a tick starts a run when there's no contiguous predecessor (gap /
      // first ever), and ends a run when it's still open (its end is "now") or the next
      // segment didn't start exactly where this one left off.
      const prev = segs[i - 1]
      const next = segs[i + 1]
      const roundLeft = !prev || prev.leftAt == null || prev.leftAt !== s.enteredAt
      const roundRight = s.leftAt == null || !next || next.enteredAt !== s.leftAt
      const leftPct = ((st - winStart) / viewSpan) * 100
      const widthPct = ((en - st) / viewSpan) * 100
      const entity = getEntity(s.entityId)
      // Same paint model as the planned bar: fill = the place's own color, stroke = its
      // parent's color (a hairline, only when the place sits inside a Space).
      const { fill, stroke } = paintFor(s.entityId)
      out.push({
        key: `access:${s.entityId}:${s.enteredAt}`,
        id: s.entityId,
        // Historical title — the name the place carried at the segment's start (web resources
        // use their concise displayed title instead of the raw URL).
        title: entity ? daylineLabel(entity, st) : s.entityId === ROOT_ID ? "Home" : "Elsewhere",
        color: fill,
        stroke,
        leftPct,
        widthPct,
        centerPct: leftPct + widthPct / 2,
        range: rangeText(st, en),
        track: "access",
        point: false,
        openEnded: s.leftAt == null,
        roundLeft,
        roundRight,
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winStart, lo, hi, now, mounted, activityRevision])

  // One lookup for the hovered bar's tooltip, across every list that can render.
  const byKey = useMemo(() => {
    const m = new Map<string, DaylineBar>()
    for (const b of planned) m.set(b.key, b)
    for (const b of sessions) m.set(b.key, b)
    for (const b of spine) m.set(b.key, b)
    for (const b of access) m.set(b.key, b)
    return m
  }, [planned, sessions, spine, access])

  // LANE PACKING per rail. TOP (planned) packs by START so tiling declared spans share lane 0 and
  // only genuine overlaps open new lanes. BOTTOM (recorded) packs BY ENTITY (v0.2.260): all of an
  // entity's sessions share one lane so a stop→restart lines up with its earlier session, lanes
  // ordered most-populated-first (busiest entity nearest the seam). Concurrent ongoing sessions of
  // DIFFERENT entities still land on their own lanes (their [left,∞) intervals overlap at `now`).
  const plannedLanes = useMemo(
    () => packLanes(planned, (a, b) => a.leftPct - b.leftPct || b.widthPct - a.widthPct),
    [planned],
  )
  const recordedLanes = useMemo(() => packLanesByEntity(sessions), [sessions])
  // Combined-lane band geometry: the SEAM and total BAND HEIGHT grow with the busier rail's
  // sub-lane count (ticks keep full height; the band gets taller). Non-combined lanes keep the
  // resting single-lane height so the standalone ACTIVITY/ACCESS band is unchanged.
  const { seam, bandH, mid } = useMemo(
    () =>
      combined
        ? bandMetrics(plannedLanes.laneCount, recordedLanes.laneCount, true)
        : bandMetrics(1, 1),
    [combined, plannedLanes.laneCount, recordedLanes.laneCount],
  )
  // COLLAPSE-ON-STOP (v0.2.258, rewritten IMPERATIVELY in .261). When a PLAYED session's OPEN
  // (fading) tail closes, the faded tail RETRACTS toward the solid start edge instead of snapping.
  //
  // WHY IMPERATIVE (not React state): the two prior symptoms were (1) width SNAPPED because the two
  // endpoints were different CSS forms (`calc(%+20px)` → `max(3px,%)`) AND the `%` base itself jumps
  // (open width tracks [start, now]; closed tracks [start, endedAt]) — so even matched forms wouldn't
  // give a single-variable tween; and (2) the whole dayline only re-derives on the 1-second `now`
  // clock, so the shape update waited for the next tick. A FLIP fixes both: on the open→closed edge
  // we grab the DOM node by `data-barkey`, freeze its CURRENT on-screen PIXEL width (+ full fade
  // mask) as the from-frame, then next frame animate to the CLOSED pixel width (+ zero mask) under a
  // transition. Both endpoints are explicit px on the SAME node, so the browser interpolates cleanly,
  // immune to the shifting `%` base and independent of the per-second memo. GATED to the stop edge
  // only; panning / per-second growth / midnight-shift never run it (no `left` ever animates).
  const prevSessOpenRef = useRef<Map<string, boolean>>(new Map())
  // Last-known ON-SCREEN px width of every currently-OPEN session tick, stamped every render by the
  // layout effect below. The collapse effect needs the width the tick had JUST BEFORE it closed — by
  // the time the post-close `useEffect` runs, React has already committed the CLOSED geometry, so
  // measuring the node then reads the closed width (the bug that made the retract animate 10.6→10.6).
  const openWidthRef = useRef<Map<string, number>>(new Map())
  const COLLAPSE_MS = 520
  const COLLAPSE_EASE = "cubic-bezier(0.16, 1, 0.3, 1)" // strong expo-out (Loris)
  // ENTRANCE (v0.2.263): a session tick can only APPEAR on the per-second `sessions` re-derive (a new
  // Play start etc. can't exist before the memo re-runs — the ≤1s data-cadence pop Loris asked to
  // soften). We can't remove the cadence, but we fade+bounce the new node IN so the pop reads as a
  // deliberate entrance. `didInitRef` skips the very first commit (else EVERY tick bounces on load).
  const didInitRef = useRef(false)
  const ENTRANCE_MS = 460
  // overshoot ease (backOut-ish) for the little bounce
  const ENTRANCE_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)"
  useLayoutEffect(() => {
    const root = laneRef.current
    if (!root) return
    // Record the current px width of every OPEN tick. We DON'T prune closed keys here: this layout
    // effect runs BEFORE the collapse `useEffect` in the same commit, so on the close render the key
    // is already "not open" — pruning it would leave the collapse effect with no pre-close width (the
    // bug that made scaleFrom = 1 and killed the retract). The collapse effect deletes keys after use.
    //
    // ⚡ PERF (v0.2.262): dep = [sessions] — NOT bare (every render). `sessions` is a useMemo keyed on
    // the per-second `now`/dataRev/activityRevision, so it's referentially STABLE across the 30fps
    // smooth-clock re-renders; keying the effect to it makes this run ~1/sec instead of ~30/sec. The
    // bare version fired `getBoundingClientRect` (a FORCED SYNCHRONOUS REFLOW) on every open tick every
    // frame, which stacked with the rAF pan loop and was the dayline's pan-jank regression. ~1s-stale
    // open width is fine: the from-frame differs by at most one second of growth (≈1px at any zoom).
    for (const s of sessions) {
      const isOpen = !!(s.unknownEnd && !s.point && !s.markGlyph)
      if (!isOpen) continue
      const el = root.querySelector<HTMLElement>(`[data-barkey="${CSS.escape(s.key)}"]`)
      if (!el) continue
      openWidthRef.current.set(s.key, el.getBoundingClientRect().width)
    }
  }, [sessions])
  useEffect(() => {
    const prev = prevSessOpenRef.current
    const nextMap = new Map<string, boolean>()
    const justClosed: string[] = []
    const justAdded: string[] = []
    for (const s of sessions) {
      const isOpen = !!(s.unknownEnd && !s.point && !s.markGlyph)
      nextMap.set(s.key, isOpen)
      if (prev.get(s.key) === true && !isOpen) justClosed.push(s.key)
      if (!prev.has(s.key)) justAdded.push(s.key)
    }
    const firstRun = !didInitRef.current
    didInitRef.current = true
    prevSessOpenRef.current = nextMap
    const root = laneRef.current
    if (!root) return
    const anims: Animation[] = []
    // ENTRANCE — fade + little bounce for genuinely NEW ticks. Skipped on the FIRST commit (would
    // bounce the whole rail on load) and while a PAN is active (panning across the window edge pulls
    // in off-screen sessions as "new" keys — those should just appear, not pop). Either way the prev
    // map is already updated above, so a skipped tick is marked seen and won't bounce later.
    if (!firstRun && !panActiveRef.current) {
      for (const key of justAdded) {
        const el = root.querySelector<HTMLElement>(`[data-barkey="${CSS.escape(key)}"]`)
        if (!el) continue
        // ⚠️ v0.2.264: scale ONLY, NO translate in this `transform` keyframe — vertical centering is on
        // the CSS `translate` property (see the collapse note); a `translateY(-50%)` here stacked a
        // second -50% and made the new tick appear shifted UP into the access rail (Loris' report).
        // A bare `scale` about `left center` grows the tick in place; the `translate` centering is
        // untouched, so no vertical jump. New session ticks are always left-anchored (recorded).
        const anim = el.animate(
          [
            { opacity: 0, transform: "scale(0.55)", transformOrigin: "left center" },
            { opacity: 1, offset: 0.6 },
            { opacity: 1, transform: "scale(1)", transformOrigin: "left center" },
          ],
          { duration: ENTRANCE_MS, easing: ENTRANCE_EASE, fill: "none" },
        )
        anims.push(anim)
      }
    }
    if (justClosed.length === 0) return () => anims.forEach((a) => a.cancel())
    const laneW = root.getBoundingClientRect().width
    for (const key of justClosed) {
      const el = root.querySelector<HTMLElement>(`[data-barkey="${CSS.escape(key)}"]`)
      if (!el || laneW <= 0) continue
      // FROM width = the px width the tick had JUST BEFORE closing (recorded by the layout effect
      // while still open — measuring now reads the already-closed width, React having committed it).
      const openW = openWidthRef.current.get(key) ?? el.getBoundingClientRect().width
      openWidthRef.current.delete(key) // consumed
      // TO width = the CLOSED body width from the MODEL (data-wpct × lane px). v0.2.310: the render no
      // longer floors closed ticks at 3px (pure %), so this target must match — NO Math.max(3,…) floor,
      // else a sub-3px session would collapse to 3px while the render paints its true sub-pixel width
      // (a small end-of-collapse jump). Guard against 0 so scaleFrom stays finite for a ~0-width tick.
      const wpct = parseFloat(el.getAttribute("data-wpct") || "0")
      const closedW = Math.max(0.1, (wpct / 100) * laneW)
      if (!(openW > closedW + 0.5)) continue // nothing to retract
      // ANIMATE via scaleX on the `transform` property — NOT `width` (React owns inline width and
      // rewrites it on the stop re-render, snapping any width tween). ⚠️ v0.2.264: the keyframe must
      // carry ONLY scaleX, NO translate. Vertical centering here lives on the CSS **`translate`**
      // property (Tailwind v4 compiles `-translate-y-1/2` to `translate: 0 -50%`, NOT to `transform`).
      // `transform` and `translate` are SEPARATE composited properties — an earlier `translateY(-50%)`
      // inside this `transform` keyframe stacked a SECOND -50% on top of the class's translate, shoving
      // the tick a full height UP for the animation's duration (the "tick jumps up on stop" bug Loris
      // reported). With a bare scaleX the `translate`-based centering is untouched. Closed recorded
      // ticks are LEFT-anchored (start fixed; only the right fade tail retracts) ⇒ scale about the LEFT
      // edge from openW/closedW → 1. `fill:"none"` releases to the resting state (scaleX(1) == identity).
      const scaleFrom = openW / closedW
      const anim = el.animate(
        [
          { transform: `scaleX(${scaleFrom})`, transformOrigin: "left center" },
          { transform: "scaleX(1)", transformOrigin: "left center" },
        ],
        { duration: COLLAPSE_MS, easing: COLLAPSE_EASE, fill: "none" },
      )
      anims.push(anim)
    }
    return () => anims.forEach((a) => a.cancel())
  }, [sessions])

  const hovered = hoveredKey ? byKey.get(hoveredKey) ?? null : null

  // NOW marker position within the shown window; off-screen (outside 0–100) when panned.
  // Uses the SMOOTH rAF clock so the marker glides continuously instead of jumping each second
  // (v0.2.261). Open-tick right edges below read the same `smoothNow`, preserving marker-sync.
  const nowPct = ((smoothNow - winStart) / viewSpan) * 100
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
  // PINCH-ZOOM (v0.2.303, EASED v0.2.305) — a trackpad pinch arrives as ctrl+wheel. Rather than
  // snapping the span per event, each pinch delta nudges a TARGET span and a rAF loop GLIDES the live
  // span toward it with time-based ease-out — echoing the pan ripple's settle-to-rest feel. The loop
  // re-derives the cursor-anchored start every frame so the time under the cursor stays pinned while
  // the band eases. `zoomTargetSpanRef` = where we're gliding to; `zoomAnchorFracRef`/`zoomAnchorTimeRef`
  // pin the anchor; `zoomRafRef`/`zoomLastTsRef` drive the eased loop.
  const zoomTargetSpanRef = useRef(VIEW_SPAN_MS)
  const zoomAnchorFracRef = useRef(0.5)
  const zoomAnchorTimeRef = useRef(0)
  const zoomRafRef = useRef<number | null>(null)
  const zoomLastTsRef = useRef(0)
  // Cached lane rect for the DURATION of a pinch gesture (v0.2.307). A real trackpad pinch fires many
  // wheel events per frame; calling getBoundingClientRect() on each one forces a synchronous layout
  // reflow interleaved with the rAF's style writes = layout thrashing. We snapshot the rect on the
  // first delta of a gesture and reuse it until the glide comes to rest (the lane can't move mid-pinch).
  const zoomRectRef = useRef<{ left: number; width: number } | null>(null)
  // TRANSFORM-GLIDE (v0.2.308) — the eased zoom used to setViewSpan/setViewStart every frame, which on a
  // heavy entity re-ran all 6 geometry memos + reconciled every bar ~30x per gesture = the lag. Because
  // winStart===viewStart and time→x is LINEAR, a span/start change is an exact affine remap of the
  // frozen layout: x' = a·x + b. So during the gesture we FREEZE React state (memos don't recompute) and
  // each frame apply a cheap GPU `translateX(b) scaleX(a)` to both pan containers; we commit real state
  // ONCE at rest, where the existing applyPan/paintDayLabels layout-effect resets the transforms.
  //   zoomBaseStart/Span/Width = the frozen committed layout the transform maps FROM (pan folded in).
  const zoomGlidingRef = useRef(false)
  const zoomBaseStartRef = useRef(0)
  const zoomBaseSpanRef = useRef(VIEW_SPAN_MS)
  const zoomBaseWidthRef = useRef(1)
  // Mirror of the LAST COMMITTED React view state (updated in an effect below), so a glide can freeze the
  // exact layout the DOM currently shows as its transform base — viewStartRef/viewSpanRef diverge to the
  // live glide target during the gesture, so they can't serve as the base.
  const committedStartRef = useRef(0)
  const committedSpanRef = useRef(VIEW_SPAN_MS)
  // Base pan applied imperatively to both the access CONTENT (inside the fixed clip)
  // and the NOW marker + access tooltip (which live outside the clip for edge bleed).
  const contentPanRef = useRef<HTMLDivElement>(null)
  const markerPanRef = useRef<HTMLDivElement>(null)
  const applyPan = useCallback((px: number) => {
    const t = px ? `translateX(${px}px)` : ""
    if (contentPanRef.current) contentPanRef.current.style.transform = t
    if (markerPanRef.current) markerPanRef.current.style.transform = t
  }, [])
  // CURSOR-GLUED TOOLTIP (v0.2.273) — the tick tooltip now FOLLOWS the pointer (anchored just
  // below-right of the cursor) instead of sitting at the tick's fixed midpoint. Perf-critical:
  // the dayline is heavy and a hovered tick fires mousemove continuously, so positioning is done
  // IMPERATIVELY — React state (`hovered`) flips only on enter/leave (rare), while every move
  // writes `left`/`top` straight to the portaled node via `tooltipRef`, causing ZERO re-renders.
  // `cursorRef` holds the latest pointer position so the node can be placed correctly on its very
  // first paint (when `hovered` just turned truthy and no move has fired yet).
  const tooltipRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const placeTooltip = useCallback((clientX: number, clientY: number) => {
    cursorRef.current = { x: clientX, y: clientY }
    const el = tooltipRef.current
    if (!el) return
    // Below-right of the cursor, clamped to the viewport so it never runs off-screen. Flip to the
    // left of the cursor when it would overflow the right edge; nudge up when near the bottom.
    const OFF_X = 14
    const OFF_Y = 18
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = clientX + OFF_X
    if (left + w > window.innerWidth - 8) left = Math.max(8, clientX - OFF_X - w)
    let top = clientY + OFF_Y
    if (top + h > window.innerHeight - 8) top = Math.max(8, clientY - OFF_Y - h)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
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

  // Re-resolve which ACCESS bar sits under the (possibly stationary) cursor and sync
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
  // real on-screen X — one formula covers BOTH pan paths: `leftPct/100·w ��� wheelCommit`
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
      const gap = Math.max(2 * inset, LABEL_COLLIDE_GAP)
      const upper = i < items.length - 1 ? items[i + 1].x - items[i].wdt - gap : Infinity
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
        panActiveRef.current = false // ripple settled → let the smooth clock resume (v0.2.262)
        flushAtRestRef.current()
      }
    },
    [paintRipple],
  )

  const startRipple = useCallback(() => {
    panActiveRef.current = true // pause the smooth clock for the duration of the gesture (v0.2.262)
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

  // --- Occurrence RE-TIME drag (v0.2.286) -----------------------------------
  // Drag a planned tick's LEFT/RIGHT edge handle to resize (change one edge), or the tick BODY to
  // MOVE (reschedule, preserving duration). `editDragRef` holds the grabbed occurrence, its ORIGINAL
  // span, and the lane width captured at grab; `curStart/curEnd` are mutated live so pointerUp can
  // commit the final span without depending on the async `editPreview` state. `editPreview` mirrors
  // that live span into the render so the tick slides under the cursor before commit. `editDraggedRef`
  // guards the click-to-open that would otherwise fire when a MOVE drag ends on the body.
  // v0.2.294: the drag now serves BOTH rails. `occRef` (planned) and `sessionAnchorId` (recorded) are
  // mutually exclusive — exactly one is set per drag, and `endEdgeDrag` routes the commit accordingly
  // (onOccurrenceRetime vs onSessionRetime). All the geometry (origStart/origEnd/curStart/curEnd) is
  // rail-agnostic, so the move/resize math is shared verbatim.
  const editDragRef = useRef<{
    kind: "start" | "end" | "move"
    key: string
    entityId: string
    occRef?: DaylineOccRef
    sessionAnchorId?: number
    origStart: number
    origEnd: number
    startX: number
    laneW: number
    curStart: number
    curEnd: number
  } | null>(null)
  const [editPreview, setEditPreview] = useState<{ key: string; start: number; end: number } | null>(null)
  const editDraggedRef = useRef(false)

  const beginEdgeDrag = useCallback(
    (kind: "start" | "end" | "move", p: DaylineBar) => (e: React.PointerEvent) => {
      // A drag is armed for a PLANNED tick with an occRef + retime writer, OR a RECORDED tick with a
      // session anchor + session-retime writer (v0.2.294). Either way it needs two known epochs.
      const isOcc = p.track === "planned" && !!p.occRef && !!onOccurrenceRetime
      const isSession = p.track === "recorded" && p.sessionAnchorId != null && !!onSessionRetime
      if (e.button !== 0 || (!isOcc && !isSession) || p.startMs == null || p.endMs == null) return
      // A drag on an editable tick WINS over panning (stopPropagation keeps the lane's pointerdown
      // from starting a pan). We do NOT preventDefault, so a no-move press still fires the button's
      // click → opens the entity; a real drag is gated out of that click by `editDraggedRef`.
      e.stopPropagation()
      const lane = laneRef.current
      if (!lane) return
      editDragRef.current = {
        kind,
        key: p.key,
        entityId: p.id,
        occRef: isOcc ? p.occRef : undefined,
        sessionAnchorId: isSession ? p.sessionAnchorId : undefined,
        origStart: p.startMs,
        origEnd: p.endMs,
        startX: e.clientX,
        laneW: lane.clientWidth || 1,
        curStart: p.startMs,
        curEnd: p.endMs,
      }
      editDraggedRef.current = false
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      // Pin this tick as hovered + seed the tooltip position so its live start/end card is present
      // for the whole drag even if the pointer visually slips off the tick edge (v0.2.287).
      setHoveredKey(p.key)
      placeTooltip(e.clientX, e.clientY)
      showHourGuides()
    },
    [onOccurrenceRetime, onSessionRetime, showHourGuides, placeTooltip],
  )
  const moveEdgeDrag = useCallback((e: React.PointerEvent) => {
    const d = editDragRef.current
    if (!d) return
    e.stopPropagation()
    const dx = e.clientX - d.startX
    if (Math.abs(dx) > 2) editDraggedRef.current = true
    // px → ms via the same scale panning uses: the live view span across the lane's pixel width.
    const deltaMs = (dx / d.laneW) * viewSpanRef.current
    let start = d.origStart
    let end = d.origEnd
    if (d.kind === "move") {
      start = roundToMinute(d.origStart + deltaMs)
      end = start + (d.origEnd - d.origStart) // preserve duration
    } else if (d.kind === "start") {
      start = Math.min(roundToMinute(d.origStart + deltaMs), d.origEnd - MIN_OCC_MS)
    } else {
      end = Math.max(roundToMinute(d.origEnd + deltaMs), d.origStart + MIN_OCC_MS)
    }
    d.curStart = start
    d.curEnd = end
    setEditPreview({ key: d.key, start, end })
    // Keep the entity tooltip glued to the cursor during the drag (its start/end text updates live
    // from `editPreview` in the render — v0.2.287).
    placeTooltip(e.clientX, e.clientY)
  }, [placeTooltip])
  const endEdgeDrag = useCallback(
    (e: React.PointerEvent) => {
      const d = editDragRef.current
      editDragRef.current = null
      if (!d) return
      e.stopPropagation()
      const el = e.currentTarget as HTMLElement
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
      hideHourGuides()
      // Commit only a REAL drag (past the tiny threshold) + only if the span actually changed. Route to
      // the correct rail's writer (v0.2.294): planned → onOccurrenceRetime, recorded → onSessionRetime.
      if (editDraggedRef.current && (d.curStart !== d.origStart || d.curEnd !== d.origEnd)) {
        if (d.sessionAnchorId != null) onSessionRetime?.(d.entityId, d.sessionAnchorId, d.curStart, d.curEnd)
        else if (d.occRef) onOccurrenceRetime?.(d.entityId, d.occRef, d.curStart, d.curEnd)
      }
      setEditPreview(null)
      // Keep the suppress flag up through the click that fires immediately after this pointerUp
      // (a MOVE drag ends on the body, whose onClick would otherwise open the entity), then clear it.
      requestAnimationFrame(() => {
        editDraggedRef.current = false
      })
    },
    [onOccurrenceRetime, onSessionRetime, hideHourGuides],
  )

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
      setViewStart(d.startView - (dx / w) * viewSpanRef.current)
      resolveHoverAtCursor()
    },
    [pctToCol, injectPan, resolveHoverAtCursor],
  )
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null
    if (laneRef.current?.hasPointerCapture(e.pointerId)) laneRef.current.releasePointerCapture(e.pointerId)
  }, [])
  const recenter = useCallback(() => setViewStart(dayWindow(Date.now(), viewSpanRef.current)[0]), [])

  // One eased frame of the zoom glide (v0.2.305). Moves the LIVE span a fraction of the way toward
  // `zoomTargetSpanRef` in LOG space (so the ease feels uniform to the eye — perceived zoom is
  // multiplicative), with a time-based alpha = 1−exp(−dt/τ) that decelerates into rest like the pan
  // ripple. Re-derives the cursor-anchored start each frame so the anchored time stays pinned while
  // the band settles. Snaps + stops when within a hair of the target.
  // Freeze the current committed layout as the transform base (v0.2.308). Any un-flushed wheel-pan
  // (px) shifts the displayed start, so fold it into the base start — then replacing the pan transform
  // with the zoom transform is seamless. Also seed the live refs to this displayed base so the anchor
  // math in nudgeZoom is consistent from the first delta.
  const beginZoomGlide = useCallback(() => {
    const lane = laneRef.current
    const W = zoomRectRef.current?.width || lane?.clientWidth || 1
    const cSpan = committedSpanRef.current
    const panPx = wheelCommitRef.current
    zoomBaseWidthRef.current = W
    zoomBaseSpanRef.current = cSpan
    zoomBaseStartRef.current = committedStartRef.current + (panPx * cSpan) / W
    viewSpanRef.current = cSpan
    viewStartRef.current = zoomBaseStartRef.current
    zoomGlidingRef.current = true
    // CONSUME the un-flushed pan (v0.2.312). We just folded `panPx` into the frozen base, so the
    // display is already correct — but the leftover wheelCommit/pendingFlush must NOT survive, or a
    // LATER pan flush will commit that same offset a SECOND time into viewStart. The classic trigger:
    // starting a zoom while the ripple is still settling; when the ripple loop reaches rest it calls
    // flushAtRest → flushWheelPan, which (with a non-zero residual) shifts viewStart to "where the pan
    // would have ended" AFTER the glide commits = the horizontal END-snap. Zeroing here makes that
    // flush a no-op. A pending setViewStart that was already queued still lands and reconciles
    // committedStart to the folded base (the fold's intent); pendingFlush=0 keeps the layout effect
    // from double-subtracting.
    wheelCommitRef.current = 0
    pendingFlushRef.current = 0
  }, [])

  // Remap the FROZEN layout to a desired (curStart, curSpan) via the exact affine x' = a·x + b, applied
  // as one cheap GPU transform to both pan containers. Bars scale correctly; the 1px marker lines scale
  // transiently (snap back at rest). Day labels live OUTSIDE the pans, so translate them CRISPLY (no
  // scale) by the same affine so text stays sharp.
  const applyZoomTransform = useCallback((curStart: number, curSpan: number) => {
    const W = zoomBaseWidthRef.current || 1
    const a = zoomBaseSpanRef.current / curSpan
    const b = (W * (zoomBaseStartRef.current - curStart)) / curSpan
    const t = `translateX(${b}px) scaleX(${a})`
    if (contentPanRef.current) contentPanRef.current.style.transform = t
    if (markerPanRef.current) markerPanRef.current.style.transform = t
    // Day labels must use the SAME sticky-push clamp as paintDayLabels (v0.2.312 fix): the raw affine
    // x sends the left-most past boundary's label negative, so a plain `x<-2 ⇒ hide` made "AUG 16"
    // vanish during the glide and snap back to x=0 only at commit. Replicate the clamp here — each
    // boundary's on-screen x is a·(leftPct/100·W)+b (the affine equivalent of paintDayLabels' formula),
    // then sorted left→right and clamped to [0, nextBoundaryX − ownWidth] so the pinned label stays at
    // the left edge throughout the glide instead of disappearing.
    const inset = minimized ? LABEL_MARKER_GAP : 0
    const labelItems: { el: HTMLElement; x: number; wdt: number }[] = []
    for (const el of dayLabelNodesRef.current.values()) {
      const leftPct = +(el.dataset.left ?? "") || 0
      labelItems.push({ el, x: a * ((leftPct / 100) * W) + b, wdt: el.offsetWidth })
    }
    labelItems.sort((p, q) => p.x - q.x)
    for (let i = 0; i < labelItems.length; i++) {
      const nat = labelItems[i].x
      const gap = Math.max(2 * inset, LABEL_COLLIDE_GAP)
      const upper = i < labelItems.length - 1 ? labelItems[i + 1].x - labelItems[i].wdt - gap : Infinity
      const x = Math.min(Math.max(nat, 0), upper)
      labelItems[i].el.style.transform = `translateX(${x + inset}px)`
      const off = x + labelItems[i].wdt <= 0 || nat >= W
      labelItems[i].el.style.opacity = off ? "0" : "1"
    }
  }, [minimized])

  // One eased frame (v0.2.305; TRANSFORM-GLIDE v0.2.308). Ease the span in LOG space toward the target,
  // re-anchor the cursor time, and — the key change — DON'T setState mid-glide. Instead remap the frozen
  // layout with a transform (no memo recompute, no bar reconcile). Commit real state ONCE at rest, where
  // the [viewStart] layout effect resets the transforms (applyPan) + repaints day labels.
  const stepZoom = useCallback((ts: number) => {
    let dt = (ts - zoomLastTsRef.current) / 1000
    zoomLastTsRef.current = ts
    if (!(dt > 0)) dt = 1 / 60
    dt = Math.min(dt, 0.05)
    const ZOOM_TAU = 0.11 // seconds — smaller = snappier, larger = more glide
    const alpha = 1 - Math.exp(-dt / ZOOM_TAU)
    const curLog = Math.log(viewSpanRef.current)
    const tgtLog = Math.log(zoomTargetSpanRef.current)
    const diff = tgtLog - curLog
    const nextSpan = Math.abs(diff) < 0.002 ? zoomTargetSpanRef.current : Math.exp(curLog + diff * alpha)
    const nextStart = zoomAnchorTimeRef.current - zoomAnchorFracRef.current * nextSpan
    viewSpanRef.current = nextSpan
    viewStartRef.current = nextStart
    if (nextSpan === zoomTargetSpanRef.current) {
      // AT REST — commit the real geometry once (single re-layout). The pan was folded into the glide
      // base, so zero wheelCommit; the layout effect then resets both pan transforms + repaints labels.
      // Do the expensive hover hit-test (elementFromPoint = sync reflow + tooltip repaint) only now.
      zoomGlidingRef.current = false
      zoomRafRef.current = null
      zoomRectRef.current = null // gesture over — re-measure the lane next time
      wheelCommitRef.current = 0
      setViewSpan(nextSpan)
      setViewStart(nextStart)
      resolveHoverAtCursor()
    } else {
      applyZoomTransform(nextStart, nextSpan)
      zoomRafRef.current = requestAnimationFrame(stepZoom)
    }
  }, [applyZoomTransform, resolveHoverAtCursor])

  // Feed one pinch delta into the glide (v0.2.305): nudge the TARGET span (clamped, with a detent at
  // the canonical day view), re-anchor to the time currently under the cursor, and ensure the eased
  // loop is running. On the FIRST delta of a gesture, freeze the transform base first so the anchor
  // reads the actual displayed start/span.
  const nudgeZoom = useCallback((deltaY: number, clientX: number) => {
    const lane = laneRef.current
    if (!lane) return
    // Measure the lane ONCE per gesture (see zoomRectRef); reuse the snapshot for every subsequent delta.
    let rect = zoomRectRef.current
    if (!rect) {
      const r = lane.getBoundingClientRect()
      rect = { left: r.left, width: r.width || 1 }
      zoomRectRef.current = rect
    }
    const starting = zoomRafRef.current == null
    if (starting) beginZoomGlide() // freeze base BEFORE the anchor math reads viewStartRef/viewSpanRef
    const w = rect.width
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / w))
    // Anchor = the time under the cursor RIGHT NOW (from the live displayed state), so the glide keeps
    // it pinned even as more deltas arrive mid-flight.
    zoomAnchorFracRef.current = frac
    zoomAnchorTimeRef.current = viewStartRef.current + frac * viewSpanRef.current
    // Grow/shrink the target from its own last value (not the mid-glide live span), so rapid deltas
    // accumulate toward a far target rather than fighting the easing.
    const base = starting ? viewSpanRef.current : zoomTargetSpanRef.current
    let target = Math.min(MAX_VIEW_SPAN_MS, Math.max(MIN_VIEW_SPAN_MS, base * Math.exp(deltaY * ZOOM_SENSITIVITY)))
    if (Math.abs(target - VIEW_SPAN_MS) / VIEW_SPAN_MS < 0.04) target = VIEW_SPAN_MS // detent on the day
    zoomTargetSpanRef.current = target
    if (starting) {
      zoomLastTsRef.current = performance.now()
      zoomRafRef.current = requestAnimationFrame(stepZoom)
    }
  }, [beginZoomGlide, stepZoom])

  const flushWheelPan = useCallback(() => {
    const lane = laneRef.current
    if (!lane) return
    if (pendingFlushRef.current !== 0) return
    const commit = wheelCommitRef.current
    if (!commit) return
    const w = lane.clientWidth || 1
    pendingFlushRef.current = commit
    setViewStart((vs) => vs + (commit / w) * viewSpanRef.current)
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
      // PINCH-ZOOM (v0.2.303, EASED v0.2.305) — a trackpad pinch is delivered as a wheel event with
      // `ctrlKey` set (the browser/OS synthesizes it; a real Ctrl+scroll is the same gesture intent =
      // zoom). Spread fingers ��� deltaY < 0 ⇒ SMALLER span ⇒ zoom IN; pinch together ⇒ zoom OUT. Each
      // delta feeds a TARGET the band eases toward (see nudgeZoom), so it glides instead of snapping.
      if (e.ctrlKey) {
        e.preventDefault()
        wheelVelRef.current = 0
        // Fully STOP the momentum-pan loop before the zoom takes over (v0.2.312). Zeroing the velocity
        // isn't enough: the glide rAF stays scheduled and fires one more frame that (a) stomps the zoom
        // transform via applyPan and (b) triggers maybeFlushAtRest → setViewStart, whose [viewStart]
        // effects then clobber viewStartRef (the glide's anchor ref) and re-paint the pan — corrupting
        // the glide bookkeeping so it SNAPS horizontally at commit. Cancelling here lets beginZoomGlide
        // fold the leftover wheelCommit into the frozen base cleanly and own the transform exclusively.
        if (wheelRafRef.current != null) {
          cancelAnimationFrame(wheelRafRef.current)
          wheelRafRef.current = null
          wheelTsRef.current = 0
        }
        lastPointerRef.current = { x: e.clientX, y: e.clientY }
        pointerInsideRef.current = true
        nudgeZoom(e.deltaY, e.clientX)
        return
      }
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
      if (zoomRafRef.current != null) cancelAnimationFrame(zoomRafRef.current)
      zoomRafRef.current = null
      wheelRafRef.current = null
      wheelVelRef.current = 0
      wheelCommitRef.current = 0
      pendingFlushRef.current = 0
      wheelTsRef.current = 0
    }
  }, [pctToCol, injectPan, flushWheelPan, maybeFlushAtRest, applyPan, resolveHoverAtCursor, nudgeZoom])

  useLayoutEffect(() => {
    if (pendingFlushRef.current !== 0) {
      wheelCommitRef.current -= pendingFlushRef.current
      pendingFlushRef.current = 0
    }
    // Keep the pendingFlush bookkeeping above, but while a zoom glide owns the transform, do NOT
    // reset the pan / repaint labels — that would stomp the zoom's translateX·scaleX for a frame and
    // fight the glide (v0.2.312). The glide re-applies its transform every frame and cleans up at rest.
    if (zoomGlidingRef.current) return
    applyPan(-wheelCommitRef.current)
    // Re-place the sticky day labels after any base-pan settle (drag, wheel flush,
    // initial mount) — the ripple loop is not running at rest, so paint them here.
    paintDayLabels()
  }, [viewStart, applyPan, paintDayLabels])

  // Keep the committed-state mirror current so a zoom glide can freeze the exact layout the DOM shows
  // (viewStartRef/viewSpanRef diverge to the live glide target during the gesture). See zoom refs above.
  useEffect(() => {
    committedStartRef.current = viewStart
    committedSpanRef.current = viewSpan
  }, [viewStart, viewSpan])

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
  // The ACTIVITY access lane is intentionally left plain for now.
  const dayMarkers = useMemo(() => {
    if (!mounted || isAccess) return [] as { key: string; leftPct: number; label: string }[]
    const out: { key: string; leftPct: number; label: string }[] = []
    const firstMidnight = new Date(lo)
    firstMidnight.setHours(0, 0, 0, 0)
    for (let t = firstMidnight.getTime(); t <= hi; t += DAY_MS) {
      out.push({ key: `day:${t}`, leftPct: ((t - winStart) / viewSpan) * 100, label: shortDay(t) })
    }
    return out
  }, [mounted, isAccess, lo, hi, winStart, shortDay])

  // HOURLY EDIT-GUIDE MARKERS (v0.2.285) — one faint 1px line per HOUR boundary across the buffered
  // window, used only as a time reference while dragging a tick edge (they fade in on edge-hover, see
  // `hourGuidesOn`). Same leftPct geometry as the day markers; rendered behind the ticks inside the
  // pan container so they slide/clip with the timeline. Planned lane only (access lane stays plain).
  const hourMarkers = useMemo(() => {
    if (!mounted || isAccess) return [] as { key: string; leftPct: number }[]
    const out: { key: string; leftPct: number }[] = []
    const first = new Date(lo)
    first.setMinutes(0, 0, 0)
    for (let t = first.getTime(); t <= hi; t += HOUR_MS) {
      out.push({ key: `hr:${t}`, leftPct: ((t - winStart) / viewSpan) * 100 })
    }
    return out
  }, [mounted, isAccess, lo, hi, winStart])

  // Reposition the sticky day labels when they REMOUNT (toggling `minimized` swaps their
  // host container: above-band strip ⇄ in-band overlay) or when the marker SET changes.
  // The base-pan layout effect above only fires on a `viewStart` change, so these two
  // paths would otherwise leave freshly-mounted labels untransformed until the next pan.
  useLayoutEffect(() => {
    paintDayLabels()
  }, [minimized, dayMarkers, paintDayLabels])

  // Header CONTENT, shared between the two layouts. PLANNED = the sticky-push day-label
  // rail (one abs-positioned label per midnight boundary, placed imperatively by
  // `paintDayLabels`); ACCESS = the "x tracked" total. Registered via `registerDayLabel`
  // regardless of where it's mounted, so the imperative positioning is identical whether
  // the strip sits above the band (full) or overlaid inside it (minimized).
  const headerContent = isAccess ? (
    <span>{trailing}</span>
  ) : (
    dayMarkers.map((dm) => (
      <span
        key={dm.key}
        ref={registerDayLabel(dm.key)}
        data-left={dm.leftPct}
        className="absolute left-0 flex items-center whitespace-nowrap leading-none will-change-transform"
        // On the COMBINED lane, center the label across the WHOLE planned rail region [0, seam]
        // (band top → seam) so it has symmetric top/bottom margins, and it STAYS anchored to the
        // planned rail as more sub-lanes grow the band downward. This `height: seam` anchoring is
        // ONLY meaningful for the MINIMIZED in-band overlay; in MAXIMIZED mode these labels sit in
        // a separate `h-3` strip ABOVE the band, so anchoring to `seam` (~20px in the three-rail
        // lane) overflowed the 12px strip and clipped the text. Maximized just fills the strip.
        style={combined && minimized ? { top: 0, height: seam } : { top: 0, bottom: 0 }}
      >
        {dm.label}
      </span>
    ))
  )

  // LIVE TOOLTIP DURING DRAG (v0.2.287) — while an occurrence is being edge/move-dragged, the card
  // shows THAT tick (even if the pointer slipped off it) and its range text is recomputed live from
  // the `editPreview` span, so the entity's start/end update in real time as you drag.
  const tipBar = (editPreview ? byKey.get(editPreview.key) ?? null : null) ?? hovered
  const tipRange =
    tipBar && editPreview && editPreview.key === tipBar.key
      ? rangeText(editPreview.start, editPreview.end)
      : tipBar?.range

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
        // the two frames separate identically. The ACCESS lane never carries it (it flows
        // into its tracked list, and ActivityBody owns ACTIVITY's separator). Dropped when
        // the next frame is also minimized, so two adjacent minimized bands merge.
        !isAccess && !hideBottomBorder && "border-b border-border",
        // Extra bottom padding only in full mode; minimized uses the tight padding above.
        !minimized && (isAccess ? "pb-1" : "pb-3"),
      )}
    >
      {/* ABOVE-BAND HEADER STRIP (faded) — only when NOT minimized. The old "now" button is
          gone (double-click the band still recenters); the live full date+time lives in the
          glued-top clock. When minimized, this same content is overlaid INSIDE the band. */}
      {!minimized &&
        (isAccess ? (
          <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
            {headerContent}
          </div>
        ) : (
          <div className="relative mb-2 h-3 overflow-hidden text-[10px] uppercase tracking-wider text-muted-foreground/60">
            {headerContent}
          </div>
        ))}
      {/* Lane row. Full mode reserves at LEAST the constant DAYLINE_ROW_H (34px) so the resting
          single-lane band sits at a stable height — but when the COMBINED band grows past that
          (multi sub-lane packing, `bandH` from bandMetrics), the row reserves the FULL band height
          so the maximized frame expands with it instead of clipping the extra lanes. Minimized
          lets the row wrap the lane exactly so there's no dead space below the band. */}
      <div className="relative" style={minimized ? undefined : { height: Math.max(DAYLINE_ROW_H, bandH) }}>
        <div
          ref={laneRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onMouseEnter={() => (pointerInsideRef.current = true)}
          onMouseLeave={() => (pointerInsideRef.current = false)}
          onDoubleClick={recenter}
          className="relative w-full cursor-default select-none overflow-visible rounded-md border border-border/60 bg-card/40 [touch-action:none]"
          // Combined lane GROWS with its busiest rail (band height from bandMetrics); other
          // lanes keep the resting single-lane band height (was the fixed `h-7` = 28px).
          style={{ height: bandH }}
        >
          {/* IN-BAND HEADER OVERLAY (minimized only) — the same faded header content that
              normally sits ABOVE the band is overlaid INSIDE it, vertically CENTERED
              (`inset-y-0 flex items-center`), so a minimized frame is just the band. The
              access "x tracked" total is a flex child (respects `pl-2`); the planned day
              labels are absolute and get their marker gap from LABEL_MARKER_GAP in the
              transform. Non-interactive + clipped so it never blocks panning and trims to
              the band; `z-10` keeps it above the ticks. */}
          {minimized && (
            <div className="pointer-events-none absolute inset-y-0 inset-x-0 z-10 flex items-center overflow-hidden pl-2 text-[9px] uppercase leading-none tracking-wider text-muted-foreground/60">
              {headerContent}
            </div>
          )}
          {/* HOVER TOOLTIP (v0.2.273) — ONE cursor-following card for BOTH minimized and full
              mode (previously two separate renders: a portaled midpoint tooltip for minimized +
              an in-flow pan-following helper for full). PORTALED to <body> in fixed/viewport
              coords so it always bleeds past the canvas's `overflow-hidden` collapse wrapper.
              Position is written IMPERATIVELY via `tooltipRef` (see `placeTooltip`) on every
              pointer move — React only mounts/unmounts it on hover enter/leave, so moving the
              cursor over a tick never re-renders the heavy dayline. Initial paint uses the last
              `cursorRef` position; `left/top: 0` are placeholders overwritten synchronously. */}
          {tipBar &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                ref={tooltipRef}
                className="pointer-events-none fixed z-[60] flex max-w-[40vw] items-center gap-1.5 whitespace-nowrap rounded border border-border/70 bg-card px-2 py-1 text-[10.5px] font-medium leading-none tracking-tight text-foreground/80 shadow-sm"
                style={{ left: cursorRef.current.x + 14, top: cursorRef.current.y + 18 }}
              >
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full border"
                  style={{
                    backgroundColor: tipBar.color === ROOT_SENTINEL_COLOR ? "var(--background)" : tipBar.color,
                    borderColor: tipBar.stroke ?? "var(--border)",
                  }}
                />
                {tipBar.track === "access" && <span className="shrink-0 text-muted-foreground">in</span>}
                <span className="truncate text-foreground">{tipBar.title}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{tipRange}</span>
              </div>,
              document.body,
            )}
          {/* CLIP layer — fixed to the lane so it always trims to the true bounds. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
            {/* CONTENT PAN — the in-progress wheel pan is applied here as an imperative
                translateX; the bars slide within the fixed clip window. PLANNED bars
                (colored) sit in the main body; ACCESS (white ticks) lines the bottom. */}
            {/* RAIL SEAM — a faint 1px hairline at the seam between the PLANNED rail (above)
                and the RECORDED rail (below), spanning the full band width. Combined TODAY lane
                only; painted as a STATIC overlay (outside the panning container) so it stays
                full-width and doesn't slide with the timeline. */}
            {combined && (
              <div
                className="pointer-events-none absolute inset-x-0 h-px bg-muted-foreground/10"
                style={{ top: seam, zIndex: 0 }}
                aria-hidden
              />
            )}
            {/* origin-left (v0.2.308): the zoom glide applies scaleX with the affine x'=a·x+b, which
                assumes scaling about the LEFT edge (x=0). CSS defaults transform-origin to center, which
                added a constant (1−a)·(W/2) offset for the whole glide that vanished at commit = a big
                end-of-zoom SNAP. Pinning the origin left makes the transform match the committed layout. */}
            <div ref={contentPanRef} className="pointer-events-none absolute inset-0 origin-left will-change-transform">
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
              {/* HOURLY EDIT-GUIDES (v0.2.285) — always mounted (so the fade-IN can animate), the whole
                  layer's opacity is toggled by `hourGuidesOn` (cursor over a tick's edge handle). It
                  sits inside the pan container so the lines slide with the timeline; behind the ticks
                  (zIndex 1) and below the brighter midnight lines (zIndex 2). Non-interactive. */}
              {hourMarkers.length > 0 && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 transition-opacity duration-300 ease-out will-change-[opacity]"
                  style={{ opacity: hourGuidesOn ? 1 : 0, zIndex: 1 }}
                >
                  {hourMarkers.map((hm) => (
                    <div
                      key={hm.key}
                      className="absolute inset-y-0 w-px bg-muted-foreground/15"
                      style={{ left: `${hm.leftPct}%` }}
                    />
                  ))}
                </div>
              )}
              {/* TICK BAND — ONE generic loop for BOTH tracks. Each instance paints its
                  own list (`planned` scheduled occurrences OR `access` tracked segments);
                  the COMBINED TODAY lane paints both. A rounded chip (or a thin point for a
                  zero-length occurrence) whose FILL is the entity color (sleep paints a
                  night-sky, root → theme background) and whose HAIRLINE is the parent color.
                  All ticks are vertically CENTERED; on the combined lane the tracks are
                  told apart by HEIGHT (planned taller, access shorter). */}
              {mounted &&
                (combined ? [...planned, ...sessions, ...spine] : isAccess ? access : planned).map((p) => {
                  const isHot = hoveredKey === p.key
                  // LIT — this tick's entity is the one being HOVERED in ENTITY CONTENT
                  // (hover-only; cleared on navigation, so never lit merely for being open).
                  // Grows + fully opaque.
                  const lit = highlightId != null && p.id === highlightId
                  const isAccessTick = !combined && isAccess
                  // THREE-RAIL assignment on the combined lane (v0.6.21): MIDDLE = the collapsed-
                  // ACCESS leaf-spine (`spine:` keys, track "middle"), centered on the seam; BOTTOM
                  // (recorded) = manual PLAY + MARK sessions (`sess:` keys from the sessions
                  // memo); TOP (planned) = everything else (declared occurrences).
                  const isMiddle = combined && p.track === "middle"
                  const isRecorded = combined && p.key.startsWith("sess:")
                  const lane = combined
                    ? isMiddle
                      ? laneGeom("middle", 0, seam, mid)
                      : isRecorded
                        ? laneGeom("recorded", recordedLanes.laneOf.get(p.key) ?? 0, seam, mid)
                        : laneGeom("planned", plannedLanes.laneOf.get(p.key) ?? 0, seam, mid)
                    : undefined
                  // HEIGHT. A LIT/hovered tick pops (capped so it doesn't spill the rail). On
                  // the combined lane every tick uses its packed lane height. A standalone lane
                  // uses the access/highlight/base heights.
                  const baseH = isHot ? 13 : 9
                  const tickH = combined
                    ? lit || isHot
                      ? // MIDDLE (access spine) pops slightly TALLER than the others on hover (v0.2.255).
                        Math.max(lane?.height ?? 0, isMiddle ? 15 : isRecorded ? 12 : 13)
                      : lane?.height ?? PLANNED_LANE_H
                    : lit
                      ? HIGHLIGHT_HEIGHT_PX
                      : isAccessTick
                        ? ACCESS_HEIGHT_PX
                        : baseH
                  // VERTICAL ANCHOR (`top`, the center the `-translate-y-1/2` pins the tick on).
                  // Combined lane is laid out in BAND PIXELS so the two rails TOUCH at the seam:
                  // each tick centers on its packed lane center (planned above the seam, recorded
                  // below). A non-combined lane keeps a single centered band ("50%").
                  const railTop: string | number = !combined ? "50%" : lane?.center ?? seam - tickH / 2
                  // ROUNDING. A point stays a dot. A PLANNED bar keeps all four corners soft.
                  // An ACCESS bar rounds ONLY the ends of its session run: left corners on the
                  // first tick, right corners on the last; interior ticks are fully square so a
                  // run reads as one pill. An isolated tick (both flags) is fully rounded.
                  const roundCls = p.point
                    ? "rounded-full"
                    : p.track === "access"
                      ? p.roundLeft && p.roundRight
                        ? "rounded-[2px]"
                        : p.roundLeft
                          ? "rounded-l-[2px] rounded-r-none"
                          : p.roundRight
                            ? "rounded-r-[2px] rounded-l-none"
                            : "rounded-none"
                      : // MIDDLE (access spine): square at rest, rounded ONLY on hover (v0.2.255).
                        p.track === "middle"
                        ? isHot
                          ? "rounded-[2px]"
                          : "rounded-none"
                        : "rounded-[2px]"
                  // COLORS. Fill = entity color (sleep → night sky); the root sentinel paints
                  // the THEME BACKGROUND (near-black in dark, near-white in light) instead of
                  // going transparent, so a root access tick reads as a solid outlined chip.
                  const isRootTick = p.color === ROOT_SENTINEL_COLOR
                  // ROOT FROSTED GLASS (v0.2.267): a root tick used to paint OPAQUE `var(--background)`,
                  // which fully hid the day-boundary gridline behind it. Now it paints a TRANSLUCENT
                  // background + a modest backdrop blur (applied only in the style block below), so the
                  // gridline (and anything else behind) is faintly "guessed through" as frosted glass.
                  // Non-root ticks keep their solid entity fill. Only the handful of root spine segments
                  // ever carry the (relatively expensive) backdrop-filter, so pan cost stays negligible.
                  const fill = isRootTick
                    ? // v0.2.268: was 55% — too opaque over the near-black ground, so the faint
                      // `muted-foreground/25` gridline behind never read through the 5px blur. 38%
                      // lets the blurred line show as a soft vertical smudge (frosted glass) while
                      // the tick still reads as a distinct chip.
                      "color-mix(in oklch, var(--background) 38%, transparent)"
                    : (p.sky ?? p.color)
                  // FADING = an unknown-end (ongoing / future-open) span → render as ONE element
                  // with a masked tail (below), never a point or an instant mark.
                  const fading = p.unknownEnd && !p.point && !p.markGlyph
                  // FADING-START (v0.2.249) = the mirror: a real end but unknown start → the tick fades
                  // in from its LEFT edge. Rounds only its right (known) edge. Mutually exclusive with
                  // `fading` in practice (a bar can't be open on both ends). Never a point/mark.
                  const fadingStart = p.unknownStart && !p.point && !p.markGlyph && !fading
                  // EDGE-EDITABLE (v0.2.285, narrowed .286, past-allowed .287, RECORDED added .294) — a tick
                  // the uzer can DRAG to re-time. TWO rails now: PLANNED occurrences (setDefinite/Rule
                  // OccurrenceTime writers) AND RECORDED sessions (editSession, now that the .293 log-edit
                  // pass landed a time-writer). Both need two known epochs; both exclude points / marks /
                  // open-ended (fading) ticks, which have no fixed pair of edges to drag. A recorded tick is
                  // editable only when CLOSED + anchored (it then carries sessionAnchorId + a finite endMs).
                  // Re-timing a PAST span is allowed on both rails (Loris ask). */
                  const occEditable =
                    p.track === "planned" && !!p.occRef && !!onOccurrenceRetime
                  const sessionEditable =
                    p.track === "recorded" && p.sessionAnchorId != null && !!onSessionRetime
                  const edgeEditable =
                    !p.point &&
                    !p.markGlyph &&
                    !fading &&
                    !fadingStart &&
                    (occEditable || sessionEditable) &&
                    p.startMs != null &&
                    p.endMs != null
                  // COLLAPSE-ON-STOP is handled IMPERATIVELY (v0.2.261) — the effect above FLIP-animates
                  // the just-closed node's px width + mask directly. The declarative render below only
                  // describes the RESTING open (`fading`) and closed states; it never needs a collapse
                  // branch, so a re-render mid-animation can't fight the inline tween (the effect clears
                  // its inline styles when done, handing control back here).
                  // v0.2.312: the unknown-end/-start fade is a fixed TIME span (FADE_MS) expressed as a
                  // % of the lane, so it scales with the pinch-zoom and never elongate-then-snaps under the
                  // zoom glide's scaleX (see the FADE_MS note). `fadePct` = the fade's lane-width fraction
                  // at the current zoom; `rightTailPct` is it for the rightward (unknown-end) fade only.
                  const fadePct = (FADE_MS / viewSpan) * 100
                  const rightTailPct: number | null = fading ? fadePct : null
                  // SMOOTH RIGHT EDGE (v0.2.261, widened .262): ANY tick whose right edge IS the now
                  // marker gets its solid width driven off the same smooth `nowPct` the marker uses
                  // (left edge fixed at leftPct), so it GROWS continuously with the marker instead of
                  // stepping once a second. That's the OPEN recorded tick (ongoing play, `unknownEnd`)
                  // AND the live MIDDLE/ACCESS spine segment (`openEnded`, right edge == now by
                  // construction). CLOSED ticks and future/planned ticks keep their memoized per-second
                  // width. Since smoothNow ≥ the coarse `now`, none can spill past the marker.
                  const liveRightEdge =
                    (p.track === "recorded" && p.unknownEnd) ||
                    ((p.track === "middle" || p.track === "access") && p.openEnded)
                  const effWidthPct = liveRightEdge ? Math.max(0, nowPct - p.leftPct) : p.widthPct
                  // RIGHT-FADE MASK stop is ELEMENT-relative (mask is painted in the element's own box),
                  // but the fade + solid widths above are LANE-relative %. Convert: the element spans
                  // (solid + fade) of the lane, so the solid part is `solid / (solid + fade)` of it.
                  // v0.2.312: replaces the old element-agnostic `100% − 20px` stop, which didn't scale
                  // with zoom and elongate-then-snapped under the zoom glide scaleX.
                  const rightFadeMaskSolidPct =
                    rightTailPct != null ? (effWidthPct / (effWidthPct + rightTailPct || 1)) * 100 : 0
                  // LEFT-fade mask stays a FIXED px stop (START_FADE_PX) — the left fade is a fixed pixel
                  // lead-in (Loris ask), so the element-relative px mask matches its px width directly.
                  // DRAG PREVIEW (v0.2.286): while THIS planned tick is being edge/move-dragged, its
                  // geometry is driven LIVE from `editPreview` (start/end in ms → leftPct/widthPct via
                  // the same winStart/VIEW_SPAN_MS scale as every other tick) so it slides/resizes under
                  // the cursor before commit. A dragged planned tick is never anchorRight/fading/point,
                  // so only the plain left + width branches below consult these.
                  const dragging = editPreview?.key === p.key
                  const dispLeftPct = dragging
                    ? ((editPreview!.start - winStart) / viewSpan) * 100
                    : p.leftPct
                  const dispWidthPct = dragging
                    ? ((editPreview!.end - editPreview!.start) / viewSpan) * 100
                    : effWidthPct
                  // OPEN SPINE SEGMENT (v0.2.268): the live middle/access segment whose RIGHT edge is the
                  // growing now edge and whose LEFT edge (start) is FIXED. It must be LEFT-anchored (see
                  // anchorRight below): right-anchoring it (`left = leftPct+effWidthPct` + translate-x-full)
                  // rounds the `left%` and the −100% translate to device px SEPARATELY, so as effWidthPct
                  // grows each smooth-clock frame the computed LEFT edge jittered ±1px against its fixed
                  // neighbour — the "previous tick's end and this tick's start bounce into each other"
                  // Loris reported after the now-marker went smooth. Left-anchoring pins the shared
                  // junction to a stable `round(leftPct%)`.
                  const openSpineLive =
                    (p.track === "middle" || p.track === "access") && p.openEnded && !p.point && !fading
                  // ANCHOR EDGE (1a, generalized in v0.2.255). The min-width floor `max(3px, widthPct%)`
                  // grows a thin tick's nub in whichever direction it's ANCHORED. MIDDLE (access spine)
                  // and ACCESS ticks are ALWAYS historical (their right edge is ≤ now by construction),
                  // so anchor them by their RIGHT edge → any min-width nub grows LEFTWARD into the past and
                  // can NEVER spill to the right of the now marker (the reported bug). The old fix only
                  // right-anchored OPEN spine segments, so a CLOSED sliver ending at/near now still floored
                  // 3px rightward past the marker. TOP-rail (planned) ticks can be in the FUTURE, so they
                  // keep left/fade anchoring; an explicitly open-ended tick (no fade) also right-anchors.
                  const anchorRight =
                    !p.point &&
                    !fading &&
                    !openSpineLive &&
                    (p.openEnded || p.track === "middle" || p.track === "access")
                  // OPACITY (v0.2.249). A LIT tick and hover both snap to full. TOP-rail PLANNED ticks
                  // paint at a flat 0.8 (a hair softer than solid, so "intent" reads distinct from
                  // recorded activity without the old dynamic coverage math, which was retired). Every
                  // other rail (access / recorded / middle spine) stays fully solid.
                  const tickOpacity = lit || isHot ? 1 : p.track === "planned" ? 0.8 : 1
                  // PLANNED INSTANT — a small FILLED instant glyph (the down-triangle) with the
                  // entity title beside it, both in the entity's color. The glyph is nudged left
                  // half its width so its center sits exactly on the instant's time; the title
                  // reads to its right. Same hover/click/context-menu affordances as any tick.
                  if (p.instant) {
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
                          aria-label={`${p.title}, ${p.range}`}
                          onMouseEnter={(ev) => {
                            setHoveredKey(p.key)
                            placeTooltip(ev.clientX, ev.clientY)
                          }}
                          onMouseMove={(ev) => placeTooltip(ev.clientX, ev.clientY)}
                          onMouseLeave={() => {
                            setHoveredKey((h) => (h === p.key ? null : h))
                          }}
                          onClick={() => {
                            if (draggedRef.current) return
                            onOpen(p.id)
                          }}
                          onContextMenu={(ev) => {
                            // TOP-rail (planned) tick with an occurrence identity → per-occurrence menu;
                            // BOTTOM-rail (recorded) tick with a session anchor → per-session menu (v0.2.293);
                            // else the whole-entity menu (v0.2.249).
                            if (p.track === "planned" && p.occRef && onOccurrenceMenu)
                              onOccurrenceMenu(p.id, p.occRef, ev)
                            else if (p.track === "recorded" && p.sessionAnchorId != null && onSessionMenu)
                              onSessionMenu(p.id, p.sessionAnchorId, ev)
                            else onContextMenuEntity?.(p.id, ev)
                          }}
                          className="pointer-events-auto absolute flex cursor-default items-center gap-1 -translate-y-1/2 whitespace-nowrap"
                          style={{
                            top: railTop,
                            left: `${p.leftPct}%`,
                            color: fill,
                            opacity: tickOpacity,
                            zIndex: lit || isHot ? 16 : 8,
                          }}
                        >
                          <Zero0Glyph kind="instant" filled className="-ml-1.5 h-3 w-3 shrink-0" />
                          <span className="text-[10px] leading-none tracking-tight">{p.title}</span>
                        </button>
                      </div>
                    )
                  }
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
                        data-wpct={p.widthPct}
                        aria-label={p.track === "access" ? `Was in ${p.title}, ${p.range}` : `${p.title}, ${p.range}`}
                        onMouseEnter={(ev) => {
                          setHoveredKey(p.key)
                          placeTooltip(ev.clientX, ev.clientY)
                        }}
                        onMouseMove={(ev) => placeTooltip(ev.clientX, ev.clientY)}
                        onMouseLeave={() => {
                          setHoveredKey((h) => (h === p.key ? null : h))
                        }}
                        // MOVE DRAG (v0.2.286): grabbing an editable planned tick's BODY drags the whole
                        // occurrence to a new time (duration preserved). Only wired when edgeEditable so
                        // non-editable ticks keep their normal click/pan behaviour untouched.
                        onPointerDown={edgeEditable ? beginEdgeDrag("move", p) : undefined}
                        onPointerMove={edgeEditable ? moveEdgeDrag : undefined}
                        onPointerUp={edgeEditable ? endEdgeDrag : undefined}
                        onClick={() => {
                          // Suppress the open when the press was a pan OR a real re-time drag.
                          if (draggedRef.current || editDraggedRef.current) return
                          onOpen(p.id)
                        }}
                        onContextMenu={(ev) => {
                          // TOP-rail (planned) tick with an occurrence identity → per-occurrence menu;
                          // BOTTOM-rail (recorded) tick with a session anchor → per-session menu (v0.2.293);
                          // else the whole-entity menu (v0.2.249).
                          if (p.track === "planned" && p.occRef && onOccurrenceMenu)
                            onOccurrenceMenu(p.id, p.occRef, ev)
                          else if (p.track === "recorded" && p.sessionAnchorId != null && onSessionMenu)
                            onSessionMenu(p.id, p.sessionAnchorId, ev)
                          else onContextMenuEntity?.(p.id, ev)
                        }}
                        className={cn(
                          // Every tick is vertically centered on its anchor via
                          // `-translate-y-1/2` (the anchor is `top: railTop` in the style),
                          // and animates height + anchor (top) changes smoothly (so an ongoing
                          // bar re-stacking as siblings start/stop slides rather than jumps).
                          "pointer-events-auto absolute cursor-default -translate-y-1/2",
                          // TRANSITION. height/opacity/top only — width is inline + reticks every second,
                          // so a declarative width transition would make open bars/pans slide. The
                          // COLLAPSE-ON-STOP width/mask tween is driven IMPERATIVELY (v0.2.261 effect
                          // above) on the just-closed node, so it doesn't need a class here and can't be
                          // triggered by the per-second re-tick.
                          "transition-[height,opacity,top] duration-200",
                          // A FADING (unknown-end) tick is ONE element (see below): the tail is a
                          // mask, not a sibling, so it rounds ONLY on the start (left) edge — the
                          // "continues" edge stays open. A FADING-START tick mirrors this, rounding only
                          // its right (known) edge. Otherwise use the normal per-end rounding. (A
                          // collapsing tick keeps whatever rounding it had; the FLIP only tweens width.)
                          fading
                            ? "rounded-l-[2px] rounded-r-none"
                            : fadingStart
                              ? "rounded-r-[2px] rounded-l-none"
                              : roundCls,
                          // Translate composes on separate axes: X for a point / right-anchored
                          // open-ended segment, Y to center every tick. A fading tick is LEFT-
                          // anchored (its start is fixed; the tail grows right past now), so it
                          // must NOT also translate-x-full.
                          p.point && "-translate-x-1/2",
                          anchorRight && "-translate-x-full",
                        )}
                        style={{
                          top: railTop,
                          // Fading + non-open-ended ticks anchor by their LEFT (start) edge; a
                          // right-anchored open-ended tick (e.g. open access, no fade) keeps
                          // its right edge pinned to now. A FADING-START tick shifts its left anchor
                          // LEFT by the fade length so the fade grows OUT past the (unknown) start.
                          left: fadingStart
                            ? `calc(${p.leftPct}% - ${START_FADE_PX}px)`
                            : anchorRight
                              ? // v0.2.264: use effWidthPct, NOT the coarse memoized widthPct. A right-
                                // anchored tick pins its RIGHT edge at `left = leftPct + width`; the width
                                // itself already uses the smooth effWidthPct, so if this position stayed on
                                // the per-second widthPct the element GREW smoothly but its right edge (the
                                // anchor) STEPPED once a second — the "access tick catches up to the now
                                // marker every 1s" Loris reported. Both now read effWidthPct ⇒ the right
                                // edge glides with the marker. (For closed ticks effWidthPct === widthPct.)
                                `${p.leftPct + effWidthPct}%`
                              : `${dispLeftPct}%`,
                          // A MARK renders as a small downward-triangle instant glyph (clip-path);
                          // a plain point is a 2px tick; a FADING tick spans start→now PLUS the
                          // fade tail (so the solid/fade boundary lands exactly on now, with no
                          // min-width nub spilling past it); a FADING-START tick adds the fade to its
                          // LEFT; a plain span fills its width.
                          width: p.markGlyph
                            ? 9
                            : p.point
                              ? 2
                              : rightTailPct != null
                                ? `${effWidthPct + rightTailPct}%`
                                : fadingStart
                                  ? `calc(${effWidthPct}% + ${START_FADE_PX}px)`
                                  : openSpineLive
                                    ? // v0.2.268: NO min-width floor. Left-anchored, its right edge is the
                                      // now edge, so a `max(3px,…)` floor on a sub-second-thin open segment
                                      // would spill 3px PAST the now marker. A <1px open segment is simply
                                      // invisible for a fraction of a second — correct, and it never spills.
                                      `${effWidthPct}%`
                                    : // v0.2.310: PURE PROPORTIONAL — no min-width floor. The old
                                      // `max(3px,…)` floored every closed tick at 3px so brief sessions
                                      // stayed visible, but a floored tick has a FIXED px width that the
                                      // zoom glide's scaleX(a) visually ELONGATES (3px·a) and then
                                      // re-floors back to 3px at commit = the elongate-then-snap Loris
                                      // saw. A true `%` width scales exactly as the geometry says and
                                      // commits to the same value ⇒ zero snap. Trade-off (accepted):
                                      // sub-pixel-short sessions are invisible/un-hoverable until zoomed
                                      // in — honesty over a guaranteed nub.
                                      `${dispWidthPct}%`,
                          height: p.markGlyph ? 9 : tickH,
                          // FILL = entity color; parent color is shown as an INSET GLOW only (no border).
                          background: fill,
                          // ROOT FROSTED GLASS (v0.2.267): only a root tick blurs what's behind it (the
                          // day-boundary gridline), so the line reads faintly THROUGH the tick. Kept off
                          // every other tick so the backdrop-filter cost is limited to the 1–few root
                          // spine segments and pan performance is unaffected.
                          backdropFilter: isRootTick ? "blur(3px)" : undefined,
                          WebkitBackdropFilter: isRootTick ? "blur(3px)" : undefined,
                          // v0.2.266: NO border. The parent color is now expressed PURELY as the inset
                          // glow below — Loris wanted the depth of the inner shadow without the flat
                          // hairline outline on top of it. (markGlyph triangles never had one anyway.)
                          border: "none",
                          // PARENT INNER GLOW (v0.2.265): an INSET box-shadow in the parent color bleeds
                          // inward from every edge, giving the tick depth (an inner ring). Blur scales with
                          // the tick height so it reads at any rail size; solid color + blur naturally ramps
                          // color→transparent toward the centre, so the fill still shows through. Only
                          // where a parent color exists (inside a Space) and never on points / mark glyphs.
                          boxShadow:
                            p.markGlyph || p.point || !p.stroke
                              ? undefined
                              : `inset 0 0 ${Math.max(3, Math.round(tickH * 0.5))}px 0 ${p.stroke}`,
                          clipPath: p.markGlyph ? "polygon(0 0, 100% 0, 50% 100%)" : undefined,
                          // UNKNOWN-END FADE (v0.6.20) — the tail is now a MASK on this ONE element,
                          // not a separate sibling div. The last FADE_MS (as a % of the lane) fades to
                          // transparent, taking the fill AND the hairline border with them (so
                          // there's no crisp border box or rounded seam around the tail). One
                          // element = one hover target + one transition (fixes the old two-piece
                          // mismatch). The solid/fade boundary sits at the element-relative % computed
                          // above, which for an ongoing tick is exactly now.
                          // FADING masks the RIGHT tail (end unknown); FADING-START masks the LEFT lead
                          // (start unknown) — transparent at 0 ramping to solid after the fade length.
                          maskImage:
                            rightTailPct != null
                              ? `linear-gradient(to right, #000 ${rightFadeMaskSolidPct}%, transparent 100%)`
                              : fadingStart
                                ? `linear-gradient(to right, transparent 0, #000 ${START_FADE_PX}px)`
                                : undefined,
                          WebkitMaskImage:
                            rightTailPct != null
                              ? `linear-gradient(to right, #000 ${rightFadeMaskSolidPct}%, transparent 100%)`
                              : fadingStart
                                ? `linear-gradient(to right, transparent 0, #000 ${START_FADE_PX}px)`
                                : undefined,
                          opacity: tickOpacity,
                          zIndex: lit || isHot ? 16 : 8,
                        }}
                      >
                        {/* EDGE DRAG-HANDLES (v0.2.285, wired .286) — a thin grab zone on each side of an
                            editable planned tick. Hovering shows the ew-resize cursor + fades in the hour
                            guides. Dragging RESIZES that edge (start handle moves the start, end handle the
                            end; the other edge stays put), committing the new span on release. The handler
                            stops propagation so the drag WINS over panning, and onClick is stopped so a
                            grab on the edge never opens the entity. */}
                        {edgeEditable && (
                          <>
                            <span
                              aria-hidden
                              onMouseEnter={showHourGuides}
                              onMouseLeave={hideHourGuides}
                              onPointerDown={beginEdgeDrag("start", p)}
                              onPointerMove={moveEdgeDrag}
                              onPointerUp={endEdgeDrag}
                              onClick={(ev) => ev.stopPropagation()}
                              className="pointer-events-auto absolute inset-y-0 left-0 w-[6px] cursor-ew-resize rounded-l-[2px] transition-colors hover:bg-foreground/25"
                            />
                            <span
                              aria-hidden
                              onMouseEnter={showHourGuides}
                              onMouseLeave={hideHourGuides}
                              onPointerDown={beginEdgeDrag("end", p)}
                              onPointerMove={moveEdgeDrag}
                              onPointerUp={endEdgeDrag}
                              onClick={(ev) => ev.stopPropagation()}
                              className="pointer-events-auto absolute inset-y-0 right-0 w-[6px] cursor-ew-resize rounded-r-[2px] transition-colors hover:bg-foreground/25"
                            />
                          </>
                        )}
                      </button>
                    </div>
                  )
                })}
            </div>
          </div>

          {/* NOW marker — a thin bright vertical tick, painted above the bars. Hidden
              when panned out of view. Rides the same catch-up wave as the content. */}
          {mounted && nowInView && (
            <div ref={markerPanRef} className="pointer-events-none absolute inset-0 z-30 origin-left will-change-transform">
              <div
                aria-hidden
                ref={registerRipple("__now__")}
                data-left={nowPct}
                className="pointer-events-none absolute inset-0 will-change-transform"
              >
                <div
                  className="pointer-events-none absolute -bottom-px -top-px w-px -translate-x-1/2"
                  style={{ left: `${nowPct}%`, backgroundColor: NOW_COLOR }}
                >
                  {/* Little downward-pointing triangle capping the TOP of the marker line
                      (its apex points down into the line). The marker is now purely a 1px
                      orange line + this cap — no hover, no tooltip. */}
                  <span
                    aria-hidden
                    className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-full"
                    style={{
                      width: 0,
                      height: 0,
                      borderLeft: "3px solid transparent",
                      borderRight: "3px solid transparent",
                      borderTop: `4px solid ${NOW_COLOR}`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}
          {/* (The full-mode in-flow HOVER HELPER was removed in v0.2.273 — the single
              cursor-following portal tooltip above now serves BOTH minimized and full mode.) */}
        </div>
      </div>
    </div>
  )
}
