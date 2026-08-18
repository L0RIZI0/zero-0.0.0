"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getCalendarBars, type CalBar, NEUTRAL, ROOT_SENTINEL_COLOR } from "@/lib/zero/dayline-bars"
import type { DaylineOccRef } from "@/components/zero0/zero0-dayline"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"
import { getEntity, isAncestorOf } from "@/lib/zero/data"
import { getFaceModel } from "@/lib/zero/face-model"
import { NOW_COLOR, rangeText } from "@/lib/zero/timeline-format"
import { useNowSeconds } from "@/lib/zero/use-now"
import { cn } from "@/lib/utils"

// ============================================================================
// Zero0Calendar (v0.2.313) — the EXPANDED form of the dayline: an Akiflow-style
// multi-day calendar. Whole-DAY columns (count from viewport width) centered on
// the dayline window's center time; each day split PLANNED-left / RECORDED-right;
// overlapping blocks pack into ½/⅓/¼ sub-lanes; a 24h vertical grid with a min
// hour height so short viewports scroll. No zoom (that's the dayline's job).
//
// This renders the SAME ticks as the dayline (via getCalendarBars, identical key
// scheme) so the two can morph into each other. This file owns ONLY the calendar
// layout/packing/rendering + scroll; classification lives in lib/zero/dayline-bars.
// ============================================================================

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const MIN_MS = 60_000
/** Snap dragged edges to the minute; enforce a 1-minute floor so a resize can't invert the span. */
const roundToMinute = (t: number) => Math.round(t / MIN_MS) * MIN_MS
const MIN_OCC_MS = MIN_MS
/** A block must be at least this tall to expose its top/bottom resize handles (otherwise the two 6px
 *  grab zones would overlap and there'd be no body left to click-open). */
const RESIZE_MIN_H = 18
/** Minimum hour row height. 24×20 = 480px content — below the available body height ⇒ vertical scroll. */
const MIN_HOUR_H = 20
/** Comfortable minimum width for a whole day (holds two sub-columns). Fewer, wider days > many cramped. */
const MIN_DAY_W = 150
/** Left gutter width for the hour labels. */
const HOUR_GUTTER_W = 46
/** Top row height for the day-name headers. */
const DAY_HEADER_H = 26
/** Honest minimum block height (like the dayline's no-floor policy, but blocks need a hairline to exist). */
const MIN_BLOCK_H = 3
/** Extra days rendered on EACH side of the visible span, for horizontal scroll headroom. This is a FIXED
 *  bounded window (the view never recenters as you scroll — `centerTime` is set once at mount), so this is
 *  the whole scrollable range each direction. 30 ⇒ roughly a month of scroll each side of today (v0.2.331,
 *  was 7 which capped scroll to ~±11 days). The bars are computed once over the range, so a wider window is
 *  a one-time compute + more day-column DOM, not per-scroll cost. */
const DAY_BUFFER = 30
/** A block must be at least this tall AND wide to hold its label INSIDE; otherwise the label goes to an
 *  external chip in the sibling column with a hairline connector (v0.2.313). */
const LABEL_MIN_H = 22
const LABEL_MIN_W = 40
/** Vertical fade length (px) for an UNCLEAR start/end, the calendar mirror of the dayline's edge fades
 *  (v0.2.316). A FIXED pixel length (not a time %) because the calendar has NO zoom — so a constant
 *  qualitative "continues / began before" blend at any hour scale. Bottom fade = unknown END, top fade =
 *  unknown START. Used as-is for the START fade + as the FLOOR for the END fade. */
const CAL_FADE_PX = 14
/** The unknown-/open-END fade spans a fixed 30min of the timeline (v0.2.325, Loris ask) so the "continues"
 *  blend is a meaningful, more noticeable chunk rather than a thin sliver. Converted to px at render from
 *  the day scale (contentH per DAY_MS) and floored at CAL_FADE_PX so it's never less visible than before. */
const CAL_END_FADE_MS = 30 * 60_000
/** Accent INNER-GLOW on calendar blocks (v0.2.319) — the calendar mirror of the dayline tick glow: an
 *  inset box-shadow in the entity accent, NOT a flat border (Loris preferred the soft depth look, from
 *  the dayline's v0.2.265/.266 decision). A solid SPREAD ring then a BLUR ramp to transparent so the
 *  accent reads boldly at any block size without a hairline. Fixed px (blocks are large + varied). */
const CAL_GLOW_BLUR_PX = 10
const CAL_GLOW_SPREAD_PX = 2
/** An unknown-START block has no real start, so it carries no height of its own; give it this fixed
 *  upward lead-in from its end anchor purely to host the top fade (mirror of the dayline's START_FADE_PX
 *  lead-in tail). */
const CAL_UNKNOWN_START_H = 18
/** Compact human duration for the in-block time line, e.g. `45m`, `2h`, `4h 30m`. Only shown when the
 *  block is roomy enough (see the render's width gate). */
function fmtDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
/** A block this tall can show BOTH its title and its time range inside; shorter shows only the title. */
const LABEL_TIME_H = 40
/** Blocks shorter than this get NO persistent label at all (neither inside nor as an external chip) —
 *  their info shows only on hover via the native tooltip (v0.2.314, Loris ask). EXCEPTIONS: Instants
 *  (zero-duration markers) and ONGOING blocks always keep a label regardless of duration. */
const LABEL_MIN_DURATION_MS = 5 * 60_000

