// ============================================================================
// Timeline data index / query layer
// ----------------------------------------------------------------------------
// Sits between the raw entity store (`data.ts`) and the timeline renderer. Its
// whole job is to answer "what is on the lifeline between A and B, at this zoom?"
// FAST and in a shape the renderer can paint without further heavy work — so the
// experience stays fluid even when the lifeline spans a whole life.
//
// Two ideas keep it cheap at any scale:
//   1. BOUNDED RECURRENCE. A daily series over a 90-year Life view is ~33k days.
//      We NEVER walk that. At fine zoom (range is small) we expand normally; at
//      coarse zoom we represent a recurring series as a single "stream" band
//      instead of thousands of points.
//   2. PIXEL-PROXIMITY CLUSTERING + ADAPTIVE SEMANTIC ROLLUP, applied at render
//      against the scale, so overlapping markers merge into density bubbles /
//      context bands rather than drawing (and colliding) thousands of nodes.
//
// Everything here is PURE — no React/DOM — so it memoises trivially and could be
// lifted into a Web Worker wholesale if real datasets ever demand it.
// ============================================================================

import {
  ROOT_ID,
  getTimedDescendants,
  getTimelineOccurrences,
  getInheritedAccent,
  directChildOfFocus,
  getEntity,
  dayMatchesRecurrence,
  type TimelineOccurrence,
} from "./data"
import type { Entity, Recurrence } from "./types"
import { effectiveScheduleEnd } from "./kinds"
import type { Grain, TimelineScale } from "./timeline-scale"

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
const NEUTRAL = "oklch(0.72 0.004 75)"

// Grains at which we reuse the tested per-day expander wholesale (range is small).
// Coarser than "week" we use a BOUNDED expander instead — see queryTimeline.
const FINE_GRAINS: Grain[] = ["hour", "day", "week"]

// Per-series cap on how many recurring occurrences we ever materialise at coarse
// zoom. A recurring lane is NEVER collapsed into a single band anymore (the user
// found that jarring + opaque); instead we keep drawing individual occurrence
// points for as long as it stays cheap, and once a series would exceed this many
// points in view we simply STOP emitting further ones and fade the last few to
// imply "…and it keeps going". ~a year of a daily series — well beyond what's
// legible, but the point is to degrade by truncation, not by collapsing. Easily
// tunable: lower it if very dense lanes ever cost zoom smoothness.
const MAX_RECUR_OCCURRENCES = 366
// How many trailing points fade out to signal continuation past the cap.
export const RECUR_FADE_TAIL = 3
// Absolute walk guard so a SPARSE recurrence (e.g. yearly) over a century-wide
// view can't spin the day-cursor unboundedly. 200k days ≈ 547 years.
const MAX_SCAN_DAYS = 200_000

/** [start, end] epoch interval of a timed entity. Instants are zero-width. */
export function entityInterval(e: Entity): [number, number] {
  const s = e.schedule
  if (e.kind === "instant") {
    const a = s?.at ?? 0
    return [a, a]
  }
  // "whenever" isn't a fixed time, so it has no lifeline interval → zero-width at 0.
  const st = typeof s?.startAt === "number" ? s.startAt : 0
  // start+duration implies an end (effectiveScheduleEnd), so a duration-only span gets a
  // real width on the lifeline / in sort bounds — not collapsed to a point at its start.
  return [st, effectiveScheduleEnd(s) ?? st]
}

/** Approximate ms between consecutive occurrences of a recurrence — used only to
 *  estimate how dense a series is (whether to expand it or stream it). */
function approxPeriodMs(r: Recurrence): number {
  const interval = Math.max(1, r.interval ?? 1)
  switch (r.freq) {
    case "daily":
      return interval * DAY_MS
    case "weekly":
      return (interval * WEEK_MS) / (r.byWeekday?.length || 1)
    case "monthly":
      return interval * 30 * DAY_MS
    case "yearly":
      return interval * 365 * DAY_MS
  }
}

/** A recurring series at coarse zoom. Rather than collapse it into one band, we
 *  carry the actual (capped) occurrence timestamps so the renderer can paint
 *  individual points. `from`/`to` are the active window (used for lane/ribbon
 *  reservation); `times` is the materialised occurrences within it, oldest→newest,
 *  capped at MAX_RECUR_OCCURRENCES; `truncated` is true when more occurrences
 *  exist past the last point (the renderer fades the final RECUR_FADE_TAIL points). */
