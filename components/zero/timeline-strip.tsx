"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { motion, animate } from "motion/react"
import { ChevronLeft, ChevronRight, Crosshair, Trash2, Ban, RotateCcw, Repeat } from "lucide-react"
import {
  getInheritedAccent,
  isInSubtree,
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
import { ContextMenu, type ContextMenuState } from "./context-menu"
import { cn } from "@/lib/utils"

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

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
// Vertical breathing room above+below the stacked lanes when the track grows.
const TRACK_PAD_Y = 6
// Hard ceiling on how many overlapping lanes can grow the track, so a dense pile-up
// can't push the entire focus region off-screen. Beyond this, extra lanes overflow
// (clipped) rather than growing further — a deliberate "get the gist" compromise.
const MAX_STACK_LANES = 6

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

/** Greedy interval lane-packing — items sorted by start, each placed in the first
 *  lane whose previous item's VISUAL footprint has ended; else a new lane opens.
 *  `rightEdge(b)` returns the bar's effective right edge in ms: for a labeled chip
 *  that's its real `to`, but for a COLLAPSED marker it extends past `to` to cover
 *  the title floated above the line (which overflows the tiny span) — so two
 *  time-adjacent markers whose labels would overlap get separate lanes. */
function packLanes(bars: Bar[], rightEdge: (b: Bar) => number): { lane: Map<string, number>; count: number } {
  const sorted = [...bars].sort((a, b) => a.from - b.from)
  const laneEnds: number[] = []
  const lane = new Map<string, number>()
  for (const b of sorted) {
    let idx = laneEnds.findIndex((end) => end <= b.from)
    if (idx === -1) {
      idx = laneEnds.length
      laneEnds.push(rightEdge(b))
    } else {
      laneEnds[idx] = rightEdge(b)
    }
    lane.set(b.key, idx)
  }
  return { lane, count: Math.max(1, laneEnds.length) }
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

  // Footprint right-edge (ms) for lane-packing: a labeled chip ends at `to`, but a
  // COLLAPSED marker (narrower than CHIP_COLLAPSE_PX) reserves extra room for its
  // overflowing title so adjacent markers don't pile their labels on top of each
  // other — they stack into separate lanes instead. `msPerPx` converts the px
  // estimates (label chars, min chip) into the ms axis the packer reasons in.
  const msPerPx = spanMs / Math.max(1, width)
  const barRightEdge = useMemo(() => {
    return (b: Bar) => {
      const spanPx = ((b.to - b.from) / spanMs) * width
      if (spanPx >= CHIP_COLLAPSE_PX) return b.to
      const labelPx = b.title.length * 5.6 + 8
      return b.from + Math.max(b.to - b.from, labelPx * msPerPx)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spanMs, width, msPerPx])
  const lanes = useMemo(() => packLanes(bars, barRightEdge), [bars, barRightEdge])
  const contentH = lanes.count * LANE_H + (lanes.count - 1) * LANE_GAP
  // The track GROWS VERTICALLY to fit however many lanes the overlapping bars need
  // (capped so a pathological pile-up can't swallow the screen). When it's taller
  // than the base height, the surrounding `shrink-0` wrapper grows and the focus
  // region below is pushed down — smoothly, via the CSS height transition on the
  // track container. Lanes stay vertically centered within whatever height we end
  // up at, so a single-lane day still sits on the centered lifeline.
  const stackedH = Math.min(contentH, MAX_STACK_LANES * LANE_H + (MAX_STACK_LANES - 1) * LANE_GAP)
  const trackH = Math.max(TRACK_H, stackedH + 2 * TRACK_PAD_Y)
  const laneTop = (lane: number) => Math.max(TRACK_PAD_Y, (trackH - contentH) / 2) + lane * (LANE_H + LANE_GAP)

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
  // Animate a 0→1 driver and interpolate startMs LINEARLY and spanMs
  // GEOMETRICALLY (so zoom reads evenly across orders of magnitude).
  const animateTo = (targetStart: number, targetSpan: number) => {
    animRef.current?.stop()
    const s0 = startMs
    const sp0 = spanMs
    const spT = clampSpan(targetSpan)
    animRef.current = animate(0, 1, {
      duration: 0.5,
      ease: [0.32, 0.72, 0, 1],
      onUpdate: (t) => {
        setVp({
          startMs: s0 + (targetStart - s0) * t,
          spanMs: sp0 * Math.pow(spT / sp0, t),
        })
      },
    })
  }

  // Selector click: keep the current center, snap span to the preset.
  const selectView = (key: ViewKey) => {
    const targetSpan = VIEW_SPAN_MS[key]
    animateTo(center - targetSpan / 2, targetSpan)
  }

  // Step one viewport-width earlier / later (chevit arrows).
  const panBy = (dir: -1 | 1) => animateTo(startMs + dir * spanMs * 0.9, spanMs)

  // "Now": frame today at Day zoom, centered on the current moment.
  const goNow = () => animateTo(now - VIEW_SPAN_MS.D / 2, VIEW_SPAN_MS.D)

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
        {/* ruler labels — anchored to the bottom, inset to match the viewport. */}
        <div
          className="absolute inset-x-0 bottom-0 h-3.5"
          style={{ marginLeft: VIEWPORT_INSET_LEFT, marginRight: VIEWPORT_INSET_RIGHT }}
        >
          {ticks.map((t) => {
            if (!t.labeled) return null // unlabeled minors still draw a gridline below
            const left = pct(t.ms)
            if (left < 0 || left > 100) return null
            return (
              <span
                key={`${t.ms}-${t.major ? "M" : "m"}`}
                className={cn(
                  "absolute bottom-0 -translate-x-1/2 whitespace-nowrap text-[9.5px] tabular-nums tracking-tight",
                  t.major ? "font-semibold text-muted-foreground/70" : "font-medium text-muted-foreground/40",
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
          The track height is dynamic: it grows to fit stacked overlapping lanes and
          eases back, pushing the focus region below it down/up smoothly. */}
      <div
        className="relative -mx-6 transition-[height] duration-300 ease-out"
        style={{ height: trackH }}
      >
        {/* Instant layer — pins (singletons) and density bubbles (clusters). */}
        <div
          className="pointer-events-none absolute inset-y-0 z-30"
          style={{ left: VIEWPORT_INSET_LEFT, right: VIEWPORT_INSET_RIGHT }}
        >
          {clusters.map((c) => {
            const left = pct(c.ms)
            if (left < 0 || left > 100) return null
            const level = clusterLevel.get(c.key) ?? 0
            const triBottom = -(INSTANT_HEAD_CLEARANCE + level * INSTANT_ROW_STEP)
            const triTop = triBottom - INSTANT_TRI
            const triMid = triBottom - INSTANT_TRI / 2
            const multi = c.items.length > 1
            const color = c.color

            if (multi) {
              // Density bubble — clicking zooms in to that span (×0.25) to expand it.
              const zoomIn = () =>
                animateTo(c.ms - (spanMs * 0.25) / 2, spanMs * 0.25)
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

            {/* gridlines — major (context) lines stronger than minor. */}
            {ticks.map((t) => {
              const left = pct(t.ms)
              if (left < 0 || left > 100) return null
              return (
                <div
                  key={`g-${t.ms}-${t.major ? "M" : "m"}`}
                  className={cn(
                    "pointer-events-none absolute bottom-0 top-0 w-px",
                    // three tiers: context lines > labeled graduations > bare graduations
                    t.major ? "bg-border/40" : t.labeled ? "bg-border/20" : "bg-border/[0.08]",
                  )}
                  style={{ left: `${left}%` }}
                />
              )
            })}

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

            {/* bars — events, scheduled spaces, rollup bands, recurring streams. */}
            {bars.map((b) => {
              const lane = lanes.lane.get(b.key) ?? 0
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
              // color edge on its left, and the title floated above-left (allowed to
              // overflow past the tiny span, the way an instant pin's label does).
              if (widthPx < CHIP_COLLAPSE_PX) {
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
                    {/* title floated above the line, left-aligned, free to overflow */}
                    <span
                      className={cn(
                        "pointer-events-none absolute bottom-3 left-0 whitespace-nowrap text-[10px] leading-none tracking-tight text-foreground/80",
                        b.cancelled && "line-through",
                      )}
                    >
                      {b.title}
                    </span>
                    {/* vertical color edge anchoring the left of the span */}
                    <span
                      className="absolute bottom-0 left-0 h-3 w-[2px] rounded-full"
                      style={{ backgroundColor: markerColor }}
                      aria-hidden
                    />
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
                      "flex h-6 w-full items-center gap-1.5 overflow-hidden rounded-md border px-2 text-[10.5px] tracking-tight",
                      "text-foreground/85 shadow-sm transition-[filter] hover:brightness-110",
                    )}
                    style={{
                      borderColor: b.color ? `${b.color}59` : "var(--border)",
                      backgroundColor: b.color ? `${b.color}26` : "var(--secondary)",
                    }}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-[2px]" style={{ backgroundColor: b.color }} aria-hidden />
                    <span className={cn("truncate", b.cancelled && "line-through")}>{b.title}</span>
                  </motion.button>
                </div>
              )
            })}
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
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </section>
  )
}