/** Local midnight (epoch ms) for the day containing `epoch`. */
function startOfDay(epoch: number): number {
  const d = new Date(epoch)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
/** Real next-midnight — handles DST (23/25h days) since it re-reads the clock. */
function nextMidnight(dayStart: number): number {
  const d = new Date(dayStart)
  d.setDate(d.getDate() + 1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** A packed calendar block: a bar clipped to one day+column, with its sub-lane slot. */
interface Block {
  bar: CalBar
  clipStart: number
  clipEnd: number
  lane: number
  laneCount: number
}

/** Greedy interval-graph sub-lane packing: each block takes the lowest lane whose previous block
 *  ended ≤ its start, else a new lane. Returns blocks with `lane`/`laneCount` (= max concurrency). */
function packColumn(bars: { bar: CalBar; clipStart: number; clipEnd: number }[]): Block[] {
  const sorted = [...bars].sort((a, b) => a.clipStart - b.clipStart || a.clipEnd - b.clipEnd)
  const laneEnds: number[] = []
  const placed: Block[] = []
  for (const b of sorted) {
    let lane = laneEnds.findIndex((end) => end <= b.clipStart)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(b.clipEnd)
    } else {
      laneEnds[lane] = b.clipEnd
    }
    placed.push({ bar: b.bar, clipStart: b.clipStart, clipEnd: b.clipEnd, lane, laneCount: 1 })
  }
  const laneCount = Math.max(1, laneEnds.length)
  for (const p of placed) p.laneCount = laneCount
  return placed
}

/** Left inset (px) applied per nesting level so a child block sits INSIDE its parent, leaving a readable
 *  strip of the parent visible on the left (v0.2.322 recorded; v0.2.323 planned too). 15px peek (v0.2.337,
 *  was 10). */
const NEST_BLEED_PX = 15
/** A nested block never shrinks below this width, even deep in a chain. */
const NEST_MIN_W = 12

/** One node in a nesting forest: a block plus the blocks nested inside it. `lane`/`laneCount` are packed
 *  WITHIN this node's sibling group (concurrency among siblings), independent of pixel width; `depth` is
 *  the nesting level (0 = root). */
interface NestNode {
  block: Block
  lane: number
  laneCount: number
  depth: number
  children: NestNode[]
}

/**
 * Turn flat blocks into a NESTING FOREST (v0.2.322 recorded, v0.2.323 planned, v0.2.328 CROSS-TRACK +
 * kind-agnostic): a block nests inside another when the other's entity is its ANCESTOR and its span
 * TIME-CONTAINS the child — so "working on v0 inside Zero" shows v0 nested within Zero, and a Task/Meeting
 * inside a "Day Job" block shows inside it rather than as a separate parallel block. Two important fixes:
 *
 *  1. ANCESTRY IS KIND-AGNOSTIC (`isAncestorOf`, not the space-only `isInSubtree`). The old check walked
 *     the SPACE tree only, so a non-space child (Moment/Task/Instant) was NEVER seen as a descendant and
 *     never nested — the bug where a child Task didn't nest inside its parent Moment.
 *  2. NESTING IGNORES TRACK. We build ONE forest across BOTH planned and recorded blocks, so a child on
 *     either track nests under its closest containing ancestor on either track (e.g. a recorded session
 *     inside a planned "Day Job"). A block's ROOT status (no containing ancestor) decides its band:
 *     planned roots render left, recorded roots right; the whole nested subtree renders in the ROOT's
 *     band regardless of each child's own track ("mixes the bands when needed").
 *
 * Among all containing ancestors the SMALLEST-span one wins (closest ancestor). Sibling groups (the roots
 * of a track, and each node's children) are lane-packed by concurrency. Returns planned/recorded roots
 * plus each track's ROOT lane count (Lp/Lr), which drive the .320 width split (nested children inset, they
 * don't add columns).
 */
function forestNestCombined(
  plannedBlocks: Block[],
  recordedBlocks: Block[],
): { plannedRoots: NestNode[]; recordedRoots: NestNode[]; Lp: number; Lr: number } {
  const all = [...plannedBlocks, ...recordedBlocks]
  const isPlanned = new Set<Block>(plannedBlocks)
  const span = (b: Block) => b.clipEnd - b.clipStart
  const parentOf = (b: Block): Block | null => {
    let best: Block | null = null
    for (const p of all) {
      if (p === b) continue
      if (p.bar.id === b.bar.id) continue // same entity ⇒ not a nesting relationship
      const contains = p.clipStart <= b.clipStart && p.clipEnd >= b.clipEnd
      if (!contains) continue
      if (!isAncestorOf(p.bar.id, b.bar.id)) continue // p's entity must be an ancestor of b's (any kind)
      if (best == null || span(p) < span(best)) best = p
    }
    return best
  }
  const childrenByParent = new Map<Block, Block[]>()
  const rootsPlanned: Block[] = []
  const rootsRecorded: Block[] = []
  for (const b of all) {
    const p = parentOf(b)
    if (p) childrenByParent.set(p, [...(childrenByParent.get(p) ?? []), b])
    else (isPlanned.has(b) ? rootsPlanned : rootsRecorded).push(b)
  }
  // Recursively lane-pack a sibling group and attach children. Children may span BOTH tracks — they still
  // pack + render nested inside the parent (in the parent's band), which is the point of cross-track nesting.
  const build = (group: Block[], depth: number): NestNode[] => {
    const packed = packColumn(group.map((b) => ({ bar: b.bar, clipStart: b.clipStart, clipEnd: b.clipEnd })))
    // packColumn re-sorts, so pair results back to the source block by key+span identity.
    return packed.map((pk) => {
      const src = group.find((g) => g.bar.key === pk.bar.key && g.clipStart === pk.clipStart) ?? group[0]
      return {
        block: src,
        lane: pk.lane,
        laneCount: pk.laneCount,
        depth,
        children: build(childrenByParent.get(src) ?? [], depth + 1),
      }
    })
  }
  const plannedRoots = build(rootsPlanned, 0)
  const recordedRoots = build(rootsRecorded, 0)
  return {
    plannedRoots,
    recordedRoots,
    Lp: plannedRoots[0]?.laneCount ?? 0,
    Lr: recordedRoots[0]?.laneCount ?? 0,
  }
}

/** External-label chip height. */
// Instant chips now carry a time line that WRAPS below the title when it doesn't fit beside it, so the
// box reserves two lines (v0.2.319). One-line content is vertically centered in the box.
const CHIP_H = 30

/** A block positioned in DAY-LOCAL coords (x=0 at the day's left edge), with whether its label fits inside. */
interface PlacedBlock {
  bar: CalBar
  bx: number
  by: number
  bw: number
  bh: number
  internal: boolean
  /** Whether this block gets a PERSISTENT label at all. Sub-5min blocks (except Instants/ongoing) are
   *  label-free — hover the block for its tooltip instead (v0.2.314). */
  labeled: boolean
  /** Nesting depth in the track's forest (0 = root / instant); each level insets from the left by
   *  NEST_BLEED_PX (v0.2.322 recorded, v0.2.323 planned). */
  depth: number
  /** True when this block has blocks nested inside it. Its title renders horizontally at the top when the
   *  top region is free (headroomPx big enough), else ROTATED into the visible left bleed strip because a
   *  child covers the horizontal room (v0.2.329). */
  hasChildren: boolean
  /** Vertical gap (px) from this block's top to the top of its NEAREST child — i.e. the clear headroom at
   *  the top where a horizontal title can sit before any child covers the width (v0.2.329). Defaults to the
   *  full height for childless blocks. When < LABEL_MIN_H the title falls back to the rotated left-strip. */
  headroomPx: number
  /** Downward lead-out (px) added to `bh` below the block's real end to host the unknown/open-END fade
   *  (v0.2.325). 0 when the end is concrete. Without it, an ongoing block that just started is only
   *  MIN_BLOCK_H tall and the 30min fade would collapse into a sliver — so we EXTEND the block past its
   *  last-known point (below the now line for ongoing) and fade over that tail. */
  endFadePx: number
}
/** A persistent centered label chip (day-local) for an INSTANT — the moment's only readable surface,
 *  centered over its full-width tick (v0.2.320; the pre-.320 sibling-column chip + connector is gone). */
interface LabelChip {
  bar: CalBar
  lx: number
  ly: number
  lw: number
  lh: number
}

/** The planned/recorded width split ladder (v0.2.320): given a group's peak PLANNED and RECORDED root
 *  lane counts, return the fraction of the width the RECORDED band takes (planned takes the rest). Nothing
 *  recorded ⇒ planned 100%; nothing planned ⇒ recorded 100%; else 25/50/70% by recorded lane depth.
 *  v0.2.335 applies this PER CLUSTER (see layoutDay) instead of once per whole day. */
function recFracFor(Lp: number, Lr: number): number {
  return Lr === 0 ? 0 : Lp === 0 ? 1 : Lr === 1 ? 0.25 : Lr === 2 ? 0.5 : 0.7
}

/** Lay out ONE day: turn packed planned/recorded blocks into day-local block rects, decide which can
 *  hold their label inside, and for the rest place an external chip in the SIBLING column (planned→
 *  recorded, recorded→planned) at a free vertical slot near the block, with a curved hairline connector
 *  (v0.2.313 — the "label on the other column" behavior). Coords are day-local so the caller only offsets
 *  by the day's x.
 *
 *  PER-CLUSTER WIDTH SPLIT (v0.2.335, was per-day .320): rather than one planned/recorded split for the
 *  whole day, the roots are grouped into TIME-CONNECTED CLUSTERS (maximal sets connected by time-overlap)
 *  and each cluster gets its OWN split from its OWN peak lane counts. Clusters are provably time-disjoint
 *  (two clusters that overlapped in time would be connected into one), so per-cluster widths never collide
 *  and lanes stay aligned. Effect: a planned block whose cluster has no recorded activity spans FULL width,
 *  even if other hours of the day have recorded sessions. Returns per-cluster boundary segments for the
 *  planned/recorded divider (drawn only over the vertical extent of clusters that have both tracks). */
function layoutDay(
  plannedRoots: NestNode[],
  recordedRoots: NestNode[],
  instantBlocks: Block[],
  dayStart: number,
  dayColW: number,
  contentH: number,
  /** Live resize preview (v0.2.315): while dragging a block's edge, the matching block uses these
   *  absolute start/end (clamped to this day) so it grows/shrinks under the cursor before commit. */
  preview?: { key: string; start: number; end: number } | null,
): { blocks: PlacedBlock[]; chips: LabelChip[]; dividers: { x: number; y0: number; y1: number }[] } {
  const dayEnd = dayStart + DAY_MS
  // Turn ONE block into a positioned rect (vertical from its clipped span; horizontal handed in). Shared
  // by the planned uniform-lane build and the recorded nested placement.
  const mkPlaced = (b: Block, bx: number, bw: number, depth: number, hasChildren: boolean): PlacedBlock => {
    // Apply the live resize preview to the dragged block (clamped to this day's window).
    const cs = preview && preview.key === b.bar.key ? Math.max(dayStart, Math.min(preview.start, dayEnd)) : b.clipStart
    const ce = preview && preview.key === b.bar.key ? Math.max(dayStart, Math.min(preview.end, dayEnd)) : b.clipEnd
    // An UNKNOWN-START bar has no real start (start === end === its end anchor) so it has no natural
    // height — give it a fixed upward lead-in from the anchor purely to host the top fade (v0.2.316),
    // the vertical mirror of the dayline's leftward START_FADE_PX tail.
    const unknownStart = !!b.bar.unknownStart && b.bar.startMs == null
    const anchorY = ((ce - dayStart) / DAY_MS) * contentH
    const by = unknownStart ? Math.max(0, anchorY - CAL_UNKNOWN_START_H) : ((cs - dayStart) / DAY_MS) * contentH
    const baseH = unknownStart ? CAL_UNKNOWN_START_H : Math.max(MIN_BLOCK_H, ((ce - cs) / DAY_MS) * contentH)
    // Unknown/open END (e.g. ongoing) gets a downward LEAD-OUT of 30min (floored at CAL_FADE_PX) added
    // below its real end so the end fade has real vertical room even when the body is tiny (v0.2.325) —
    // the vertical mirror of the unknownStart lead-in. Excludes points/instants (single moments).
    const fadeEndBar = (!!b.bar.unknownEnd || !!b.bar.openEnded) && !b.bar.point && !b.bar.instant
    const endFadePx = fadeEndBar ? Math.max(CAL_FADE_PX, (CAL_END_FADE_MS / DAY_MS) * contentH) : 0
    const bh = baseH + endFadePx
    // Duration from the bar's absolute span (NOT the clipped/floored height) so a block split across
    // days is still judged by its true length. Ongoing blocks always keep a label.
    const durMs = b.bar.startMs != null ? b.bar.endMs - b.bar.startMs : 0
    const labeled = !!b.bar.ongoing || durMs >= LABEL_MIN_DURATION_MS
    const internal = labeled && baseH >= LABEL_MIN_H && bw >= LABEL_MIN_W
    // Default headroom = full body: childless blocks (and parents until we measure their children below)
    // have their whole top free for a horizontal title. placeNested overrides this for parents.
    return { bar: b.bar, bx, by, bw, bh, internal, labeled, depth, hasChildren, headroomPx: baseH, endFadePx }
  }
  // NESTED placement (v0.2.322 recorded, v0.2.323 planned): each sibling group splits its band into
  // concurrency lanes; a node's children are placed in the SAME band inset by NEST_BLEED_PX from the left
  // (so the parent stays visible as a left strip) and pushed AFTER the parent so children paint frontmost.
  // Used for BOTH tracks — planned in the left band [0, plannedW], recorded in the right band
  // [dayColW - recordedW, dayColW].
  const placeNested = (nodes: NestNode[], x0: number, w: number, out: PlacedBlock[]) => {
    for (const n of nodes) {
      const laneW = w / n.laneCount
      const bx = x0 + n.lane * laneW + 0.5
      const bw = Math.max(NEST_MIN_W, laneW - 1)
      const placed = mkPlaced(n.block, bx, bw, n.depth, n.children.length > 0)
      out.push(placed)
      if (n.children.length) {
        const childX = bx + NEST_BLEED_PX
        const childW = Math.max(NEST_MIN_W, bw - NEST_BLEED_PX)
        const before = out.length
        placeNested(n.children, childX, childW, out)
        // Headroom = gap from this parent's top to the TOP of its nearest descendant (all descendants are
        // time-contained, so the topmost one bounds the clear top region). If that gap is roomy the title
        // renders horizontally at the top; if a child hugs the top it falls back to the rotated left strip.
        const descendants = out.slice(before)
        const nearestTop = descendants.reduce((min, d) => Math.min(min, d.by), Number.POSITIVE_INFINITY)
        placed.headroomPx = Math.max(0, nearestTop - placed.by)
      }
    }
  }
  // Re-pack a set of ROOT nodes into cluster-LOCAL concurrency lanes (packColumn over just this subset),
  // returning clones with cluster-local lane/laneCount. Root nodes arrive packed against the whole day; a
  // cluster is time-disjoint from the rest, so re-packing its members yields lanes 0..(clusterPeak-1) and
  // the correct cluster-local laneCount that drives its width split + lane widths.
  const repackRoots = (nodes: NestNode[]): NestNode[] => {
    if (nodes.length === 0) return nodes
    const packed = packColumn(nodes.map((n) => ({ bar: n.block.bar, clipStart: n.block.clipStart, clipEnd: n.block.clipEnd })))
    return nodes.map((n) => {
      const pk = packed.find((p) => p.bar.key === n.block.bar.key && p.clipStart === n.block.clipStart)
      return pk ? { ...n, lane: pk.lane, laneCount: pk.laneCount } : n
    })
  }

  // CLUSTER the roots of BOTH tracks by time-overlap (v0.2.335). Sorted by start, a root opens a new
  // cluster when it starts at/after the running union's end, else it joins + extends it. Each cluster is
  // time-disjoint from the others, so it can take its OWN width split with no cross-cluster collision.
  const rootsAll = [
    ...plannedRoots.map((node) => ({ node, planned: true })),
    ...recordedRoots.map((node) => ({ node, planned: false })),
  ].sort((a, b) => a.node.block.clipStart - b.node.block.clipStart)
  const clusters: { node: NestNode; planned: boolean }[][] = []
  let curEnd = Number.NEGATIVE_INFINITY
  for (const r of rootsAll) {
    if (clusters.length === 0 || r.node.block.clipStart >= curEnd) {
      clusters.push([r])
      curEnd = r.node.block.clipEnd
    } else {
      clusters[clusters.length - 1].push(r)
      curEnd = Math.max(curEnd, r.node.block.clipEnd)
    }
  }

  const placed: PlacedBlock[] = []
  const dividers: { x: number; y0: number; y1: number }[] = []
  for (const cluster of clusters) {
    const plannedNodes = repackRoots(cluster.filter((r) => r.planned).map((r) => r.node))
    const recordedNodes = repackRoots(cluster.filter((r) => !r.planned).map((r) => r.node))
    const Lp = plannedNodes[0]?.laneCount ?? 0
    const Lr = recordedNodes[0]?.laneCount ?? 0
    const recordedW = dayColW * recFracFor(Lp, Lr)
    const plannedW = dayColW - recordedW
    const start = placed.length
    placeNested(plannedNodes, 0, plannedW, placed)
    placeNested(recordedNodes, dayColW - recordedW, recordedW, placed)
    // Divider segment: only when this cluster has BOTH tracks, spanning just this cluster's vertical extent.
    if (Lp > 0 && Lr > 0) {
      const seg = placed.slice(start)
      const y0 = seg.reduce((m, b) => Math.min(m, b.by), Number.POSITIVE_INFINITY)
      const y1 = seg.reduce((m, b) => Math.max(m, b.by + b.bh), 0)
      if (Number.isFinite(y0)) dividers.push({ x: plannedW, y0, y1 })
    }
  }

  // INSTANTS (v0.2.320) — zero-duration moments take the WHOLE day width and paint FRONTMOST (returned
  // last), so spans behind them are never shrunk to make room. Each carries a persistent centered chip
  // (its only readable surface, since a moment has no height for an inside label).
  const chips: LabelChip[] = []
  const instantR: PlacedBlock[] = instantBlocks.map((b) => {
    const t =
      preview && preview.key === b.bar.key
        ? Math.max(dayStart, Math.min(preview.end, dayEnd))
        : b.clipEnd
    const ty = ((t - dayStart) / DAY_MS) * contentH
    const by = Math.max(0, ty - MIN_BLOCK_H / 2)
    // Centered chip, up to 75% of the day width, wrapping within that cap; vertically centered on the tick.
    const lw = Math.min(Math.max(24, dayColW - 4), Math.round(dayColW * 0.75))
    const lx = Math.max(2, (dayColW - lw) / 2)
    const ly = Math.min(Math.max(ty - CHIP_H / 2, 0), Math.max(0, contentH - CHIP_H))
    chips.push({ bar: b.bar, lx, ly, lw, lh: CHIP_H })
    return { bar: b.bar, bx: 0, by, bw: dayColW, bh: MIN_BLOCK_H, internal: false, labeled: true, depth: 0, hasChildren: false, headroomPx: MIN_BLOCK_H, endFadePx: 0 }
  })

  return { blocks: [...placed, ...instantR], chips, dividers }
}

/** A readable text ink for a solid accent fill. oklch strings expose lightness directly as the first
 *  number (0..1); a hex fallback uses relative luminance. Light fills ⇒ dark ink, dark fills ⇒ light. */
function readableInk(color: string): string {
  const dark = "oklch(0.22 0 0)"
  const light = "oklch(0.98 0 0)"
  const ok = color.match(/oklch\(\s*([\d.]+)/i)
  if (ok) return Number.parseFloat(ok[1]) > 0.62 ? dark : light
  const hex = color.match(/^#?([0-9a-f]{6})$/i)
  if (hex) {
    const n = Number.parseInt(hex[1], 16)
    const r = (n >> 16) & 255,
      g = (n >> 8) & 255,
      b = n & 255
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return lum > 0.6 ? dark : light
  }
  return dark
}

/** Resolve a bar's fill/border/ink for a block. Mirrors the dayline: the colorless root maps to a
 *  theme-background chip with a grey hairline; everything else uses its accent fill. */
function blockColors(bar: CalBar): { background: string; border: string; ink: string; isRoot: boolean } {
  if (bar.color === ROOT_SENTINEL_COLOR) {
    return { background: "var(--background)", border: NEUTRAL, ink: "var(--foreground)", isRoot: true }
  }
  const background = bar.sky ?? bar.color
  return { background, border: bar.stroke ?? bar.color, ink: readableInk(background), isRoot: false }
}

export function Zero0Calendar({
  centerTime,
  height,
  onOpen,
  onEmptyClick,
  onContextMenuEntity,
  onOccurrenceMenu,
  onSessionMenu,
  onOccurrenceRetime,
  onSessionRetime,
  dataRev,
  highlightId = null,
}: {
  /** The dayline window's center time — the calendar centers its visible days on THIS day. */
  centerTime: number
  /** Pixel height the calendar should occupy (the Agenda animates this during the morph). */
  height: number
  onOpen: (id: string) => void
  /** Click on empty calendar area → collapse back to the dayline. */
  onEmptyClick?: () => void
  onContextMenuEntity?: (id: string, ev: React.MouseEvent) => void
  onOccurrenceMenu?: (entityId: string, occ: NonNullable<DaylineOccRef>, ev: React.MouseEvent) => void
  onSessionMenu?: (entityId: string, anchorId: number, ev: React.MouseEvent) => void
  /** Drag a PLANNED block's top/bottom edge → commit its new start/end (mirror of the dayline's
   *  edge-drag retime, but VERTICAL). Absent ⇒ planned blocks are not resizable. */
  onOccurrenceRetime?: (entityId: string, occ: NonNullable<DaylineOccRef>, start: number, end: number) => void
  /** Bottom-rail mirror: drag a RECORDED block's top/bottom edge → commit its new session span. */
  onSessionRetime?: (entityId: string, anchorId: number, start: number, end: number) => void
  dataRev: number
  highlightId?: string | null
}) {
  const now = useNowSeconds()
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const dayHeaderInnerRef = useRef<HTMLDivElement | null>(null)
  const hourGutterInnerRef = useRef<HTMLDivElement | null>(null)
  // A right-click menu dismisses on `mousedown`, which unmounts it BEFORE the container's `onClick`
  // (mouseup) empty-click toggle runs — so the toggle can't see it and would flip the view. Capture at
  // pointerdown-capture (fires before the menu's window mousedown listener) whether a menu was open, then
  // consume it in onClick to swallow the dismiss click. (v0.2.322)
  const menuWasOpenRef = useRef(false)
  const [frameW, setFrameW] = useState(0)
  // Entity id currently hovered on the calendar. Hovering any block of an entity lifts ALL that entity's
  // AUTO-play (76%-dimmed) blocks back to full opacity (v0.2.334) — a quick way to inspect a faint presence.
  const [hoverId, setHoverId] = useState<string | null>(null)

  // NOW-marker "sightlines" (v0.2.331): four diagonals from the visible frame's corners converging on the
  // now-marker's left/right vertices, so the thin now line is easy to locate at a glance. The overlay is
  // pinned to the viewport (not the scroll content), so we repaint the line endpoints imperatively on every
  // scroll (like the sticky header/gutter) rather than re-rendering the whole calendar. Geometry snapshot is
  // kept in a ref so the stable scroll handler can read current values.
  const sightlineSvgRef = useRef<SVGSVGElement | null>(null)
  // Each sightline is a TAPERED quad (v0.2.337): 1px wide at the frame corner, 5px at the now marker, so
  // it visually "points" at the marker. Rendered as <polygon> (a plain <line> can't vary width).
  const slTL = useRef<SVGPolygonElement | null>(null)
  const slBL = useRef<SVGPolygonElement | null>(null)
  const slTR = useRef<SVGPolygonElement | null>(null)
  const slBR = useRef<SVGPolygonElement | null>(null)
  const nowGeomRef = useRef({ hasNow: false, dayIdx: -1, dayColW: 0, contentY: 0, frameW: 0, bodyH: 0 })

  // Measure the frame width to choose how many day columns fit comfortably.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setFrameW(w)
    })
    ro.observe(el)
    setFrameW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const bodyH = Math.max(0, height - DAY_HEADER_H)
  // hourH grows to fit 24h in the body when there's room; floors at MIN_HOUR_H (⇒ vertical scroll).
  const hourH = Math.max(MIN_HOUR_H, Math.floor(bodyH / 24))
  const contentH = 24 * hourH
  const needsVScroll = contentH > bodyH + 0.5

  // Day columns. `visibleDays` fit in the frame; render a buffer each side for horizontal scroll.
  const dayColW = Math.max(MIN_DAY_W, frameW > 0 ? frameW / Math.max(1, Math.floor(frameW / MIN_DAY_W)) : MIN_DAY_W)
  const visibleDays = Math.max(1, Math.floor((frameW || MIN_DAY_W) / MIN_DAY_W))
  const centerDay = startOfDay(centerTime)
  // Left-most rendered day = centerDay shifted left by half the visible span + the buffer.
  const firstDay = useMemo(() => {
    let d = centerDay
    const back = Math.floor(visibleDays / 2) + DAY_BUFFER
    for (let i = 0; i < back; i++) d = startOfDay(d - HOUR_MS * 6) // step safely back one day (DST-safe)
    return d
  }, [centerDay, visibleDays])
  const totalDays = visibleDays + 2 * DAY_BUFFER
  const days = useMemo(() => {
    const out: { start: number; end: number }[] = []
    let d = firstDay
    for (let i = 0; i < totalDays; i++) {
      const end = nextMidnight(d)
      out.push({ start: d, end })
      d = end
    }
    return out
  }, [firstDay, totalDays])

  const rangeLo = days[0]?.start ?? centerDay
  const rangeHi = days[days.length - 1]?.end ?? centerDay + DAY_MS

  // Build the shared bars, then pack per day per column.
  const { planned, recorded } = useMemo(
    () => getCalendarBars(rangeLo, rangeHi, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangeLo, rangeHi, now, dataRev],
  )
  // INSTANTS are pulled OUT of the lane-packed spans (v0.2.320): they render full-day-width + frontmost,
  // so they must NOT inflate the planned/recorded lane counts that drive the per-day width split. All
  // instants (from either track) share one full-width overlay list.
  const plannedSpans = useMemo(() => planned.filter((b) => !b.instant), [planned])
  const recordedSpans = useMemo(() => recorded.filter((b) => !b.instant), [recorded])
  const instantBars = useMemo(
    () => [...planned.filter((b) => b.instant), ...recorded.filter((b) => b.instant)],
    [planned, recorded],
  )

  /** For a track's bars, clip to the day and pack. When a `preview` is active (a live resize OR move),
   *  the previewed bar uses its preview span for BOTH day-overlap and clipping ����� so a block dragged to
   *  another day/time appears on its NEW day under the cursor before commit (v0.2.318). */
  const packForDay = useCallback(
    (bars: CalBar[], dayStart: number, dayEnd: number, preview?: { key: string; start: number; end: number } | null): Block[] => {
      const clipped: { bar: CalBar; clipStart: number; clipEnd: number }[] = []
      for (const bar of bars) {
        const usePv = preview && preview.key === bar.key
        const s = usePv ? preview!.start : (bar.startMs ?? bar.endMs)
        const e = usePv ? preview!.end : bar.endMs
        if (e <= dayStart || s >= dayEnd) continue
        clipped.push({ bar, clipStart: Math.max(s, dayStart), clipEnd: Math.min(e, dayEnd) })
      }
      return packColumn(clipped)
    },
    [],
  )

  /** The presentation glyph descriptor for a block's entity (kind + state), shared with the content
   *  rows via `getFaceModel` — so a block shows the SAME glyph the entity shows everywhere else. */
  const glyphFor = useCallback((id: string) => {
    const e = getEntity(id)
    return e ? getFaceModel(e, now) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, dataRev])

  // ── BLOCK EDGE-RESIZE (v0.2.315) — the calendar mirror of the dayline's edge-drag retime, but
  // VERTICAL: drag a block's TOP handle to move its start, its BOTTOM handle to move its end (the
  // other edge stays put). px��ms uses `contentH` (one whole day spans contentH px), captured at grab
  // like the dayline captures its lane width. `calEditRef` holds the live span; `editPreview` mirrors
  // it into the render so the block resizes under the cursor before commit; `editDraggedRef` gates the
  // click-to-open that would otherwise fire on release. Routes planned → onOccurrenceRetime, recorded
  // → onSessionRetime, exactly like the dayline.
  const calEditRef = useRef<{
    edge: "start" | "end"
    key: string
    entityId: string
    occRef?: NonNullable<DaylineOccRef>
    sessionAnchorId?: number
    origStart: number
    origEnd: number
    startY: number
    contentH: number
    curStart: number
    curEnd: number
  } | null>(null)
  const [editPreview, setEditPreview] = useState<{ key: string; start: number; end: number } | null>(null)
  const editDraggedRef = useRef(false)

  const beginResize = useCallback(
    (edge: "start" | "end", bar: CalBar) => (e: React.PointerEvent) => {
      const isOcc = bar.track === "planned" && !!bar.occRef && !!onOccurrenceRetime
      const isSession = bar.track === "recorded" && bar.sessionAnchorId != null && !!onSessionRetime
      if (e.button !== 0 || (!isOcc && !isSession) || bar.startMs == null || bar.endMs == null) return
      e.stopPropagation()
      calEditRef.current = {
        edge,
        key: bar.key,
        entityId: bar.id,
        occRef: isOcc ? bar.occRef : undefined,
        sessionAnchorId: isSession ? bar.sessionAnchorId : undefined,
        origStart: bar.startMs,
        origEnd: bar.endMs,
        startY: e.clientY,
        contentH,
        curStart: bar.startMs,
        curEnd: bar.endMs,
      }
      editDraggedRef.current = false
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [onOccurrenceRetime, onSessionRetime, contentH],
  )
  const moveResize = useCallback((e: React.PointerEvent) => {
    const d = calEditRef.current
    if (!d) return
    e.stopPropagation()
    const dy = e.clientY - d.startY
    if (Math.abs(dy) > 2) editDraggedRef.current = true
    const deltaMs = (dy / d.contentH) * DAY_MS
    let start = d.origStart
    let end = d.origEnd
    if (d.edge === "start") start = Math.min(roundToMinute(d.origStart + deltaMs), d.origEnd - MIN_OCC_MS)
    else end = Math.max(roundToMinute(d.origEnd + deltaMs), d.origStart + MIN_OCC_MS)
    d.curStart = start
    d.curEnd = end
    setEditPreview({ key: d.key, start, end })
  }, [])
  const endResize = useCallback(
    (e: React.PointerEvent) => {
      const d = calEditRef.current
      calEditRef.current = null
      if (!d) return
      e.stopPropagation()
      const el = e.currentTarget as HTMLElement
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (editDraggedRef.current && (d.curStart !== d.origStart || d.curEnd !== d.origEnd)) {
        if (d.sessionAnchorId != null) onSessionRetime?.(d.entityId, d.sessionAnchorId, d.curStart, d.curEnd)
        else if (d.occRef) onOccurrenceRetime?.(d.entityId, d.occRef, d.curStart, d.curEnd)
      }
      setEditPreview(null)
      requestAnimationFrame(() => {
        editDraggedRef.current = false
      })
    },
    [onOccurrenceRetime, onSessionRetime],
  )

  // ── BLOCK MOVE / DRAG-TO-REPLAN (v0.2.318) — grab a block's BODY and drag it to a new time/day to
  // replan it, mirroring the dayline's tick retime but as a 2D TRANSLATION: vertical drag shifts the
  // time-of-day (px→ms via `contentH`), horizontal drag shifts whole DAYS (px→days via the day column
  // width). The DURATION is preserved (both edges move together) and the TRACK is fixed (planned stays
  // planned, recorded stays recorded). Reuses `editPreview` + `editDraggedRef`; commit routes to the
  // same writers as resize. Distinct from the dayline, whose body-drag pans the timeline instead.
  const calMoveRef = useRef<{
    key: string
    entityId: string
    occRef?: NonNullable<DaylineOccRef>
    sessionAnchorId?: number
    origStart: number
    origEnd: number
    dur: number
    startX: number
    startY: number
    dayColW: number
    contentH: number
    curStart: number
    curEnd: number
  } | null>(null)

  const beginMove = useCallback(
    (bar: CalBar) => (e: React.PointerEvent) => {
      const isOcc = bar.track === "planned" && !!bar.occRef && !!onOccurrenceRetime
      const isSession = bar.track === "recorded" && bar.sessionAnchorId != null && !!onSessionRetime
      if (e.button !== 0 || (!isOcc && !isSession) || bar.startMs == null || bar.endMs == null) return
      // NOTE: do NOT stopPropagation — a plain click (no drag) must still bubble to open the entity.
      calMoveRef.current = {
        key: bar.key,
        entityId: bar.id,
        occRef: isOcc ? bar.occRef : undefined,
        sessionAnchorId: isSession ? bar.sessionAnchorId : undefined,
        origStart: bar.startMs,
        origEnd: bar.endMs,
        dur: bar.endMs - bar.startMs,
        startX: e.clientX,
        startY: e.clientY,
        dayColW,
        contentH,
        curStart: bar.startMs,
        curEnd: bar.endMs,
      }
      editDraggedRef.current = false
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [onOccurrenceRetime, onSessionRetime, dayColW, contentH],
  )
  const moveMove = useCallback((e: React.PointerEvent) => {
    const d = calMoveRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) editDraggedRef.current = true
    if (!editDraggedRef.current) return
    e.stopPropagation()
    const dayShift = Math.round(dx / d.dayColW) * DAY_MS
    const timeShift = (dy / d.contentH) * DAY_MS
    const start = roundToMinute(d.origStart + dayShift + timeShift)
    d.curStart = start
    d.curEnd = start + d.dur
    setEditPreview({ key: d.key, start: d.curStart, end: d.curEnd })
  }, [])
  const endMove = useCallback(
    (e: React.PointerEvent) => {
      const d = calMoveRef.current
      calMoveRef.current = null
      if (!d) return
      const el = e.currentTarget as HTMLElement
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (editDraggedRef.current && (d.curStart !== d.origStart || d.curEnd !== d.origEnd)) {
        e.stopPropagation()
        if (d.sessionAnchorId != null) onSessionRetime?.(d.entityId, d.sessionAnchorId, d.curStart, d.curEnd)
        else if (d.occRef) onOccurrenceRetime?.(d.entityId, d.occRef, d.curStart, d.curEnd)
      }
      setEditPreview(null)
      requestAnimationFrame(() => {
        editDraggedRef.current = false
      })
    },
    [onOccurrenceRetime, onSessionRetime],
  )

  // Center the initial scroll: horizontally on centerDay, vertically on now (when scrolling).
  const didInit = useRef(false)
  useEffect(() => {
    const body = bodyRef.current
    if (!body || frameW === 0 || didInit.current) return
    didInit.current = true
    const centerIdx = days.findIndex((d) => d.start === centerDay)
    if (centerIdx >= 0) {
      const target = centerIdx * dayColW - (frameW - dayColW) / 2
      body.scrollLeft = Math.max(0, target)
    }
    if (needsVScroll) {
      const nowY = ((now - startOfDay(now)) / DAY_MS) * contentH
      body.scrollTop = Math.max(0, nowY - bodyH / 2)
    }
    // No explicit sightline repaint here: setting scrollLeft/Top above is synchronous, so the geometry-sync
    // effect that runs immediately after (and the scroll event it triggers) repaints with the right offset.
  }, [frameW, days, centerDay, dayColW, needsVScroll, now, contentH, bodyH])

  // Repaint the NOW-marker sightlines from the current scroll offset + geometry snapshot. The four
  // diagonals fan from the frame corners to the marker's on-screen vertices: both LEFT corners → the
  // marker's left vertex, both RIGHT corners → its right vertex. Hidden when today isn't in range.
  const paintNowSightlines = useCallback(() => {
    const body = bodyRef.current
    const svg = sightlineSvgRef.current
    const g = nowGeomRef.current
    if (!body || !svg) return
    if (!g.hasNow || g.frameW <= 0) {
      svg.style.display = "none"
      return
    }
    svg.style.display = "block"
    const lx = g.dayIdx * g.dayColW - body.scrollLeft // marker left vertex (viewport x)
    const rx = lx + g.dayColW // marker right vertex
    const vy = g.contentY - body.scrollTop // marker y (viewport)
    // Build a tapered quad from corner (cx,cy) to marker (mx,my): CORNER_HW px half-width at the corner,
    // MARKER_HW px at the marker, offset perpendicular to the line direction. Degenerate (zero-length) lines
    // collapse to an empty polygon.
    const CORNER_HW = 0.5 // 1px total at the corner
    const MARKER_HW = 2.5 // 5px total at the marker
    const set = (ref: React.RefObject<SVGPolygonElement | null>, cx: number, cy: number, mx: number, my: number) => {
      const el = ref.current
      if (!el) return
      const dx = mx - cx
      const dy = my - cy
      const len = Math.hypot(dx, dy)
      if (len < 0.01) {
        el.setAttribute("points", "")
        return
      }
      const px = -dy / len // unit perpendicular
      const py = dx / len
      const p = (x: number, y: number, hw: number) => `${x + px * hw},${y + py * hw}`
      el.setAttribute(
        "points",
        `${p(cx, cy, CORNER_HW)} ${p(mx, my, MARKER_HW)} ${p(mx, my, -MARKER_HW)} ${p(cx, cy, -CORNER_HW)}`,
      )
    }
    set(slTL, 0, 0, lx, vy) // top-left corner → left vertex
    set(slBL, 0, g.bodyH, lx, vy) // bottom-left corner → left vertex
    set(slTR, g.frameW, 0, rx, vy) // top-right corner → right vertex
    set(slBR, g.frameW, g.bodyH, rx, vy) // bottom-right corner → right vertex
  }, [])

  // Sync sticky header/gutter to the body scroll via transforms (robust cross-axis sticky).
  const onBodyScroll = useCallback(() => {
    const body = bodyRef.current
    if (!body) return
    if (dayHeaderInnerRef.current) dayHeaderInnerRef.current.style.transform = `translateX(${-body.scrollLeft}px)`
    if (hourGutterInnerRef.current) hourGutterInnerRef.current.style.transform = `translateY(${-body.scrollTop}px)`
    paintNowSightlines()
  }, [paintNowSightlines])

  // When vertical content fits, redirect vertical wheel to horizontal day scroll (plan behavior).
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const body = bodyRef.current
      if (!body) return
      if (!needsVScroll && e.deltaY !== 0 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        body.scrollLeft += e.deltaY
      }
    },
    [needsVScroll],
  )

  const todayStart = startOfDay(now)
  const totalW = totalDays * dayColW
  const hours = Array.from({ length: 24 }, (_, h) => h)

  // NOW-marker geometry (shared by the now line and the sightlines overlay).
  const nowDayIdx = now >= rangeLo && now < rangeHi ? days.findIndex((d) => now >= d.start && now < d.end) : -1
  const nowContentY = ((now - todayStart) / DAY_MS) * contentH
  const hasNow = nowDayIdx >= 0

  // Keep the sightline geometry snapshot in sync and repaint (endpoints depend on live scroll offset, read
  // inside paintNowSightlines). Runs whenever the marker position, day metrics, or frame size change.
  useEffect(() => {
    nowGeomRef.current = { hasNow, dayIdx: nowDayIdx, dayColW, contentY: nowContentY, frameW, bodyH }
    paintNowSightlines()
  }, [hasNow, nowDayIdx, dayColW, nowContentY, frameW, bodyH, paintNowSightlines])

  return (
    <div
      className="relative flex select-none flex-col overflow-hidden bg-background"
      style={{ height }}
      onPointerDownCapture={() => {
        menuWasOpenRef.current = typeof document !== "undefined" && !!document.querySelector("[data-zero-menu]")
      }}
      onClick={(e) => {
        // Swallow the click that merely dismissed an open right-click menu (see menuWasOpenRef).
        if (menuWasOpenRef.current) {
          menuWasOpenRef.current = false
          return
        }
        if (!(e.target as HTMLElement).closest("[data-calblock]")) onEmptyClick?.()
      }}
    >
      {/* DAY HEADER ROW (sticky top, synced to horizontal scroll) */}
      <div className="flex shrink-0 border-b border-border" style={{ height: DAY_HEADER_H }}>
        <div className="shrink-0 border-r border-border" style={{ width: HOUR_GUTTER_W }} />
        <div className="relative flex-1 overflow-hidden">
          <div ref={dayHeaderInnerRef} className="absolute inset-y-0 left-0 flex" style={{ width: totalW }}>
            {days.map((d) => {
              const isToday = d.start === todayStart
              return (
                <div
                  key={d.start}
                  className={cn(
                    "flex items-center gap-1.5 border-r border-border px-2 text-[11px] uppercase tracking-wider",
                    isToday ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                  style={{ width: dayColW }}
                >
                  <span className="tabular-nums">{new Date(d.start).toLocaleDateString([], { weekday: "short" })}</span>
                  <span className="tabular-nums">{new Date(d.start).getDate()}</span>
                  {isToday && <span className="h-1 w-1 rounded-full" style={{ backgroundColor: NOW_COLOR }} />}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* BODY: hour gutter (sticky left) + scrollable grid */}
      <div className="relative flex min-h-0 flex-1">
        {/* HOUR GUTTER (synced to vertical scroll) */}
        <div className="relative shrink-0 overflow-hidden border-r border-border" style={{ width: HOUR_GUTTER_W }}>
          <div ref={hourGutterInnerRef} className="absolute inset-x-0 top-0" style={{ height: contentH }}>
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: h * hourH }}
              >
                {h === 0 ? "" : `${h.toString().padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
        </div>

        {/* SCROLL BODY (both axes) */}
        <div
          ref={bodyRef}
          className={cn("relative min-w-0 flex-1", needsVScroll ? "overflow-auto" : "overflow-x-auto overflow-y-hidden")}
          onScroll={onBodyScroll}
          onWheel={onWheel}
        >
          <div className="relative" style={{ width: totalW, height: contentH }}>
            {/* Hour gridlines */}
            {hours.map((h) => (
              <div
                key={h}
                className="pointer-events-none absolute inset-x-0 border-t border-border/40"
                style={{ top: h * hourH }}
              />
            ))}

            {/* Day columns: dynamic planned/recorded split + packed blocks + full-width instants */}
            {days.map((d, di) => {
              const x = di * dayColW
              const plannedBlocks = packForDay(plannedSpans, d.start, d.end, editPreview)
              const recordedBlocks = packForDay(recordedSpans, d.start, d.end, editPreview)
              const instantBlocks = packForDay(instantBars, d.start, d.end, editPreview)
              // Nest child blocks inside their ancestors, CROSS-TRACK + kind-agnostic (v0.2.322 recorded,
              // .323 planned, .328 cross-track fix — e.g. a Task nested inside a parent Moment/"Day Job",
              // even when one is planned and the other recorded). ONE forest across both tracks; a block's
              // root status decides its band, the whole subtree renders in the root's band. Nested children
              // inset instead of adding columns.
              const { plannedRoots, recordedRoots } = forestNestCombined(plannedBlocks, recordedBlocks)
              // PER-CLUSTER WIDTH SPLIT (v0.2.335, was per-day .320): layoutDay groups the roots into
              // time-connected clusters and splits each independently (planned left, recorded right), so a
              // planned block with no recorded overlap in its cluster stays FULL width even when other hours
              // have recorded sessions. It returns per-cluster divider segments for the boundary line.
              const { blocks, chips, dividers } = layoutDay(
                plannedRoots,
                recordedRoots,
                instantBlocks,
                d.start,
                dayColW,
                contentH,
                editPreview,
              )
              const ctxMenu = (bar: CalBar, e: React.MouseEvent) => {
                if (bar.occRef && onOccurrenceMenu) onOccurrenceMenu(bar.id, bar.occRef, e)
                else if (bar.sessionAnchorId != null && onSessionMenu) onSessionMenu(bar.id, bar.sessionAnchorId, e)
                else onContextMenuEntity?.(bar.id, e)
              }
              return (
                // Day wrapper — positioned at the day's x so blocks/chips use DAY-LOCAL coords.
                <div key={d.start} className="absolute top-0" style={{ left: x, width: dayColW, height: contentH }}>
                  {/* day divider (left edge) + per-cluster planned/recorded boundary segments (v0.2.335,
                      each spans only its cluster's vertical extent, drawn only when both tracks present) */}
                  <div className="pointer-events-none absolute inset-y-0 left-0 border-l border-border" />
                  {dividers.map((seg, si) => (
                    <div
                      key={si}
                      className="pointer-events-none absolute border-l border-border/30"
                      style={{ left: seg.x, top: seg.y0, height: seg.y1 - seg.y0 }}
                    />
                  ))}

                  {/* Blocks */}
                  {blocks.map((r, i) => {
                    const { background, border, ink, isRoot } = blockColors(r.bar)
                    const dim = highlightId != null && highlightId !== r.bar.id
                    // AUTO-play (ongoing-on-enter) recorded blocks render at 60% opacity to read as
                    // presence, not deliberate activity (v0.2.332, 76%→60% in v0.2.335). Skipped while `dim`
                    // is active so the highlight fade (opacity-40) still wins, and lifted to full while THIS
                    // entity is hovered (v0.2.334) — hovering any of its blocks reveals all its faint ones.
                    const autoOpacity = r.bar.auto && !dim && hoverId !== r.bar.id ? 0.6 : undefined
                    const showTime = r.bh >= LABEL_TIME_H
                    const g = glyphFor(r.bar.id)
                    // The GLYPH spins only on the ACTUALLY-ongoing block, not on every block of an ongoing
                    // entity (v0.2.334): `g.ongoing` is a per-ENTITY face-model flag, so gate it by this
                    // bar's own live state — `ongoing` (planned occurrence in progress) or `openEnded`
                    // (open recorded session). Past/future blocks of the same entity stay static.
                    const barIsLive = !!r.bar.ongoing || !!r.bar.openEnded
                    const glyphOngoing = g?.ongoing && barIsLive
                    // Resizable ⇒ the block has a retime writer for its rail (planned occ / recorded session).
                    const resizable =
                      (r.bar.track === "planned" && !!r.bar.occRef && !!onOccurrenceRetime) ||
                      (r.bar.track === "recorded" && r.bar.sessionAnchorId != null && !!onSessionRetime)
                    const showHandles = resizable && r.bh >= RESIZE_MIN_H
                    // Movable ⇒ same retime-writer condition as resize, AND a concrete span to translate
                    // (an unknown-start block has no real start to preserve a duration from).
                    const movable = resizable && r.bar.startMs != null && r.bar.endMs != null
                    // While THIS block is being resized, recompute its range text live from the preview
                    // span so the in-block label + tooltip track the drag in real time (v0.2.315). The
                    // preview holds the whole-occurrence span (not day-clipped), so a multi-day block
                    // still reads its true new start/end as `start – end`.
                    const previewing = editPreview?.key === r.bar.key
                    const liveRange = previewing ? rangeText(editPreview!.start, editPreview!.end) : r.bar.range
                    // Unclear-edge FADES (v0.2.316): fade the block body to transparent off the BOTTOM for
                    // an unknown/open end (ongoing), off the TOP for an unknown start — the vertical mirror
                    // of the dayline's edge fades. Points and instants (single moments) never fade.
                    const fadeEnd = (!!r.bar.unknownEnd || !!r.bar.openEnded) && !r.bar.point && !r.bar.instant
                    const fadeStart = !!r.bar.unknownStart && !r.bar.point && !r.bar.instant
                    // End fade spans the block's LEAD-OUT tail (30min of timeline, floored at CAL_FADE_PX;
                    // computed in layout as r.endFadePx and already added to r.bh) so the fade is a real,
                    // noticeable chunk even when the solid body is tiny (v0.2.325).
                    const endSolidPct = r.bh > 0 ? Math.max(0, ((r.bh - r.endFadePx) / r.bh) * 100) : 0
                    const fadeMask = fadeEnd
                      ? `linear-gradient(to bottom, #000 ${endSolidPct}%, transparent 100%)`
                      : fadeStart
                        ? `linear-gradient(to bottom, transparent 0, #000 ${CAL_FADE_PX}px)`
                        : undefined
                    // Live duration shown after the range when the block is roomy AND the span is concrete
                    // (skip open/unclear edges — there's no fixed length to show).
                    const durStart = previewing ? editPreview!.start : (r.bar.startMs ?? r.bar.endMs)
                    const durEnd = previewing ? editPreview!.end : r.bar.endMs
                    const durMs = durEnd - durStart
                    const showDuration = (showTime || previewing) && r.bw >= 84 && !fadeEnd && !fadeStart && durMs >= 60_000
                    return (
                      <button
                        key={r.bar.key + ":" + i}
                        type="button"
                        data-calblock
                        data-calkey={r.bar.key}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (editDraggedRef.current) return // swallow the click that ends a resize/move drag
                          onOpen(r.bar.id)
                        }}
                        onPointerDown={movable ? beginMove(r.bar) : undefined}
                        onPointerMove={movable ? moveMove : undefined}
                        onPointerUp={movable ? endMove : undefined}
                        onPointerEnter={() => setHoverId(r.bar.id)}
                        onPointerLeave={() => setHoverId((cur) => (cur === r.bar.id ? null : cur))}
                        onContextMenu={(e) => ctxMenu(r.bar, e)}
                        className={cn(
                          "absolute overflow-hidden rounded-[3px] text-left transition-opacity",
                          movable && "cursor-grab active:cursor-grabbing",
                          dim && "opacity-40",
                          // NESTED CHILD (v0.2.330, Loris): a 1px border to lift it off the parent fill —
                          // white in light mode, black in dark mode. Roots/top-level blocks keep no border.
                          r.depth > 0 && "border border-white dark:border-black",
                        )}
                        style={{ left: r.bx, top: r.by, width: r.bw, height: r.bh, opacity: autoOpacity, touchAction: movable ? "none" : undefined }}
                        title={`${r.bar.title} · ${liveRange}`}
                      >
                        {/* FILL LAYER (v0.2.316) — carries the accent fill, the accent glow/hairline AND
                            the unclear-edge fade mask, so the label above stays fully crisp while the block
                            body fades to transparent at an unknown start/end (mirror of the dayline). */}
                        <span
                          aria-hidden
                          className="absolute inset-0 rounded-[3px]"
                          style={{
                            background,
                            // GLOW not border (v0.2.319, Loris) — the accent reads as an inset glow bleeding
                            // inward, matching the dayline; the neutral root sentinel (no accent) keeps a
                            // faint hairline for shape. Masked so an unclear-edge fade carries the glow too.
                            boxShadow: isRoot
                              ? undefined
                              : `inset 0 0 ${CAL_GLOW_BLUR_PX}px ${CAL_GLOW_SPREAD_PX}px ${border}`,
                            border: isRoot ? `1px solid ${border}` : undefined,
                            maskImage: fadeMask,
                            WebkitMaskImage: fadeMask,
                          }}
                        />
                        {/* PARENT whose child hugs the TOP (no horizontal headroom, v0.2.329): a child
                            covers the block's width right from the top, so the title renders VERTICALLY in
                            the visible left bleed strip. Anchored to the TOP with the glyph in the top-left
                            corner; the title reads BOTTOM-TO-TOP (v0.2.330, `vertical-rl` + `rotate-180`), so
                            the top-anchored glyph sits on the READING RIGHT of the title. Clips if too long. */}
                        {r.internal && r.hasChildren && r.headroomPx < LABEL_MIN_H && (
                          <span
                            className="absolute inset-y-0 left-0 z-[1] flex flex-col items-center gap-1 pt-1"
                            style={{ width: NEST_BLEED_PX + 2, color: ink }}
                          >
                            {g && (
                              <Zero0Glyph
                                kind={g.kind}
                                filled={g.filled}
                                done={g.showCheck}
                                cancelled={g.cancelled}
                                requested={g.requested}
                                scheduled={g.scheduled}
                                ongoing={glyphOngoing}
                                flip180={g.glyphFlip180}
                                className="h-3 w-3 shrink-0"
                              />
                            )}
                            <span className="whitespace-nowrap text-[10px] font-medium leading-none rotate-180 [writing-mode:vertical-rl]">
                              {r.bar.title}
                            </span>
                          </span>
                        )}
                        {r.internal && !(r.hasChildren && r.headroomPx < LABEL_MIN_H) && (
                          <span
                            className="relative flex h-full flex-col gap-0.5 px-1 py-0.5 leading-tight"
                            style={{ color: ink }}
                          >
                            {/* Glyph (the entity's own kind/state mark, e.g. a scheduled Space's thick
                                hexagon outline) sits left of the WRAPPING title (v0.2.315). It inherits
                                `ink` via currentColor so it reads on the accent fill. `mt-[1px]` aligns it
                                to the first title line; `line-clamp-2` lets the title wrap beside it. */}
                            <span className="flex items-start gap-1">
                              {g && (
                                <Zero0Glyph
                                  kind={g.kind}
                                  filled={g.filled}
                                  done={g.showCheck}
                                  cancelled={g.cancelled}
                                  requested={g.requested}
                                  scheduled={g.scheduled}
                                  ongoing={glyphOngoing}
                                  flip180={g.glyphFlip180}
                                  className="mt-[1px] h-3 w-3 shrink-0"
                                />
                              )}
                              <span className="line-clamp-2 min-h-0 break-words text-[10px] font-medium">
                                {r.bar.title}
                              </span>
                            </span>
                            {(showTime || previewing) && (
                              <span className="min-h-0 break-words text-[9px] tabular-nums opacity-70">
                                {/* RECORDED sessions show DURATION only (v0.2.322) — start/end stays on the
                                    hover tooltip. Planned keeps its range (+ duration suffix when roomy). */}
                                {r.bar.track === "recorded"
                                  ? durMs >= 60_000
                                    ? fmtDuration(durMs)
                                    : liveRange
                                  : `${liveRange}${showDuration ? ` · ${fmtDuration(durMs)}` : ""}`}
                              </span>
                            )}
                          </span>
                        )}
                        {/* TOP / BOTTOM RESIZE HANDLES (v0.2.315) — vertical mirror of the dayline's edge
                            drag. Top moves the start, bottom moves the end; each stops propagation so it
                            never triggers the block's open-click or the empty-area collapse. */}
                        {showHandles && (
                          <>
                            <span
                              className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-ns-resize"
                              onPointerDown={beginResize("start", r.bar)}
                              onPointerMove={moveResize}
                              onPointerUp={endResize}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span
                              className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-ns-resize"
                              onPointerDown={beginResize("end", r.bar)}
                              onPointerMove={moveResize}
                              onPointerUp={endResize}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </>
                        )}
                      </button>
                    )
                  })}

                  {/* Instant chips — centered over their full-width tick, frontmost (rendered last so they
                      paint above every block), content centered + wrapping within the 75%-day-width cap. */}
                  {chips.map((c, i) => {
                    const dim = highlightId != null && highlightId !== c.bar.id
                    const accent = c.bar.color === ROOT_SENTINEL_COLOR ? NEUTRAL : (c.bar.sky ?? c.bar.color)
                    const g = glyphFor(c.bar.id)
                    // Spin only when THIS chip's bar is itself live (v0.2.334) — same per-bar gate as blocks.
                    const chipGlyphOngoing = g?.ongoing && (!!c.bar.ongoing || !!c.bar.openEnded)
                    const chipRange =
                      editPreview?.key === c.bar.key ? rangeText(editPreview.start, editPreview.end) : c.bar.range
                    return (
                      <button
                        key={c.bar.key + ":lbl:" + i}
                        type="button"
                        data-calblock
                        data-calkey={c.bar.key}
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpen(c.bar.id)
                        }}
                        onContextMenu={(e) => ctxMenu(c.bar, e)}
                        className={cn(
                          "absolute z-20 flex items-center justify-center overflow-hidden rounded-[3px] border bg-background px-1 text-center transition-opacity",
                          dim && "opacity-40",
                        )}
                        style={{
                          left: c.lx,
                          top: c.ly,
                          width: c.lw,
                          // minHeight (not fixed) so a long title can wrap past two lines without clipping.
                          minHeight: c.lh,
                          // Faint ENTITY-ACCENT border (v0.2.319) instead of the neutral --border, tying the
                          // chip to its block's color; kept faint via a color-mix with transparent.
                          borderColor: `color-mix(in oklab, ${accent} 55%, transparent)`,
                        }}
                        title={`${c.bar.title} · ${chipRange}`}
                      >
                        {/* Glyph + title + TIME, in a flex-wrap row: the time sits beside the title when
                            it fits, else wraps to a second line (v0.2.319). The glyph renders in the
                            entity accent (mirror of the in-block glyph), else a fallback accent dot. */}
                        <span className="flex min-w-0 flex-wrap items-center justify-center gap-x-1 leading-tight">
                          {g ? (
                            <span className="shrink-0" style={{ color: accent }}>
                              <Zero0Glyph
                                kind={g.kind}
                                filled={g.filled}
                                done={g.showCheck}
                                cancelled={g.cancelled}
                                requested={g.requested}
                                scheduled={g.scheduled}
                                ongoing={chipGlyphOngoing}
                                flip180={g.glyphFlip180}
                                className="h-3 w-3"
                              />
                            </span>
                          ) : (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />
                          )}
                          <span className="min-w-0 truncate text-[10px] text-foreground">{c.bar.title}</span>
                          <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">{chipRange}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )
            })}

            {/* NOW line (only across today's column) */}
            {now >= rangeLo &&
              now < rangeHi &&
              (() => {
                const di = days.findIndex((d) => now >= d.start && now < d.end)
                if (di < 0) return null
                const x = di * dayColW
                const y = ((now - todayStart) / DAY_MS) * contentH
                return (
                  <div
                    className="pointer-events-none absolute z-10"
                    style={{ left: x, top: y, width: dayColW, height: 1, backgroundColor: NOW_COLOR }}
                  >
                    {/* LEFT vertex: right-pointing triangle flush to the column's LEFT edge (v0.2.336 —
                        `left-0` keeps it INSIDE today's column instead of spilling onto yesterday). */}
                    <div
                      className="absolute -top-1 left-0 h-0 w-0"
                      style={{
                        borderTop: "4px solid transparent",
                        borderBottom: "4px solid transparent",
                        borderLeft: `5px solid ${NOW_COLOR}`,
                      }}
                    />
                    {/* RIGHT vertex: mirrored LEFT-pointing triangle flush to the column's RIGHT edge
                        (v0.2.336), so the marker is bracketed by a triangle on both sides, both inside. */}
                    <div
                      className="absolute -top-1 right-0 h-0 w-0"
                      style={{
                        borderTop: "4px solid transparent",
                        borderBottom: "4px solid transparent",
                        borderRight: `5px solid ${NOW_COLOR}`,
                      }}
                    />
                  </div>
                )
              })()}
          </div>
        </div>

        {/* NOW-marker SIGHTLINES (v0.2.331): overlay pinned to the visible scroll-body frame (right of the
            hour gutter). Four faint orange diagonals fan from the frame corners to the now marker's on-screen
            vertices so the thin now line is locatable at a glance — including when it's scrolled off-screen
            (the lines then angle toward the edge). Endpoints are set imperatively in paintNowSightlines. */}
        <svg
          ref={sightlineSvgRef}
          className="pointer-events-none absolute z-20"
          style={{ left: HOUR_GUTTER_W, top: 0, width: frameW, height: bodyH }}
          width={frameW}
          height={bodyH}
          aria-hidden
        >
          <polygon ref={slTL} fill={NOW_COLOR} fillOpacity={0.22} />
          <polygon ref={slBL} fill={NOW_COLOR} fillOpacity={0.22} />
          <polygon ref={slTR} fill={NOW_COLOR} fillOpacity={0.22} />
          <polygon ref={slBR} fill={NOW_COLOR} fillOpacity={0.22} />
        </svg>
      </div>
    </div>
  )
}
