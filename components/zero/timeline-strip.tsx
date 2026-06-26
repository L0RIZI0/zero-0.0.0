"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { motion, animate } from "motion/react"
import { ChevronLeft, ChevronRight, Crosshair, Trash2, Ban, RotateCcw, Repeat, Eye, EyeOff, LayoutGrid, List } from "lucide-react"
import {
  getInheritedAccent,
  isInSubtree,
  getEntity,
  entities,
  directChildOfFocus,
  type TimelineOccurrence,
  deleteEntity,
  setEventCancelled,
} from "@/lib/zero/data"
import {
  queryTimeline,
  clusterInstants,
  applySemanticRollup,
  entityInterval,
  type StreamSeries,
  type RollupBand,
} from "@/lib/zero/timeline-index"
import {
  makeScale,
  timelineTicks,
  lodGrain,
  scrubLabel,
  spanToView,
  clampSpan,
  VIEWS,
  VIEW_SPAN_MS,
  MIN_SPAN_MS,
  MAX_SPAN_MS,
  type ViewKey,
} from "@/lib/zero/timeline-scale"
import type { Entity } from "@/lib/zero/types"
import { panelTransition, layerTransition } from "@/lib/zero/motion"
import { useZeroNav } from "@/lib/zero/nav-store"
import { placementKey, resolveOriginRect } from "@/lib/zero/placement"
import { useTimelineGestures } from "@/hooks/use-timeline-gestures"
import { NodeGlyph } from "./node-glyph"
import { TimelineSerpentine, type SerpItem } from "./timeline-serpentine"
import { ContextMenu, type ContextMenuState } from "./context-menu"
import { cn } from "@/lib/utils"

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
// Fixed height of the serpentine (week-columns) layout. Tall enough for seven
// readable day-rows; the focus region below reflows to it via the same
// `--region1-reserve` observer that handles the linear track's dynamic height.
const SERP_H = 340

// Fallback color for items whose space chain has no accent (created directly
// under the root "Space 0"). A neutral light grey so they still read as real
// markers without claiming a brand color.
const NEUTRAL_MARKER = "oklch(0.72 0.004 75)"

