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
  getSpaceEvents,
  getTimelineOccurrences,
  getInheritedAccent,
  directChildOfFocus,
  getEntity,
  type TimelineOccurrence,
} from "./data"
import type { Entity, Recurrence } from "./types"
import type { Grain, TimelineScale } from "./timeline-scale"

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
const NEUTRAL = "oklch(0.72 0.004 75)"

// Grains at which we expand recurrences into individual occurrences. Coarser than
// "week" and a recurring series becomes a stream band instead (see below).
const FINE_GRAINS: Grain[] = ["hour", "day", "week"]

/** [start, end] epoch interval of a timed entity. Instants are zero-width. */
export function entityInterval(e: Entity): [number, number] {
  const s = e.schedule
  if (e.kind === "instant") {
    const a = s?.at ?? 0
    return [a, a]
  }
  const st = s?.startAt ?? 0
  return [st, s?.endAt ?? st]
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

/** A recurring series too dense to expand at the current zoom — drawn as one
 *  faint band across its active window with a "repeats" affordance. */
export interface StreamSeries {
  entity: Entity
  from: number
  to: number
  approxCount: number
  color: string
}

export interface TimelineQuery {
  /** Individual placed occurrences (one-offs + expanded recurrences). */
  items: TimelineOccurrence[]
  /** Recurring series represented as bands instead of points. */
  streams: StreamSeries[]
}

/**
 * Everything on `spaceId`'s lifeline within [rangeStart, rangeEnd], shaped for
 * the current `grain`. At FINE grain the range is small, so we reuse the tested
 * per-day expander wholesale. At COARSE grain we do a single light pass —
 * one-offs that intersect the range pass through; recurring series are emitted
 * as streams WITHOUT ever walking their days. This is the core "huge range stays
 * cheap" guarantee.
 */
export function queryTimeline(
  spaceId: string,
  rangeStart: number,
  rangeEnd: number,
  grain: Grain,
): TimelineQuery {
  if (FINE_GRAINS.includes(grain)) {
    return { items: getTimelineOccurrences(spaceId, rangeStart, rangeEnd), streams: [] }
  }

  const items: TimelineOccurrence[] = []
  const streams: StreamSeries[] = []
  for (const e of getSpaceEvents(spaceId)) {
    const s = e.schedule
    if (!s) continue
    const anchor = s.at ?? s.startAt
    if (anchor == null) continue
    const color = getInheritedAccent(e.parentId ?? "s_root") ?? NEUTRAL

    if (!s.repeat) {
      const [st, en] = entityInterval(e)
      if (en >= rangeStart && st <= rangeEnd) items.push({ ...e, occKey: e.id })
      continue
    }
    // Recurring: represent as a stream over its active window — no per-day walk.
    const from = Math.max(anchor, rangeStart)
    const to = Math.min(s.repeat.until ?? rangeEnd, rangeEnd)
    if (from > to) continue
    streams.push({ entity: e, from, to, approxCount: (to - from) / approxPeriodMs(s.repeat), color })
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
  const color = getInheritedAccent(items[0].parentId ?? "s_root") ?? NEUTRAL
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
    const child = directChildOfFocus(it.parentId ?? "s_root", focusId)
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