export interface StreamSeries {
  entity: Entity
  from: number
  to: number
  approxCount: number
  color: string
  times: number[]
  truncated: boolean
}

/**
 * Materialise a recurring series' occurrence timestamps within [from, to], in
 * chronological order, stopping after `cap` points (then `truncated = true`).
 * Mirrors getTimelineOccurrences' DST-safe Date stepper, but bounded so a daily
 * series over a huge range costs O(cap), not O(days). Sparse series (yearly) walk
 * more days to find each hit but are guarded by MAX_SCAN_DAYS.
 */
function expandRecurrenceBounded(
  anchor: number,
  repeat: Recurrence,
  from: number,
  to: number,
  cap: number,
): { times: number[]; truncated: boolean } {
  const times: number[] = []
  const anchorDate = new Date(anchor)
  const hh = anchorDate.getHours()
  const mm = anchorDate.getMinutes()
  const cursor = new Date(from)
  cursor.setHours(0, 0, 0, 0)
  let scanned = 0
  let truncated = false
  while (cursor.getTime() <= to) {
    if (scanned++ > MAX_SCAN_DAYS) break
    const dayStart = cursor.getTime()
    if (dayMatchesRecurrence(dayStart, anchor, repeat)) {
      const occDate = new Date(dayStart)
      occDate.setHours(hh, mm, 0, 0)
      const occ = occDate.getTime()
      if (occ >= from && occ <= to) {
        if (times.length >= cap) {
          truncated = true
          break
        }
        times.push(occ)
      }
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return { times, truncated }
}

export interface TimelineQuery {
  /** Individual placed occurrences (one-offs + expanded recurrences). */
  items: TimelineOccurrence[]
  /** Recurring series represented as bands instead of points. */
  streams: StreamSeries[]
}

/**
 * Everything on `contextId`'s lifeline within [rangeStart, rangeEnd], shaped for
 * the current `grain`. At FINE grain the range is small, so we reuse the tested
 * per-day expander wholesale. At COARSE grain we do a single light pass —
 * one-offs that intersect the range pass through; recurring series are emitted
 * as streams WITHOUT ever walking their days. This is the core "huge range stays
 * cheap" guarantee.
 */
export function queryTimeline(
  contextId: string,
  rangeStart: number,
  rangeEnd: number,
  grain: Grain,
): TimelineQuery {
  if (FINE_GRAINS.includes(grain)) {
    return { items: getTimelineOccurrences(contextId, rangeStart, rangeEnd), streams: [] }
  }

  const items: TimelineOccurrence[] = []
  const streams: StreamSeries[] = []
  for (const e of getTimedDescendants(contextId)) {
    const s = e.schedule
    if (!s) continue
    // "whenever" can't anchor a timeline occurrence (no fixed time).
    const anchor = s.at ?? (typeof s.startAt === "number" ? s.startAt : undefined)
    if (anchor == null) continue
    const color = getInheritedAccent(e.parentId ?? ROOT_ID) ?? NEUTRAL

    if (!s.repeat) {
      const [st, en] = entityInterval(e)
      if (en >= rangeStart && st <= rangeEnd) items.push({ ...e, occKey: e.id })
      continue
    }
    // Recurring: keep it as a series of INDIVIDUAL points (never a collapsed
    // band). Materialise occurrences within the active window, capped — past the
    // cap we stop and let the renderer fade the tail to imply continuation.
    const from = Math.max(anchor, rangeStart)
    const to = Math.min(s.repeat.until ?? rangeEnd, rangeEnd)
    if (from > to) continue
    const { times, truncated } = expandRecurrenceBounded(anchor, s.repeat, from, to, MAX_RECUR_OCCURRENCES)
    if (times.length === 0) continue
    streams.push({
      entity: e,
      from,
      to,
      approxCount: (to - from) / approxPeriodMs(s.repeat),
      color,
      times,
      truncated,
    })
  }
  return { items, streams }
}

// --- Pixel-proximity clustering (coarse-zoom density) -----------------------
/** A merged group of instants that would overlap on screen at the current zoom.
 *  Expands back into individual pins as the user zooms in (count drops to 1). */
export interface InstantCluster {
  key: string
  ms: number
  items: TimelineOccurrence[]
  color: string
}

/**
 * Greedily merge instants whose on-screen x-positions fall within `minGapPx` of
 * each other into single density bubbles. A bubble with one item renders as a
 * normal pin; with many, as a count bubble. O(n log n) (one sort + one pass).
 */
export function clusterInstants(
  instants: TimelineOccurrence[],
  scale: TimelineScale,
  minGapPx: number,
): InstantCluster[] {
  const sorted = [...instants].sort((a, b) => (a.schedule?.at ?? 0) - (b.schedule?.at ?? 0))
  const out: InstantCluster[] = []
  let cur: { items: TimelineOccurrence[]; lastX: number } | null = null
  for (const it of sorted) {
    const x = scale(new Date(it.schedule?.at ?? 0))
    if (cur && x - cur.lastX <= minGapPx) {
      cur.items.push(it)
      cur.lastX = x
    } else {
      if (cur) out.push(finishCluster(cur.items))
      cur = { items: [it], lastX: x }
    }
  }
  if (cur) out.push(finishCluster(cur.items))
  return out
}

function finishCluster(items: TimelineOccurrence[]): InstantCluster {
  // Representative position = mean time; color = first item's accent.
  const ms = items.reduce((sum, e) => sum + (e.schedule?.at ?? 0), 0) / items.length
  const color = getInheritedAccent(items[0].parentId ?? ROOT_ID) ?? NEUTRAL
  return { key: items.map((e) => e.occKey).join("|"), ms, items, color }
}

// --- Adaptive semantic rollup -----------------------------------------------
/** A child space's timed descendants collapsed into one contextual band because
 *  showing them individually would be too cluttered at the current focus/zoom. */
export interface RollupBand {
  childId: string
  title: string
  from: number
  to: number
  count: number
  color: string
}

export interface RolledUp {
  /** Items that passed through (calm enough, or direct members of the focus). */
  items: TimelineOccurrence[]
  /** Crowded child subtrees, collapsed into bands. */
  bands: RollupBand[]
}

/**
 * ADAPTIVE semantic-LOD. Group the query's items by the direct child space of
 * `focusId` they live under. A group is collapsed into a single band ONLY when it
 * is crowded — more items than comfortably fit the available pixels (so a calm
 * region keeps showing everything). Items that live directly in the focus always
 * pass through. `threshold` is an internal heuristic (count over which a group is
 * "too messy"); a future user setting could push it to 0 (always roll up) or ∞
 * (never). No hysteresis yet — a deliberate, documented simplification.
 */
export function applySemanticRollup(
  items: TimelineOccurrence[],
  focusId: string,
  widthPx: number,
): RolledUp {
  // Min comfortable px per individual item; below this a group reads as clutter.
  const MIN_ITEM_PX = 64
  const ROLLUP_FLOOR = 6 // never roll up tiny groups, regardless of width
  const threshold = Math.max(ROLLUP_FLOOR, Math.floor(widthPx / MIN_ITEM_PX))

  // Bucket items by the child-of-focus they roll up into (null = direct member).
  const groups = new Map<string, TimelineOccurrence[]>()
  const passThrough: TimelineOccurrence[] = []
  for (const it of items) {
    // A recurring series is NEVER collapsed — not into a stream band (coarse
    // grain, handled in queryTimeline) and not into a semantic rollup band
    // (fine grain, here). Its occurrences always pass through as individual
    // points so a repetitive lane keeps showing tiny dots at every zoom.
    if (it.schedule?.repeat) {
      passThrough.push(it)
      continue
    }
    const child = directChildOfFocus(it.parentId ?? ROOT_ID, focusId)
    if (child == null) {
      passThrough.push(it) // direct member of focus, or not under it — always shown
      continue
    }
    const arr = groups.get(child)
    if (arr) arr.push(it)
    else groups.set(child, [it])
  }

  const bands: RollupBand[] = []
  for (const [childId, group] of groups) {
    if (group.length <= threshold) {
      // Calm enough — show everything individually.
      passThrough.push(...group)
      continue
    }
    // Crowded — collapse into a single band spanning the group's extent.
    let from = Infinity
    let to = -Infinity
    for (const it of group) {
      const [st, en] = entityInterval(it)
      if (st < from) from = st
      if (en > to) to = en
    }
    const child = getEntity(childId)
    bands.push({
      childId,
      title: child?.title ?? "…",
      from,
      to,
      count: group.length,
      color: getInheritedAccent(childId) ?? NEUTRAL,
    })
  }
  return { items: passThrough, bands }
}