/** Local midnight of `epoch`'s day, epoch ms. */
function startOfDay(epoch: number): number {
  const d = new Date(epoch)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// --- Track layout -----------------------------------------------------------
const TRACK_H = 56 // base (resting) track height — one centered lane
const LANE_H = 24
const LANE_GAP = 4
// Below this on-screen width (px) a span chip can no longer show a useful label
// (≈3 chars + dot + padding), so it COLLAPSES into a compact "marker": a smooth
// horizontal line the length of the span, a vertical color edge on its left, and
// the title floated above-left (free to overflow past the tiny span, like a pin).
 const CHIP_COLLAPSE_PX = 46
// Master switch for the "minimal chip" collapse. Disabled for now: since chip titles
// bleed past their frame, narrow chips stay fully labeled rather than collapsing to a
// line+title marker. Flip back to `true` to re-enable the marker behavior below.
const CHIP_COLLAPSE_ENABLED = false
// Vertical breathing room above+below the stacked lanes when the track grows.
const TRACK_PAD_Y = 6
// Hard ceiling on how many lanes can grow the track, so a truly pathological pile-up
// can't push the entire focus region off-screen. Beyond this, extra lanes overflow
// (clipped) rather than growing further. Sized to comfortably fit the FULL set of
// top-level life ribbons (each space ribbon can span several lanes during overlaps),
// so a populated homeview shows every ribbon — the timeline grows and pushes region 0
// down rather than cropping a ribbon (e.g. Health/Workout) at the bottom.
const MAX_STACK_LANES = 18

// --- Mother ribbons (folding) ----------------------------------------------
// A "mother ribbon" groups every lane sharing the same TOP-LEVEL ancestor (the
// child of root) — e.g. mother "Zero" gathers the pink lanes Zero / Product /
// Deck / Research. Collapsing a mother hides its lanes, leaving a thin RAIL the
// user can click to reopen; the lanes' chips "fall" onto the still-visible lanes
// as faint minimal markers. Entering a space auto-collapses the OTHER mothers.
const RAIL_H = 7 // height of a collapsed mother's reopen rail
const MOTHER_GAP = 6 // vertical gap between mother blocks (rails or lane stacks)
const MOTHER_COL_W = 20 // width of the left column holding an EXPANDED mother's vertical title

/** A contiguous block of lanes sharing one top-level ancestor. `motherId === null`
 *  means the lanes live directly at root (no mother ribbon — left ungrouped). */
interface MotherBlock {
  motherId: string | null
  title: string
  color: string
  baseLane: number // first global lane of the block
  laneCount: number // total lanes across all member ribbons
  spaceIds: string[] // member ribbon space ids, in stack order
}

// Horizontal chrome flanking the scrolling viewport, in px. The viewport is the
// shared coordinate space for gridlines, the now-marker and every marker. Any
// OVERLAY that must line up with it has to use these exact insets.
const ARROW_W = 40
const SELECTOR_W = 24
const VIEWPORT_INSET_LEFT = SELECTOR_W + ARROW_W
const VIEWPORT_INSET_RIGHT = ARROW_W

// Instant-pin geometry (px), measured from the TRACK's top edge (negative =
// ABOVE the track). A pin is a down-triangle HEAD with its title to the LEFT and
// a thin vertical STEM to the track bottom. Heads sit above the ruler.
const INSTANT_TRI = 10
const INSTANT_HEAD_CLEARANCE = 22
const INSTANT_ROW_STEP = 16
const INSTANT_STEM_GAP = 1
const INSTANT_CHAR_W = 5.6
const INSTANT_LABEL_PAD = 26

// Pixel proximity under which instants merge into one density bubble (coarse zoom).
const CLUSTER_GAP_PX = 22

// A unified horizontal "bar" on the track — events, scheduled spaces, rolled-up
// context bands, and recurring streams all lane-pack together as bars.
interface Bar {
  key: string
  from: number
  to: number
  color: string
  title: string
  kind: "event" | "space" | "band" | "stream"
  entity?: Entity
  count?: number
  cancelled?: boolean
  childId?: string
}

/** Greedy interval lane-packing within ONE group — items sorted by start, each
 *  placed in the first sub-lane whose previous item's VISUAL footprint has ended;
 *  else a new sub-lane opens. `rightEdge(b)` is the bar's effective right edge in
 *  ms (extended past `to` when its label bleeds beyond the span), so time-adjacent
 *  items whose labels would overlap get separate sub-lanes. Returns the per-key
 *  sub-lane and how many sub-lanes the group needed. */
function packGroup(bars: Bar[], rightEdge: (b: Bar) => number): { subLane: Map<string, number>; count: number } {
  const sorted = [...bars].sort((a, b) => a.from - b.from)
  const laneEnds: number[] = []
  const subLane = new Map<string, number>()
  for (const b of sorted) {
    let idx = laneEnds.findIndex((end) => end <= b.from)
    if (idx === -1) {
      idx = laneEnds.length
      laneEnds.push(rightEdge(b))
    } else {
      laneEnds[idx] = rightEdge(b)
    }
    subLane.set(b.key, idx)
  }
  return { subLane, count: Math.max(1, laneEnds.length) }
}

export interface Ribbon {
  spaceId: string
  title: string
  color: string
  baseLane: number // first global lane this ribbon occupies
  laneCount: number // how many sub-lanes it spans
}

/** Lexicographic compare of two numeric "tree path" keys (shorter-prefix first). */
function compareKey(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

/** SPACE-GROUPED ribbon packing (the time.graphics "folder" model). Bars are
 *  grouped by their containing space; each group becomes a horizontal RIBBON that
 *  occupies a contiguous block of global lanes. Within a ribbon, overlapping items
 *  still stack into sub-lanes (via `packGroup`). Ribbons are ordered by the SPACE
 *  TREE (depth-first, via `orderKey`) so a parent space and all its descendant
 *  spaces stay contiguous in the stack — e.g. Zero, then Product and Deck right
 *  below it — rather than scattering by earliest event time. */
function packRibbons(
  bars: Bar[],
  rightEdge: (b: Bar) => number,
  groupOf: (b: Bar) => string,
  spaceMeta: (spaceId: string) => { title: string; color: string },
  orderKey: (spaceId: string) => number[],
): { lane: Map<string, number>; count: number; ribbons: Ribbon[] } {
  // Bucket bars by their containing space.
  const groups = new Map<string, Bar[]>()
  for (const b of bars) {
    const g = groupOf(b)
    const entry = groups.get(g)
    if (entry) entry.push(b)
    else groups.set(g, [b])
  }
  // Order ribbons by their space's depth-first position in the tree.
  const ordered = [...groups.keys()].sort((a, b) => compareKey(orderKey(a), orderKey(b)))

  const lane = new Map<string, number>()
  const ribbons: Ribbon[] = []
  let baseLane = 0
  for (const spaceId of ordered) {
    const groupBars = groups.get(spaceId)!
    const { subLane, count } = packGroup(groupBars, rightEdge)
    for (const b of groupBars) lane.set(b.key, baseLane + (subLane.get(b.key) ?? 0))
    const meta = spaceMeta(spaceId)
    ribbons.push({ spaceId, title: meta.title, color: meta.color, baseLane, laneCount: count })
    baseLane += count
  }
  return { lane, count: Math.max(1, baseLane), ribbons }
}

export function TimelineStrip({
  contextId,
  accent,
}: {
  contextId: string
  accent?: string
}) {
  const { stack, dataVersion, notifyDataChanged, open } = useZeroNav()
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  const openFromChip = (id: string) => {
    const key = placementKey("timeline", contextId, id)
    open(id, resolveOriginRect(id, { placement: key, preferSource: "timeline" }) ?? undefined)
  }

  const stage: number = Math.min(stack.length - 1, 2)

  // Right-click any marker: cancel/restore or delete.
  const openMenu = (e: React.MouseEvent, entity: Entity) => {
    e.preventDefault()
    e.stopPropagation()
    const isCancelled = !!entity.cancelled
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: isCancelled ? "Restore" : "Cancel",
          icon: isCancelled ? <RotateCcw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />,
          onSelect: () => {
            setEventCancelled(entity.id, !isCancelled)
            notifyDataChanged()
          },
        },
        {
          label: "Delete",
          icon: <Trash2 className="h-3.5 w-3.5" />,
          onSelect: () => {
            deleteEntity(entity.id)
            notifyDataChanged()
          },
        },
      ],
    })
  }

  // --- Continuous lifeline viewport ----------------------------------------
  // The viewport is fully described by `{ startMs, spanMs }`: epoch ms at the left
  // edge, and how much time is visible. Zoom = change spanMs; pan = change startMs.
  // Default: a Day-preset window framing this morning.
  const [vp, setVp] = useState(() => ({
    startMs: startOfDay(Date.now()) + 6 * HOUR_MS,
    spanMs: VIEW_SPAN_MS.D,
  }))
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const animRef = useRef<ReturnType<typeof animate> | null>(null)

  // The entire strip is positioned from wall-clock time (`startMs`, `now`), which the
  // server can't know, so SSR markup can never match the first client paint. Rather
  // than fight per-element hydration mismatches, we render a same-height placeholder
  // until mounted, then reveal the real (time-accurate) timeline. This is a one-frame
  // deferral, invisible in practice, and keeps hydration clean.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Viewport pixel width, tracked so the d3 scale, ticks and clustering reason in
  // real pixels. Defaults to a sane guess until first measure (one frame).
  const [width, setWidth] = useState(800)
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth || 800)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
    // Re-run after `mounted` flips so the observer attaches to the REAL viewport
    // element (the pre-hydration placeholder also carries `viewportRef`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted])

  // Live "now", refreshed each ~30s so the now-marker creeps along the lifeline.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const [hoveredInstant, setHoveredInstant] = useState<string | null>(null)

  // Serpentine layout: when ON, the central viewport renders the week-columns grid
  // (time wraps vertically per week) instead of the linear lifeline. The zoom
  // selector, pan arrows and NOW control keep operating on `vp`; coarser zoom →
  // more week columns. Linear is the default.
  const [serpentine, setSerpentine] = useState(false)

  // --- Mother-ribbon folding state -----------------------------------------
  // `override` pins a mother's collapsed state to the user's explicit choice; it
  // is CLEARED whenever the focus context changes so each navigation re-derives
  // the auto-collapse (entering a space folds the others). `ticksHidden` tracks
  // mothers whose rail highlight ticks the user has hidden via the eye toggle
  // (ticks are SHOWN by default). `hoveredMother` brightens a collapsed mother's
  // rail ticks while its rail is hovered.
  const [override, setOverride] = useState<Record<string, boolean>>({})
  const [ticksHidden, setTicksHidden] = useState<Record<string, boolean>>({})
  const [hoveredMother, setHoveredMother] = useState<string | null>(null)
  useEffect(() => {
    setOverride({})
  }, [contextId])

  const { startMs, spanMs } = vp
  const center = startMs + spanMs / 2
  const grain = useMemo(() => lodGrain(spanMs, width), [spanMs, width])
  const activeView: ViewKey = useMemo(() => spanToView(spanMs), [spanMs])

  // Epoch ms → percentage across the viewport (linear; equivalent to the d3
  // scale but width-independent, so markers reflow without a width read).
  const pct = (epoch: number) => ((epoch - startMs) / spanMs) * 100
  // d3 time scale (px) — used for tick generation and pixel clustering.
  const scale = useMemo(() => makeScale(startMs, spanMs, width), [startMs, spanMs, width])

  // --- Gestures: cursor-anchored wheel zoom + drag/scroll pan --------------
  const { onPointerDown } = useTimelineGestures({
    viewportRef,
    view: vp,
    onChange: (next) => {
      animRef.current?.stop()
      setVp(next)
    },
    minSpan: MIN_SPAN_MS,
    maxSpan: MAX_SPAN_MS,
    // Re-bind the wheel listener once the real viewport replaces the placeholder.
    enabled: mounted,
    onGestureStart: () => {
      animRef.current?.stop()
    },
  })

  // --- Data query (bounded, LOD-aware) -------------------------------------
  // Range = viewport ± 25% padding, rounded to a fraction of the span so we only
  // re-query when the rounded window (or grain / data / focus) changes — not on
  // every pan frame. queryTimeline never walks huge ranges (recurrences become
  // streams at coarse zoom), so this stays cheap from a day to a whole life.
  const pad = spanMs * 0.25
  const bucket = Math.max(60_000, spanMs / 6)
  const qStart = Math.floor((startMs - pad) / bucket) * bucket
  const qEnd = Math.ceil((startMs + spanMs + pad) / bucket) * bucket
  // We always query the WHOLE tree (the root context), not just the focused
  // entity's subtree, so opening an entity never makes the rest of the lifeline
  // disappear — unrelated markers stay on the timeline, just dimmed (see
  // `relatedFactor`). `contextId` remains the FOCUS used for semantic rollup and
  // for deciding what counts as "related".
  const rootId = stack[0]
  const query = useMemo(
    () => queryTimeline(rootId, qStart, qEnd, grain),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rootId, grain, qStart, qEnd, dataVersion],
  )

  // Relatedness → opacity. When the focus IS the root (home view) everything is
  // related, so nothing dims. Once inside an entity, anything whose container
  // space falls outside the focus subtree fades back to a faint ambient layer.
  const atRootFocus = contextId === rootId
  const UNRELATED_OPACITY = 0.3
  const relatedFactor = (parentId?: string | null, id?: string | null): number => {
    if (atRootFocus) return 1
    const container = parentId ?? "s_root"
    const related = isInSubtree(contextId, container) || (id != null && isInSubtree(contextId, id))
    return related ? 1 : UNRELATED_OPACITY
  }

  // Adaptive semantic rollup: crowded child subtrees collapse into context bands.
  const rolled = useMemo(
    () => applySemanticRollup(query.items, contextId, width),
    [query, contextId, width],
  )

  const instants = useMemo(() => rolled.items.filter((e) => e.kind === "instant"), [rolled])
  const spans = useMemo(
    () => rolled.items.filter((e) => e.kind === "event" || e.kind === "space"),
    [rolled],
  )

  // Instants merged into density bubbles by pixel proximity. Singleton clusters
  // render as normal pins; multi-clusters as count bubbles that expand on zoom-in.
  const clusters = useMemo(
    () => clusterInstants(instants, scale, CLUSTER_GAP_PX),
    [instants, scale],
  )

  // All horizontal bars (spans + rollup bands + recurring streams) in one set.
  const bars = useMemo<Bar[]>(() => {
    const out: Bar[] = []
    for (const e of spans) {
      const [from, to] = entityInterval(e)
      out.push({
        key: e.occKey,
        from,
        to,
        color: getInheritedAccent(e.parentId ?? "s_root") ?? NEUTRAL_MARKER,
        title: e.title,
        kind: e.kind === "space" ? "space" : "event",
        entity: e,
        cancelled: e.cancelled,
      })
    }
    for (const b of rolled.bands as RollupBand[]) {
      out.push({
        key: `band:${b.childId}`,
        from: b.from,
        to: b.to,
        color: b.color,
        title: b.title,
        kind: "band",
        count: b.count,
        childId: b.childId,
      })
    }
    for (const s of query.streams as StreamSeries[]) {
      out.push({
        key: `stream:${s.entity.id}`,
        from: s.from,
        to: s.to,
        color: s.color,
        title: s.entity.title,
        kind: "stream",
        entity: s.entity,
        count: Math.round(s.approxCount),
      })
    }
    return out
  }, [spans, rolled, query])

  // --- Serpentine model ----------------------------------------------------
  // How many week columns to show: derived from the current span (coarser zoom →
  // more weeks), clamped to a comfortable 3–14 so a column never gets too thin.
  const weekCount = useMemo(
    () => Math.min(14, Math.max(3, Math.round(spanMs / WEEK_MS))),
    [spanMs],
  )
  // Flatten every bar (spans/bands/streams) plus the raw instants into one item
  // set for the grid, pre-computing each item's relatedness opacity. Instants use
  // their own interval (from === to) so the grid renders them as day-row dots.
  const serpItems = useMemo<SerpItem[]>(() => {
    const out: SerpItem[] = []
    for (const b of bars) {
      out.push({
        key: b.key,
        from: b.from,
        to: b.to,
        color: b.color,
        title: b.title,
        kind: b.kind,
        dim: (b.cancelled ? 0.45 : 1) * relatedFactor(b.entity?.parentId, b.entity?.id),
        entity: b.entity,
        cancelled: b.cancelled,
        count: b.count,
      })
    }
    for (const e of instants) {
      const [from] = entityInterval(e)
      out.push({
        key: e.occKey,
        from,
        to: from,
        color: getInheritedAccent(e.parentId ?? "s_root") ?? NEUTRAL_MARKER,
        title: e.title,
        kind: "instant",
        dim: (e.cancelled ? 0.45 : 1) * relatedFactor(e.parentId, e.id),
        entity: e,
        cancelled: e.cancelled,
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, instants, contextId, atRootFocus])

  // Footprint right-edge (ms) for lane-packing. Whenever a bar's TITLE is wider than
  // its span on screen, the label bleeds past the span's right edge (item 3 / the
  // collapsed marker) — so we reserve that label width in the packer. Adjacent items
  // whose labels would collide therefore stack into separate sub-lanes rather than
  // overlapping. `msPerPx` converts px label estimates into the ms axis.
  const msPerPx = spanMs / Math.max(1, width)
  const barRightEdge = useMemo(() => {
    return (b: Bar) => {
      const labelPx = b.title.length * 5.6 + 14
      return b.from + Math.max(b.to - b.from, labelPx * msPerPx)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msPerPx])

  // Space-grouped ribbon packing: each bar's containing space becomes a horizontal
  // ribbon; items stack into sub-lanes within their ribbon when they overlap.
  const groupOf = (b: Bar) => b.entity?.parentId ?? (b.kind === "band" ? contextId : rootId)
  const spaceMeta = (spaceId: string) => ({
    title: getEntity(spaceId)?.title ?? "Timeline",
    color: getInheritedAccent(spaceId) ?? NEUTRAL_MARKER,
  })
  // Declaration-order index of every entity, used as the per-level tiebreak so the
  // tree ordering follows how spaces are authored (siblings in declared order).
  const declIndex = useMemo(() => {
    const m = new Map<string, number>()
    entities.forEach((e, i) => m.set(e.id, i))
    return m
  }, [])
  // Tree-path key for a space: the chain of declaration indices from root down to
  // the space. Sorting ribbons by this (lexicographically) yields a depth-first
  // pre-order, keeping a parent space and its descendants contiguous.
  const orderKey = (spaceId: string): number[] => {
    const path: number[] = []
    let id: string | null | undefined = spaceId
    let guard = 0
    while (id && guard++ < 32) {
      path.push(declIndex.get(id) ?? 0)
      id = getEntity(id)?.parentId
    }
    return path.reverse()
  }
  const lanes = useMemo(
    () => packRibbons(bars, barRightEdge, groupOf, spaceMeta, orderKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bars, barRightEdge, contextId, rootId, declIndex],
  )
  // Show ribbon labels/backgrounds only when there's more than one space in view —
  // a single group keeps the clean centered lifeline with no extra chrome.
  const showRibbons = lanes.ribbons.length > 1

  // --- Mother ribbons: group the per-space ribbons by top-level ancestor -----
  // `lanes.ribbons` is already depth-first ordered, so all ribbons sharing a
  // top-level ancestor are CONTIGUOUS — we can fold consecutive runs into one
  // MotherBlock. `directChildOfFocus(spaceId, "s_root")` returns that ancestor
  // (itself if the space is already a child of root; null if it lives at root).
  const mothers = useMemo<MotherBlock[]>(() => {
    const out: MotherBlock[] = []
    for (const r of lanes.ribbons) {
      const motherId = directChildOfFocus(r.spaceId, "s_root") ?? null
      const last = out[out.length - 1]
      if (last && motherId !== null && last.motherId === motherId) {
        last.laneCount += r.laneCount
        last.spaceIds.push(r.spaceId)
      } else {
        const mEntity = motherId ? getEntity(motherId) : undefined
        out.push({
          motherId,
          title: mEntity?.title ?? r.title,
          color: (motherId ? getInheritedAccent(motherId) : null) ?? r.color,
          baseLane: r.baseLane,
          laneCount: r.laneCount,
          spaceIds: [r.spaceId],
        })
      }
    }
    return out
  }, [lanes.ribbons])

  // Collapse-aware vertical layout. Walk the mother blocks top→bottom, giving each
  // a y-offset: a collapsed mother occupies just RAIL_H; an expanded one lays out
  // its lanes at LANE_H each. `laneToY` maps every VISIBLE global lane to its y;
  // collapsed lanes are absent (their bars render as ticks on the rail instead).
  const layout = useMemo(() => {
    const blocks: { m: MotherBlock; top: number; height: number; collapsed: boolean }[] = []
    const laneToY = new Map<number, number>()
    let y = 0
    for (const m of mothers) {
      // Mothers ONLY collapse when the user explicitly folds them (an entry in
      // `override`). Entering a subspace no longer auto-collapses the other mothers —
      // unrelated lanes simply DIM (see relatedFactor) and stay fully laid out.
      const collapsed = m.motherId != null && (m.motherId in override ? override[m.motherId] : false)
      if (collapsed) {
        blocks.push({ m, top: y, height: RAIL_H, collapsed: true })
        y += RAIL_H + MOTHER_GAP
      } else {
        const h = m.laneCount * LANE_H + (m.laneCount - 1) * LANE_GAP
        blocks.push({ m, top: y, height: h, collapsed: false })
        for (let i = 0; i < m.laneCount; i++) laneToY.set(m.baseLane + i, y + i * (LANE_H + LANE_GAP))
        y += h + MOTHER_GAP
      }
    }
    return { blocks, laneToY, contentH: Math.max(0, y - MOTHER_GAP) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mothers, override])

  const contentH = layout.contentH
  // The track GROWS VERTICALLY to fit the visible lanes (capped so a pathological
  // pile-up can't swallow the screen). Collapsing mothers SHRINKS contentH, so the
  // track — and via the live `--region1-reserve` measurement, the focus region
  // below — reflow up automatically. Lanes stay vertically centered.
  const stackedH = Math.min(contentH, MAX_STACK_LANES * LANE_H + (MAX_STACK_LANES - 1) * LANE_GAP)
  // Serpentine uses a fixed tall grid; the linear track grows to fit its lanes.
  const trackH = serpentine ? SERP_H : Math.max(TRACK_H, stackedH + 2 * TRACK_PAD_Y)
  const offsetY = Math.max(TRACK_PAD_Y, (trackH - contentH) / 2)
  // Y of a VISIBLE global lane (collapsed lanes return the block's rail y so any
  // stray positioning lands sanely; their bars are handled separately as chips).
  const laneTop = (lane: number) => offsetY + (layout.laneToY.get(lane) ?? 0)
  // Which mother block a global lane belongs to (for routing bars to chips/lanes).
  const blockOfLane = (lane: number) =>
    layout.blocks.find((b) => lane >= b.m.baseLane && lane < b.m.baseLane + b.m.laneCount)
  const toggleMother = (id: string, collapsed: boolean) => setOverride((o) => ({ ...o, [id]: !collapsed }))

  // Vertical stacking so cluster/pin LEFT-side labels don't collide. Footprint is
  // [x - estLabelWidth, x] in px; greedy interval packing by left edge.
  const clusterLevel = useMemo(() => {
    const items = clusters
      .map((c) => {
        const x = (pct(c.ms) / 100) * width
        const label = c.items.length > 1 ? `${c.items.length}` : c.items[0].title
        const estW = label.length * INSTANT_CHAR_W + INSTANT_LABEL_PAD
        return { key: c.key, left: x - estW, right: x }
      })
      .sort((a, b) => a.left - b.left)
    const levelEnds: number[] = []
    const level = new Map<string, number>()
    for (const it of items) {
      let lvl = levelEnds.findIndex((end) => end + 6 <= it.left)
      if (lvl === -1) {
        lvl = levelEnds.length
        levelEnds.push(it.right)
      } else {
        levelEnds[lvl] = it.right
      }
      level.set(it.key, lvl)
    }
    return level
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters, startMs, spanMs, width])

  // --- Animated view transitions (selector presets, "Now" jump) ------------
  // Animate a 0→1 driver, interpolating spanMs GEOMETRICALLY (so zoom reads evenly
  // across orders of magnitude). For the start we support two modes:
  //   • default: lerp startMs linearly.
  //   • anchored (anchorMs given): hold that instant's SCREEN FRACTION on a linear
  //     path from where it sits now → where it sits at the target. This keeps an
  //     already-visible anchor (e.g. "now") gliding smoothly into place instead of
  //     swinging in from an edge — the same pinning trick the cursor zoom uses, since
  //     a linear start + geometric span otherwise desyncs a fixed timestamp's path.
  const animateTo = (targetStart: number, targetSpan: number, anchorMs?: number) => {
    animRef.current?.stop()
    const s0 = startMs
    const sp0 = spanMs
    const spT = clampSpan(targetSpan)
    const anchored = anchorMs != null
    const f0 = anchored ? (anchorMs - s0) / sp0 : 0
    const fT = anchored ? (anchorMs - targetStart) / spT : 0
    animRef.current = animate(0, 1, {
      duration: 0.55,
      // Soft landing, NO overshoot: preset/now transitions decelerate smoothly into
      // place. (The wheel zoom keeps its elastic spring bounce; selectors are
      // deliberately calmer — a clean easeOut quint so the view eases to rest without
      // any bounce-back.)
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (t) => {
        const span = sp0 * Math.pow(spT / sp0, t)
        const start = anchored ? anchorMs - (f0 + (fT - f0) * t) * span : s0 + (targetStart - s0) * t
        setVp({ startMs: start, spanMs: span })
      },
    })
  }

  // Selector click: keep the current center, snap span to the preset. Anchored on the
  // visible center so the on-screen content scales in place instead of sliding in from
  // an edge (linear start + geometric span otherwise desyncs the center mid-flight).
  const selectView = (key: ViewKey) => {
    const targetSpan = VIEW_SPAN_MS[key]
    animateTo(center - targetSpan / 2, targetSpan, center)
  }

  // Step one viewport-width earlier / later (chevit arrows).
  const panBy = (dir: -1 | 1) => animateTo(startMs + dir * spanMs * 0.9, spanMs)

  // "Now": frame today at Day zoom, centered on the current moment. Anchored on `now`
  // so when it's already on screen it glides smoothly to center instead of flying in.
  const goNow = () => animateTo(now - VIEW_SPAN_MS.D / 2, VIEW_SPAN_MS.D, now)

  const nowVisible = pct(now) >= 0 && pct(now) <= 100
  // The jump-to-now control is shown UNLESS we're already on the canonical home view:
  // the default Day-scale window with "now" still on screen. We deliberately do NOT
  // hide it merely because "now" falls inside a wide span — at week/month/…/life zoom
  // now is almost always within view, yet the user still wants a one-click way back to
  // today. So the hide condition is narrow: span ≈ the Day preset AND now visible.
  // (Any coarser zoom, or panning today off-screen at Day zoom, reveals the control.)
  const atDayScale = Math.abs(spanMs - VIEW_SPAN_MS.D) / VIEW_SPAN_MS.D < 0.02
  const atHome = atDayScale && nowVisible
  const centerLabel = useMemo(() => scrubLabel(center, grain), [center, grain])

  // --- Ruler ticks (two-tier, adaptive grain) ------------------------------
  const ticks = useMemo(() => timelineTicks(startMs, spanMs, width), [startMs, spanMs, width])

  // Soft horizontal fade applied to the ruler graduations + labels, so ticks melt
  // in/out at the left and right edges while panning instead of popping abruptly.
  const edgeFade =
    "linear-gradient(to right, transparent 0px, #000 32px, #000 calc(100% - 32px), transparent 100%)"

  // Pre-hydration placeholder: reserve the exact layout footprint (label band + track)
  // so revealing the real timeline doesn't shift anything. See `mounted` above.
  if (!mounted) {
    return (
      <section aria-label="Timeline" className="px-1">
        <div className="relative mb-1 -mx-6 h-10" />
        <div className="relative -mx-6" style={{ height: TRACK_H }} ref={viewportRef} />
      </section>
    )
  }

  return (
    <section aria-label="Timeline" className="px-1">
      {/* Label band above the ruler. Shows the granularity-aware center label and,
          when "now" is scrolled off-screen, a jump-to-now control. */}
      <div className={cn("relative mb-1 -mx-6", "h-10")}>
        {/* ruler labels — anchored to the bottom, inset to match the viewport.
            Edge-faded so labels melt in/out at the sides rather than popping. */}
        <div
          className="absolute inset-x-0 bottom-0 h-3.5"
          style={{
            marginLeft: VIEWPORT_INSET_LEFT,
            marginRight: VIEWPORT_INSET_RIGHT,
            maskImage: edgeFade,
            WebkitMaskImage: edgeFade,
          }}
        >
          {!serpentine && ticks.map((t) => {
            if (!t.labeled) return null // unlabeled minors still draw a gridline below
            const left = pct(t.ms)
            if (left < 0 || left > 100) return null
            return (
              <span
                key={`${t.ms}-${t.major ? "M" : t.sub ? "s" : "m"}`}
                className={cn(
                  "absolute bottom-0 -translate-x-1/2 whitespace-nowrap text-[9.5px] tabular-nums tracking-tight",
                  t.major
                    ? "font-semibold text-muted-foreground/70"
                    : t.sub
                      ? "font-normal text-muted-foreground/50" // coarse-hour sub labels (lighter than minors)
                      : "font-medium text-muted-foreground/40",
                )}
                style={{ left: `${left}%` }}
              >
                {t.label}
              </span>
            )
          })}
        </div>

        {/* Center label + jump-to-now. The date label is ALWAYS shown (so it never
            jarringly vanishes when you land on today at Day zoom); only the jump
            control toggles, and it does so consistently on a single rule: visible
            whenever "now" is off-screen, at any zoom. The Now control is hung off
            the label's edge so appending it never shifts the label. */}
        <motion.div
          key="center-controls"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: stage === 0 ? -5 : stage === 1 ? 1.5 : 18 }}
          transition={panelTransition}
          className="pointer-events-none absolute inset-x-0 top-0 bottom-3.5 flex items-center justify-center"
        >
              <div className="pointer-events-auto inline-flex items-center gap-1 rounded bg-background px-2 py-0.5">
                <span className="whitespace-nowrap text-[11px] font-medium tracking-tight text-foreground">
                  {centerLabel}
                </span>
                {!atHome && (
                  <button
                    type="button"
                    onClick={goNow}
                    aria-label="Jump to now"
                    title="Jump to now"
                    className="flex items-center gap-0.5 whitespace-nowrap rounded-md px-1 py-0.5 text-[10px] font-medium leading-none text-muted-foreground/70 transition-colors [&:hover]:text-foreground"
                  >
                    <Crosshair className="h-3 w-3 shrink-0" strokeWidth={2.5} />
                    <motion.span
                      className="overflow-hidden"
                      initial={false}
                      animate={{ width: stage <= 1 ? "auto" : 0, opacity: stage <= 1 ? 1 : 0 }}
                      transition={layerTransition}
                    >
                      NOW
                    </motion.span>
                  </button>
                )}
              </div>
        </motion.div>
      </div>

      {/* Full-bleed timeline. Arrows flank the track; the zoom selector pins left.
          The track height is dynamic: it grows to fit stacked overlapping lanes. The
          height eases with a short, soft ease-out (NO overshoot/ripple) so the focus
          region below lands quickly and gently. Only fires on discrete lane-count
          changes — never during the zoom glide — so it can't affect zoom smoothness. */}
      <motion.div
        className="relative -mx-6"
        initial={false}
        animate={{ height: trackH }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Instant layer — pins (singletons) and density bubbles (clusters). */}
        <div
          className="pointer-events-none absolute inset-y-0 z-30"
          style={{ left: VIEWPORT_INSET_LEFT, right: VIEWPORT_INSET_RIGHT }}
        >
          {!serpentine && clusters.map((c) => {
            const left = pct(c.ms)
            if (left < 0 || left > 100) return null
            const level = clusterLevel.get(c.key) ?? 0
            const triBottom = -(INSTANT_HEAD_CLEARANCE + level * INSTANT_ROW_STEP)
            const triTop = triBottom - INSTANT_TRI
            const triMid = triBottom - INSTANT_TRI / 2
            const multi = c.items.length > 1
            const color = c.color

            if (multi) {
              // Density bubble — clicking zooms in to that span (×0.25) to expand it,
              // anchored on the cluster so it expands in place rather than sliding in.
              const zoomIn = () =>
                animateTo(c.ms - (spanMs * 0.25) / 2, spanMs * 0.25, c.ms)
              // Related if ANY clustered item is in the focus subtree.
              const dim = Math.max(...c.items.map((it) => relatedFactor(it.parentId, it.id)))
              return (
                <div
                  key={c.key}
                  className="pointer-events-none absolute bottom-0 top-0 w-0 transition-opacity duration-300 ease-out"
                  style={{ left: `${left}%`, opacity: dim }}
                >
                  <button
                    type="button"
                    onClick={zoomIn}
                    title={`${c.items.length} items · zoom in`}
                    className="pointer-events-auto absolute left-0 z-10 flex -translate-x-1/2 items-center justify-center rounded-full text-[9px] font-semibold tabular-nums text-background shadow-sm transition-transform [&:hover]:scale-110"
                    style={{
                      top: triTop - 4,
                      height: 18,
                      width: 18,
                      backgroundColor: color,
                    }}
                  >
                    {c.items.length}
                  </button>
                  <span
                    aria-hidden
                    className="pointer-events-none absolute bottom-0 left-0 z-0 w-px -translate-x-1/2"
                    style={{ top: triBottom + INSTANT_STEM_GAP, backgroundColor: color, opacity: 0.5 }}
                  />
                </div>
              )
            }

            // Singleton — the familiar instant pin (triangle + left label + stem).
            const e = c.items[0]
            const at = e.schedule?.at ?? c.ms
            const isOpen = stack.includes(e.id)
            const hovered = hoveredInstant === e.id
            const onEnter = () => setHoveredInstant(e.id)
            const onLeave = () => setHoveredInstant((cur) => (cur === e.id ? null : cur))
            return (
              <div
                key={c.key}
                className="pointer-events-none absolute bottom-0 top-0 w-0 transition-[filter,opacity] duration-300 ease-out"
                style={{
                  left: `${left}%`,
                  opacity: (e.cancelled ? 0.45 : 1) * relatedFactor(e.parentId, e.id),
                  filter: hovered ? "saturate(2) brightness(1.15)" : "none",
                }}
              >
                <span
                  aria-hidden
                  onMouseEnter={onEnter}
                  onMouseLeave={onLeave}
                  className={cn(
                    "pointer-events-auto absolute bottom-0 left-0 z-0 -translate-x-1/2",
                    "transition-[width,background-color] duration-300 ease-out",
                    "before:absolute before:inset-y-0 before:-inset-x-1 before:content-['']",
                  )}
                  style={{ top: triBottom + INSTANT_STEM_GAP, width: hovered ? 2 : 1, backgroundColor: color }}
                />
                <span
                  onMouseEnter={onEnter}
                  onMouseLeave={onLeave}
                  className={cn(
                    "pointer-events-auto absolute z-10 whitespace-nowrap rounded-[3px] bg-background px-1 py-0.5 text-right text-[10px] leading-none tracking-tight",
                    "transition-[color,font-weight] duration-300 ease-out",
                    e.cancelled && "line-through",
                  )}
                  style={{
                    right: INSTANT_TRI / 2 + 4,
                    top: triMid,
                    transform: "translateY(-50%)",
                    color,
                    fontWeight: hovered ? 600 : 500,
                  }}
                  title={e.title}
                >
                  {e.title}
                </span>
                <motion.button
                  type="button"
                  initial={false}
                  data-placement={placementKey("timeline", contextId, e.id)}
                  data-morph-kind="generic"
                  animate={{ scale: hovered ? 1.25 : 1, color }}
                  transition={{
                    scale: { type: "spring", stiffness: 400, damping: 25 },
                    color: { duration: 0.3, ease: "easeOut" },
                  }}
                  onMouseEnter={onEnter}
                  onMouseLeave={onLeave}
                  onClick={() => openFromChip(e.id)}
                  onContextMenu={(ev) => openMenu(ev, e)}
                  aria-current={isOpen ? "true" : undefined}
                  title={e.title}
                  className="pointer-events-auto absolute left-0 z-10 flex -translate-x-1/2 items-center justify-center"
                  style={{ top: triTop, height: INSTANT_TRI, width: INSTANT_TRI }}
                >
                  <NodeGlyph kind="instant" filled strokeWidth={1.5} />
                </motion.button>
              </div>
            )
          })}
        </div>

        <div className="flex h-full items-stretch">
          {/* Zoom selector — vertical Life→Day letters; the active span (nearest
              preset) reads full-strength, the rest grey and brighten on hover. */}
          <div
            style={{ width: SELECTOR_W }}
            className={cn(
              "relative z-10 flex shrink-0 flex-col items-center justify-center bg-background",
              "transition-[gap] duration-300 ease-out",
              stage === 2 ? "gap-[0px]" : stage === 1 ? "gap-[2px]" : "gap-[4px]",
            )}
          >
            {VIEWS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => selectView(key)}
                aria-pressed={activeView === key}
                aria-label={`${label} view`}
                title={`${label} view`}
                className={cn(
                  "rounded-[3px] px-1 py-0.5 text-[9px] font-semibold leading-none tracking-wide transition-colors",
                  activeView === key
                    ? "text-foreground"
                    : "text-muted-foreground/40 [&:hover]:text-foreground/80",
                )}
              >
                {key}
              </button>
            ))}
            {/* Layout toggle — flip between the linear lifeline and the serpentine
                week-columns grid. Sits under the zoom letters; both share `vp`. */}
            <button
              type="button"
              onClick={() => setSerpentine((s) => !s)}
              aria-pressed={serpentine}
              aria-label={serpentine ? "Linear timeline" : "Serpentine timeline"}
              title={serpentine ? "Linear timeline" : "Serpentine (week columns)"}
              className={cn(
                "mt-1 flex items-center justify-center rounded-[3px] p-0.5 transition-colors",
                serpentine ? "text-foreground" : "text-muted-foreground/40 [&:hover]:text-foreground/80",
              )}
            >
              {serpentine ? (
                <List className="h-3 w-3" />
              ) : (
                <LayoutGrid className="h-3 w-3" />
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => panBy(-1)}
            aria-label="Pan earlier"
            className="flex w-10 shrink-0 items-center justify-center border-y border-border text-muted-foreground/70 transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {/* Viewport — the continuous lifeline. Wheel zooms (cursor-anchored),
              drag/h-scroll pans. Markers sit above the drag layer. */}
          <div ref={viewportRef} className="relative h-full flex-1 overflow-hidden border-x border-border">
            {/* centered lifeline rule */}
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />

            {/* gridlines — major (context) lines stronger than minor. Wrapped in an
                edge-faded layer so graduations melt in/out at the sides while panning
                rather than popping in/out at the hard viewport border. */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{ maskImage: edgeFade, WebkitMaskImage: edgeFade }}
            >
              {ticks.map((t) => {
                const left = pct(t.ms)
                if (left < 0 || left > 100) return null
                return (
                  <div
                    key={`g-${t.ms}-${t.major ? "M" : t.sub ? "s" : "m"}`}
                    className={cn(
                      "absolute bottom-0 top-0 w-px",
                      // four tiers: context > labeled minor > bare minor > faint sub
                      t.major
                        ? "bg-border/40"
                        : t.sub
                          ? "bg-border/[0.09]"
                          : t.labeled
                            ? "bg-border/20"
                            : "bg-border/[0.08]",
                    )}
                    style={{ left: `${left}%` }}
                  />
                )
              })}
            </div>

            {/* drag surface — behind markers so it only catches empty-track drags. */}
            <div
              onPointerDown={onPointerDown}
              className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
              aria-hidden
            />

            {/* now marker */}
            {nowVisible && (
              <div
                className="pointer-events-none absolute -bottom-px -top-px z-20 w-px"
                style={{ left: `${pct(now)}%`, backgroundColor: accent ?? "var(--accent)" }}
              >
                <span
                  className="absolute -left-[2.5px] -top-[3px] h-[6px] w-[6px] rounded-full ring-2 ring-card"
                  style={{ backgroundColor: accent ?? "var(--accent)" }}
                />
                <span
                  className="absolute -bottom-[3px] -left-[2.5px] h-[6px] w-[6px] rounded-full ring-2 ring-card"
                  style={{ backgroundColor: accent ?? "var(--accent)" }}
                />
              </div>
            )}

            {/* ribbon background BANDS — one tinted horizontal band per space (the
                time.graphics "folder" model). Rendered BEHIND the bars (z-0). The
                left labels are a separate pass AFTER the bars so they paint on top of
                any event chip that reaches the gutter. Only shown when >1 space. */}
            {showRibbons &&
              lanes.ribbons.map((r) => {
                // Hidden while its mother is folded (a rail is drawn for it instead).
                if (blockOfLane(r.baseLane)?.collapsed) return null
                const top = laneTop(r.baseLane) - 3
                const h = r.laneCount * LANE_H + (r.laneCount - 1) * LANE_GAP + 6
                const related = atRootFocus || r.spaceId === contextId || isInSubtree(contextId, r.spaceId)
                const op = related ? 1 : UNRELATED_OPACITY
                return (
                  <div
                    key={`ribbon:${r.spaceId}`}
                    className="pointer-events-none absolute inset-x-0 z-0 rounded-r-md transition-[opacity,top,height] duration-300 ease-out"
                    style={{
                      top,
                      height: h,
                      opacity: op,
                      backgroundColor: `${r.color}0d`,
                      borderLeft: `2px solid ${r.color}66`,
                    }}
                  />
                )
              })}

            {/* COLLAPSED MOTHER RAILS — a thin clickable bar where a folded mother's
                lanes used to be. Click anywhere on it (or its label) to reopen. */}
            {showRibbons &&
              layout.blocks.map((blk) =>
                blk.collapsed && blk.m.motherId ? (
                  <button
                    key={`rail:${blk.m.motherId}`}
                    type="button"
                    onClick={() => toggleMother(blk.m.motherId!, true)}
                    onMouseEnter={() => setHoveredMother(blk.m.motherId)}
                    onMouseLeave={() => setHoveredMother((h) => (h === blk.m.motherId ? null : h))}
                    title={`Expand ${blk.m.title}`}
                    className="absolute inset-x-0 z-0 rounded-r-md transition-[top,filter] duration-300 ease-out hover:brightness-150"
                    style={{
                      top: offsetY + blk.top,
                      height: RAIL_H,
                      backgroundColor: `${blk.m.color}1f`,
                      borderLeft: `2px solid ${blk.m.color}`,
                    }}
                  />
                ) : null,
              )}

            {/* bars — events, scheduled spaces, rollup bands, recurring streams. */}
            {bars.map((b) => {
              const lane = lanes.lane.get(b.key) ?? 0
              // Bars whose mother ribbon is collapsed don't render on a lane — they
              // render as highlight ticks on that mother's rail in a later pass.
              if (blockOfLane(lane)?.collapsed) return null
              const left = pct(b.from)
              const widthPct = ((b.to - b.from) / spanMs) * 100
              if (left > 100 || left + widthPct < 0) return null
              // Real on-screen width of this bar in px (viewport `width` is the px
              // measure; `widthPct` is its share of the span). Drives the adaptive
              // chip → marker collapse below.
              const widthPx = (Math.max(widthPct, 0) / 100) * width
              const boxStyle = {
                left: `calc(${left}% + 2px)`,
                width: `calc(${Math.max(widthPct, 0.8)}% - 4px)`,
                top: laneTop(lane),
              } as const

              // Rollup context band — click to enter the child space (expands it).
              if (b.kind === "band") {
                return (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => b.childId && open(b.childId)}
                    title={`${b.title} · ${b.count} items`}
                    className="absolute flex h-6 items-center gap-1.5 overflow-hidden rounded-md border border-dashed px-2 text-[10.5px] tracking-tight text-foreground/80 transition-[filter] hover:brightness-110"
                    style={{
                      ...boxStyle,
                      borderColor: `${b.color}73`,
                      backgroundColor: `${b.color}1f`,
                    }}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: b.color }} aria-hidden />
                    <span className="truncate font-medium">{b.title}</span>
                    <span className="ml-auto shrink-0 rounded-full bg-background/60 px-1 text-[9px] font-semibold tabular-nums">
                      {b.count}
                    </span>
                  </button>
                )
              }

              // Recurring stream band — faint, with a repeat glyph; opens the series.
              if (b.kind === "stream") {
                return (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => b.entity && openFromChip(b.entity.id)}
                    onContextMenu={(ev) => b.entity && openMenu(ev, b.entity)}
                    title={`${b.title} · recurring (~${b.count})`}
                    className="absolute flex h-6 items-center gap-1.5 overflow-hidden rounded-md border px-2 text-[10.5px] tracking-tight text-foreground/70 transition-[filter,opacity] hover:brightness-110"
                    style={{
                      ...boxStyle,
                      borderColor: `${b.color}40`,
                      backgroundColor: `${b.color}14`,
                      backgroundImage: `repeating-linear-gradient(135deg, ${b.color}1f 0 6px, transparent 6px 12px)`,
                      opacity: relatedFactor(b.entity?.parentId, b.entity?.id),
                    }}
                  >
                    <Repeat className="h-2.5 w-2.5 shrink-0" style={{ color: b.color }} aria-hidden />
                    <span className="truncate">{b.title}</span>
                  </button>
                )
              }

              // Event / scheduled-space span chip.
              const isOpen = b.entity ? stack.includes(b.entity.id) : false
              const dim = (b.cancelled ? 0.45 : 1) * relatedFactor(b.entity?.parentId, b.entity?.id)
              const markerColor = b.color || "var(--muted-foreground)"

              // COLLAPSED MARKER — when the span is too narrow for a labeled chip, it
              // becomes a smooth horizontal line the width of the span, a vertical
              // color edge rising at its left, and the title set to the RIGHT of that
              // vertical connector (free to overflow past the tiny span).
              if (CHIP_COLLAPSE_ENABLED && widthPx < CHIP_COLLAPSE_PX) {
                return (
                  <motion.button
                    key={b.key}
                    type="button"
                    initial={false}
                    data-placement={b.entity ? placementKey("timeline", contextId, b.entity.id) : undefined}
                    data-morph-kind="generic"
                    animate={{ opacity: dim }}
                    transition={panelTransition}
                    onClick={() => b.entity && openFromChip(b.entity.id)}
                    onContextMenu={(ev) => b.entity && openMenu(ev, b.entity)}
                    aria-current={isOpen ? "true" : undefined}
                    title={b.title}
                    className="absolute flex h-6 items-end overflow-visible transition-[filter] hover:brightness-110"
                    style={boxStyle}
                  >
                    {/* vertical color connector rising from the duration line */}
                    <span
                      className="absolute bottom-0 left-0 h-4 w-[2px] rounded-full"
                      style={{ backgroundColor: markerColor }}
                      aria-hidden
                    />
                    {/* title to the RIGHT of the vertical connector, near its top */}
                    <span
                      className={cn(
                        "pointer-events-none absolute bottom-1.5 left-1.5 whitespace-nowrap text-[10px] leading-none tracking-tight text-foreground/80",
                        b.cancelled && "line-through",
                      )}
                    >
                      {b.title}
                    </span>
                    {/* smooth horizontal line spanning the (short) duration */}
                    <span
                      className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
                      style={{ backgroundColor: markerColor, opacity: 0.6 }}
                      aria-hidden
                    />
                  </motion.button>
                )
              }

              return (
                <div key={b.key} className="absolute h-6" style={boxStyle}>
                  <motion.button
                    type="button"
                    initial={false}
                    data-placement={b.entity ? placementKey("timeline", contextId, b.entity.id) : undefined}
                    data-morph-kind="generic"
                    animate={{ opacity: dim }}
                    transition={panelTransition}
                    onClick={() => b.entity && openFromChip(b.entity.id)}
                    onContextMenu={(ev) => b.entity && openMenu(ev, b.entity)}
                    aria-current={isOpen ? "true" : undefined}
                    title={b.title}
                    className={cn(
                      // overflow-visible (not hidden) so a title wider than the span
                      // BLEEDS out past the colored frame to the right rather than
                      // truncating — the packer reserves that label width so it never
                      // collides with a neighbour (item 3).
                      "flex h-6 w-full items-center gap-1.5 overflow-visible rounded-md border px-2 text-[10.5px] tracking-tight",
                      "text-foreground/85 shadow-sm transition-[filter] hover:brightness-110",
                    )}
                    style={{
                      borderColor: b.color ? `${b.color}59` : "var(--border)",
                      backgroundColor: b.color ? `${b.color}26` : "var(--secondary)",
                    }}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-[2px]" style={{ backgroundColor: b.color }} aria-hidden />
                    <span className={cn("whitespace-nowrap", b.cancelled && "line-through")}>{b.title}</span>
                  </motion.button>
                </div>
              )
            })}

            {/* RAIL HIGHLIGHTS — a collapsed mother's events don't vanish; instead of
                falling onto the visible lanes, each event is painted AS a bright tick
                directly ON that mother's thin rail, at its own time position. The rail
                becomes a compressed one-line preview of the folded mother. Shown by
                default; hidden per-mother via the eye toggle (`ticksHidden`) and
                brightened while the mother's rail is hovered (`hoveredMother`).
                pointer-events-none so a click anywhere on the rail still expands it. */}
            {showRibbons &&
              layout.blocks.flatMap((blk) => {
                const mId = blk.m.motherId
                if (!blk.collapsed || !mId || ticksHidden[mId]) return []
                const hi = hoveredMother === mId
                const railY = offsetY + blk.top
                const motherBars = bars.filter((b) => blockOfLane(lanes.lane.get(b.key) ?? 0)?.m.motherId === mId)
                return motherBars
                  .map((b) => {
                    const left = pct(b.from)
                    const widthPct = ((b.to - b.from) / spanMs) * 100
                    if (left > 100 || left + widthPct < 0) return null
                    const color = b.color || NEUTRAL_MARKER
                    return (
                      <div
                        key={`railtick:${b.key}`}
                        className="pointer-events-none absolute z-10 rounded-full transition-[opacity] duration-150"
                        title={b.title}
                        style={{
                          left: `calc(${left}% + 2px)`,
                          width: `calc(${Math.max(widthPct, 0.6)}% - 2px)`,
                          minWidth: 3,
                          top: railY + 1,
                          height: RAIL_H - 2,
                          backgroundColor: color,
                          opacity: hi ? 1 : 0.85,
                          boxShadow: hi ? `0 0 6px ${color}` : undefined,
                        }}
                      />
                    )
                  })
                  .filter(Boolean)
              })}

            {/* ribbon left LABELS — pinned to the gutter, painted AFTER the bars so a
                chip that reaches the left edge passes BEHIND the label, not over it.
                Solid opaque chip (no backdrop-blur): blur is imperceptible over the
                near-black timeline and is the costly GPU effect, so a crisp opaque tag
                is both cheaper and far more legible. */}
            {showRibbons &&
              lanes.ribbons.map((r) => {
                const blk = blockOfLane(r.baseLane)
                if (blk?.collapsed) return null // folded — its mother rail-label is drawn below
                const mId = blk?.m.motherId ?? null
                // The mother's LEAD lane (the mother space itself appearing as a lane)
                // would repeat the name already shown in the vertical mother column to
                // its left — visually redundant (e.g. "Day Job" lane label right next
                // to the vertical "Day Job"). Hide it at rest and reveal it only when
                // the pointer approaches: the button keeps its box and pointer-events
                // while transparent, so `hover:opacity-100` brings it back on approach.
                const isLeadDup = mId != null && r.spaceId === mId
                const bandTop = laneTop(r.baseLane) - 3
                const bandH = r.laneCount * LANE_H + (r.laneCount - 1) * LANE_GAP + 6
                const related = atRootFocus || r.spaceId === contextId || isInSubtree(contextId, r.spaceId)
                const top = bandTop + bandH / 2
                // Lanes always just OPEN their space now — the fold control lives in the
                // rotated mother column to the left (rendered in the pass below). Lanes
                // inside a mother group shift right by MOTHER_COL_W to clear that column.
                return (
                  <button
                    key={`ribbon-label:${r.spaceId}`}
                    type="button"
                    onClick={() => r.spaceId !== "s_root" && open(r.spaceId)}
                    title={r.title}
                    className={cn(
                      "absolute z-20 flex max-w-[42%] items-center gap-1 rounded border border-border/70 bg-card px-1.5 py-0.5 text-[9.5px] font-medium leading-none tracking-tight text-foreground/80 shadow-sm transition-[opacity,colors,top,left] duration-300 ease-out hover:text-foreground",
                      isLeadDup && "opacity-0 hover:opacity-100",
                    )}
                    style={{
                      left: mId ? 4 + MOTHER_COL_W : 4,
                      top,
                      transform: "translateY(-50%)",
                      // Lead duplicates are driven purely by the hover class above; everyone
                      // else uses the related/unrelated dimming.
                      ...(isLeadDup ? {} : { opacity: related ? 1 : UNRELATED_OPACITY }),
                    }}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />
                    <span className="truncate">{r.title}</span>
                  </button>
                )
              })}

            {/* EXPANDED MOTHER COLUMN — the mother's title rotated 90° anticlockwise in a
                slim column at the FAR LEFT, vertically centered across all its lanes
                (e.g. a vertical "Day Job" sitting left of the Admin/Day Job lanes). This
                IS the fold control: clicking it collapses the mother, dropping it back to
                the horizontal rail label below. `vertical-rl` + rotate(180deg) makes the
                text read bottom→top (a true 90° CCW). */}
            {showRibbons &&
              layout.blocks.map((blk) => {
                const mId = blk.m.motherId
                if (blk.collapsed || !mId) return null
                const related = atRootFocus || mId === contextId || isInSubtree(contextId, mId)
                return (
                  <button
                    key={`mcol:${mId}`}
                    type="button"
                    onClick={() => toggleMother(mId, false)}
                    title={`Collapse ${blk.m.title}`}
                    className="absolute z-20 flex flex-col items-center justify-center rounded border border-border/70 bg-card py-0.5 text-[9.5px] font-semibold leading-none tracking-tight shadow-sm transition-[opacity,top,height] duration-300 ease-out hover:brightness-125"
                    style={{
                      left: 4,
                      top: offsetY + blk.top,
                      height: blk.height,
                      width: MOTHER_COL_W - 4,
                      color: blk.m.color,
                      borderColor: `${blk.m.color}40`,
                      opacity: related ? 1 : UNRELATED_OPACITY,
                    }}
                  >
                    <span
                      className="overflow-hidden text-ellipsis whitespace-nowrap"
                      // Give a readable floor (~46px) so single-lane mothers (e.g. Health,
                      // whose block is only one LANE_H tall) still show their name, letting
                      // it overflow gently into the surrounding gaps rather than clipping to
                      // one letter. Multi-lane blocks clamp to their own height.
                      style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", maxHeight: Math.max(blk.height - 6, 46) }}
                    >
                      {blk.m.title}
                    </span>
                  </button>
                )
              })}

            {/* COLLAPSED MOTHER LABELS — sit on the rail: a fold/expand title (click to
                reopen) plus an eye toggle to hide/show the rail highlight ticks. Hovering
                here brightens those ticks on the rail. */}
            {showRibbons &&
              layout.blocks.map((blk) => {
                const mId = blk.m.motherId
                if (!blk.collapsed || !mId) return null
                const ticksOn = !ticksHidden[mId]
                return (
                  <div
                    key={`mlabel:${mId}`}
                    className="absolute z-20 flex items-center gap-1"
                    style={{ left: 4, top: offsetY + blk.top + RAIL_H / 2, transform: "translateY(-50%)" }}
                    onMouseEnter={() => setHoveredMother(mId)}
                    onMouseLeave={() => setHoveredMother((h) => (h === mId ? null : h))}
                  >
                    <button
                      type="button"
                      onClick={() => toggleMother(mId, true)}
                      title={`Expand ${blk.m.title}`}
                      className="flex max-w-[36vw] items-center gap-1 rounded border border-border/70 bg-card px-1.5 py-0.5 text-[9.5px] font-medium leading-none tracking-tight text-foreground/70 shadow-sm transition-colors hover:text-foreground"
                    >
                      <ChevronRight className="h-2.5 w-2.5 shrink-0 opacity-60" aria-hidden />
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: blk.m.color }} aria-hidden />
                      <span className="truncate">{blk.m.title}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTicksHidden((s) => ({ ...s, [mId]: ticksOn }))}
                      title={ticksOn ? "Hide events" : "Show events"}
                      aria-pressed={!ticksOn}
                      className="flex items-center justify-center rounded border border-border/70 bg-card p-0.5 text-foreground/60 shadow-sm transition-colors hover:text-foreground"
                    >
                      {ticksOn ? <Eye className="h-2.5 w-2.5" aria-hidden /> : <EyeOff className="h-2.5 w-2.5" aria-hidden />}
                    </button>
                  </div>
                )
              })}

            {/* SERPENTINE OVERLAY — when on, the week-columns grid covers the linear
                lifeline (opaque, z-40 so it sits above ribbons/bars). The linear DOM
                stays mounted but hidden; toggling back is instant. */}
            {serpentine && (
              <div className="absolute inset-0 z-40">
                <TimelineSerpentine
                  items={serpItems}
                  centerMs={center}
                  weekCount={weekCount}
                  now={now}
                  height={SERP_H}
                  onOpen={openFromChip}
                  onMenu={openMenu}
                />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => panBy(1)}
            aria-label="Pan later"
            className="flex w-10 shrink-0 items-center justify-center border-y border-border text-muted-foreground/70 transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </motion.div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </section>
  )
}
