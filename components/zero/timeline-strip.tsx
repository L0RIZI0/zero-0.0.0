"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion, animate } from "motion/react"
import { ChevronLeft, ChevronRight, ArrowLeft, ArrowRight, Trash2, Ban, RotateCcw } from "lucide-react"
import {
  getInheritedAccent,
  getSpaceEvents,
  isInSubtree,
  deleteEntity,
  setEventCancelled,
} from "@/lib/zero/data"
import type { Entity } from "@/lib/zero/types"
import { panelTransition, layerTransition } from "@/lib/zero/motion"
import { useZeroNav } from "@/lib/zero/nav-store"
import { NodeGlyph } from "./node-glyph"
import { ContextMenu, type ContextMenuState } from "./context-menu"
import { cn } from "@/lib/utils"

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const DEFAULT_START_H = 8 // 08:00 — left edge of a day's default framing
const DEFAULT_END_H = 22 // 22:00 — right edge of a day's default framing
// The visible window is always this wide (14h). The continuous "lifeline" is
// now expressed in ABSOLUTE epoch milliseconds (Date.now()-style), so events
// position by their real timestamps and naturally scroll across days. `viewStart`
// is the epoch ms pinned to the left edge of the viewport.
const WINDOW_SPAN = (DEFAULT_END_H - DEFAULT_START_H) * HOUR_MS // 14h in ms

/** Local midnight of `epoch`'s day, epoch ms. */
function startOfDay(epoch: number): number {
  const d = new Date(epoch)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Hour-aligned ruler ticks across the visible window. Walks LOCAL hour
 * boundaries (robust across timezones / DST, unlike fixed-ms stepping) from the
 * first `stepH`-aligned hour at/after `viewStart` to the right edge. Epoch ms.
 */
function hourTicks(stepH: number, viewStart: number): number[] {
  const d = new Date(viewStart)
  d.setMinutes(0, 0, 0)
  while (d.getHours() % stepH !== 0 || d.getTime() < viewStart) d.setHours(d.getHours() + 1)
  const out: number[] = []
  for (; d.getTime() <= viewStart + WINDOW_SPAN; d.setHours(d.getHours() + stepH)) out.push(d.getTime())
  return out
}

// Timeline zoom spans, ordered top→bottom for the vertical selector: Life,
// Year, Quarter, Month, Week, Day. Only "D" (the default 8am–10pm day view) is
// wired up for now; the rest are a skeleton — selecting them just moves the
// highlight. "D" rests at the bottom and is the default selection.
const VIEWS = [
  ["L", "Life"],
  ["Y", "Year"],
  ["Q", "Quarter"],
  ["M", "Month"],
  ["W", "Week"],
  ["D", "Day"],
] as const
type ViewKey = (typeof VIEWS)[number][0]

// Fallback color for items whose space chain has no accent (i.e. created
// directly under the root "Space 0"). A neutral light grey so they still read
// as real markers without claiming a brand color.
const NEUTRAL_MARKER = "oklch(0.72 0.004 75)"

/** A timed entity's [start, end] epoch interval. Instants are a zero-width
 *  point [at, at]; events are their [startAt, endAt] span. */
function entitySpan(e: Entity): [number, number] {
  const s = e.schedule
  if (e.kind === "instant") {
    const a = s?.at ?? 0
    return [a, a]
  }
  const st = s?.startAt ?? 0
  return [st, s?.endAt ?? st]
}

/**
 * Greedy interval lane-packing (proper gantt behaviour, replacing the old
 * arbitrary `index % 2`). Items are sorted by start, then each is placed in the
 * first lane whose previous item has already ended; otherwise a new lane opens.
 * Non-overlapping schedules collapse to a single lane; only genuine time
 * conflicts stack. Returns id→lane plus the total lane count.
 */
function packLanes(evts: Entity[]): { lane: Map<string, number>; count: number } {
  const sorted = [...evts].sort((a, b) => entitySpan(a)[0] - entitySpan(b)[0])
  const laneEnds: number[] = []
  const lane = new Map<string, number>()
  for (const e of sorted) {
    const [s, en] = entitySpan(e)
    let idx = laneEnds.findIndex((end) => end <= s)
    if (idx === -1) {
      idx = laneEnds.length
      laneEnds.push(en)
    } else {
      laneEnds[idx] = en
    }
    lane.set(e.id, idx)
  }
  return { lane, count: Math.max(1, laneEnds.length) }
}

// Track layout: the strip is 56px tall (h-14). Lanes are 24px with a 4px gap,
// and the used lanes are vertically CENTERED so a single-lane day sits in the
// middle rather than pinned to the top.
const TRACK_H = 56
const LANE_H = 24
const LANE_GAP = 4

// Horizontal chrome flanking the scrolling viewport, in px. The viewport is the
// shared coordinate space for gridlines, the now-marker and every event/instant.
// Any OVERLAY that must line up with it (the hour ruler above the track, the
// vertical instant labels) has to use these exact insets — hand-tuned guesses
// drift out of alignment. The zoom selector is pinned to a fixed width precisely
// so these insets stay deterministic.
const ARROW_W = 40 // prev / next day chevron buttons (Tailwind w-10)
const SELECTOR_W = 24 // zoom-selector letter column (Tailwind w-6)
const VIEWPORT_INSET_LEFT = SELECTOR_W + ARROW_W // selector + prev arrow
const VIEWPORT_INSET_RIGHT = ARROW_W // next arrow only

// Height (px) reserved ABOVE the track for an instant pin's head: the
// down-triangle plus the rotated title that hangs beneath it. The stem then
// continues from the triangle down to the bottom of the track.
const INSTANT_HEAD_H = 72

// Time-of-day label for an absolute epoch ms (local time).
function fmt(epoch: number) {
  const d = new Date(epoch)
  const h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? "pm" : "am"
  const hr = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, "0")}${ampm}`
}

export function TimelineStrip({
  contextId,
  accent,
}: {
  contextId: string
  accent?: string
}) {
  const { stack, dataVersion, notifyDataChanged } = useZeroNav()
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  // Shell compaction stage (0 home, 1 first child, 2+ deeper), mirroring
  // shellStageFor. Used ONLY for non-reflowing treatments here — the off-today
  // label's vertical position and the "TODAY" word collapse. The timeline's
  // actual lift is handled externally via a transform in work-surface, and the
  // label band height is held constant below, so reading the real stage no longer
  // reflows the window region.
  const stage: number = Math.min(stack.length - 1, 2)

  // Right-click any marker: cancel/restore (events & instants) or delete it.
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
          icon: isCancelled ? (
            <RotateCcw className="h-3.5 w-3.5" />
          ) : (
            <Ban className="h-3.5 w-3.5" />
          ),
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

  // The timeline always shows the FULL day (all events). When a child window is
  // open, events outside its subtree dim rather than disappear, so the user
  // keeps spatial context. `spaceId` is the active node's context space.
  const evts = useMemo(() => getSpaceEvents("s_root"), [dataVersion])

  // Overlap-based lane assignment for EVENT spans only (instants now render as
  // full-height pins, independent of lanes). Non-overlapping events share one
  // centered lane; real time conflicts stack onto additional lanes.
  const lanes = useMemo(() => packLanes(evts.filter((e) => e.kind === "event")), [evts])
  const contentH = lanes.count * LANE_H + (lanes.count - 1) * LANE_GAP
  // Top edge (px) of a given lane within the 56px track, used lanes centered.
  const laneTop = (lane: number) => Math.max(2, (TRACK_H - contentH) / 2) + lane * (LANE_H + LANE_GAP)

  // --- Continuous lifeline state -------------------------------------------
  // `viewStart` is the absolute epoch ms at the left edge of the viewport. It can
  // be any real value — dragging scrubs it freely (a continuous lifeline of
  // time), while the arrows snap to a day's default 8am–10pm framing. Initialised
  // to today's 8am so the default view frames the working day.
  const [viewStart, setViewStart] = useState(() => startOfDay(Date.now()) + DEFAULT_START_H * HOUR_MS)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const animRef = useRef<ReturnType<typeof animate> | null>(null)

  // Live "now" — a real timestamp, refreshed each minute so the now-marker
  // creeps along the lifeline. (A timer, not data fetching.)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Which instant pin is hovered. Drives the shared thicken/darken effect across
  // the pin's triangle + label + stem. Done in React state (not `group-hover:`
  // utilities) because the triangle is a framer-motion node whose inline styles
  // would override class-based transforms, and so the effect is fully reliable.
  const [hoveredInstant, setHoveredInstant] = useState<string | null>(null)

  // Selected zoom span (skeleton — only "D" actually drives the view for now).
  const [view, setView] = useState<ViewKey>("D")

  // True while the view is in motion (dragging or arrow/Back-to-Today tween).
  // The morph overlays carry a shared layoutId, and framer-motion re-measures
  // every layoutId element on each render commit. Since the lifeline repositions
  // every element via React state ~60×/sec during a programmatic scroll, that
  // per-frame layout thrash drops frames and reads as a laggy "jump" (drag felt
  // smooth only because the browser coalesces pointer events). View motion and
  // window morphs never overlap, so while the view moves we drop the layoutId
  // entirely (see the overlays below) — no measurement, no thrash — and restore
  // it once settled so opening/closing a window still morphs smoothly. The
  // instant transition is a belt-and-suspenders guard for the boundary frames.
  const [viewMoving, setViewMoving] = useState(false)

  // Epoch ms → percentage across the viewport.
  const pct = (epoch: number) => ((epoch - viewStart) / WINDOW_SPAN) * 100

  // Local midnight of today, recomputed from `now` so it stays correct across a
  // day boundary while the strip is mounted.
  const startOfToday = useMemo(() => startOfDay(now), [now])

  // Which day the CENTER of the window lands in, relative to today (day 0).
  const dayOffset = Math.floor((viewStart + WINDOW_SPAN / 2 - startOfToday) / DAY_MS)
  const isToday = dayOffset === 0

  // Smoothly animate the view to an absolute target (used by the arrows and the
  // "Back to Today" link). A fixed ~0.5s eased tween reads as a crisp scroll
  // that accelerates then settles — a spring here was slightly overdamped and
  // crawled to the target, which felt laggy. A drag interrupts any running
  // animation.
  const animateView = (target: number) => {
    animRef.current?.stop()
    setViewMoving(true)
    animRef.current = animate(viewStart, target, {
      duration: 0.5,
      ease: [0.32, 0.72, 0, 1],
      onUpdate: (v) => setViewStart(v),
      onComplete: () => setViewMoving(false),
    })
  }

  const dayDefaultStart = (offset: number) => startOfToday + offset * DAY_MS + DEFAULT_START_H * HOUR_MS
  const goPrev = () => animateView(dayDefaultStart(dayOffset - 1))
  const goNext = () => animateView(dayDefaultStart(dayOffset + 1))
  const goToday = () => animateView(dayDefaultStart(0))

  // Free-scroll drag: dragging right reveals earlier time (viewStart shrinks).
  // We use window listeners (not pointer capture) so marker clicks are never
  // hijacked — the drag layer sits BEHIND the markers in paint order, so a
  // pointerdown on a marker hits the marker, and one on empty track starts a
  // drag. On release the view simply stays put.
  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    animRef.current?.stop()
    setViewMoving(true)
    const width = viewportRef.current?.getBoundingClientRect().width ?? 1
    const startX = e.clientX
    const startView = viewStart
    const move = (ev: PointerEvent) => {
      const deltaMs = ((ev.clientX - startX) / width) * WINDOW_SPAN
      setViewStart(startView - deltaMs)
    }
    const up = () => {
      setViewMoving(false)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  const viewedDate = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + dayOffset)
    return d
  }, [dayOffset])

  // Day label only shows when scrubbed OFF today. Every off-today day reads the
  // same way (no special "Yesterday/Tomorrow" wording): a compact "MON JUN 15"
  // (weekday + month + day, all 3-letter caps), with the year appended only
  // when it differs from the current one ("MON JUN 15 2027").
  const dayLabel = useMemo(() => {
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(viewedDate).toUpperCase()
    const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(viewedDate).toUpperCase()
    const day = viewedDate.getDate()
    const sameYear = viewedDate.getFullYear() === new Date().getFullYear()
    return `${weekday} ${month} ${day}${sameYear ? "" : ` ${viewedDate.getFullYear()}`}`
  }, [viewedDate])

  // Dynamic hour ruler: timestamps every 2h across the visible window,
  // including the night hours that scroll into view as the user drags.
  const ticks = useMemo(() => hourTicks(2, viewStart), [viewStart])

  // Gridlines every 1h (denser than the 2h timestamps). Lines on an even hour
  // (where a timestamp sits) read as "major"; the in-between odd-hour lines are
  // fainter so the 2h rhythm stays legible.
  const gridTicks = useMemo(() => hourTicks(1, viewStart), [viewStart])

  return (
    <section aria-label="Timeline" className="px-1">
      {/* Label band sits in the gap above the hour ruler. The hour ruler is
          anchored to the BOTTOM (the "timestamp level"). When scrubbed off
          today the day label and the "Today" jump link sit on a single centered
          row in the gap (the link flanks the label on the side its arrow points)
          — keeping the band short so it stays clear of the date/time header. The
          zoom selector no longer lives here — it is a vertical list on the far
          left, beside the arrows. */}
      <div
        className={cn(
          // Full-bleed to match the track below, so the ruler shares the track's
          // coordinate origin and its ticks can line up with the gridlines.
          "relative mb-1 -mx-6",
          // Height held CONSTANT across depth. The band sits above the focus-window
          // region (which is flex-1 below it), so changing its height would push
          // the region up/down and reflow every fixed window mid-morph. The timeline
          // already rides higher with depth via the external transform lift.
          "h-10",
        )}
      >
        {/* hour ruler — anchored to the bottom, inset to exactly match the
            scrolling viewport (selector + arrows) so timestamps sit on top of
            their gridlines rather than drifting left. */}
        <div
          className="absolute inset-x-0 bottom-0 h-3.5"
          style={{ marginLeft: VIEWPORT_INSET_LEFT, marginRight: VIEWPORT_INSET_RIGHT }}
        >
          {ticks.map((m) => {
            const left = pct(m)
            if (left < 0 || left > 100) return null
            return (
              <span
                key={m}
                className="absolute bottom-0 -translate-x-1/2 text-[9.5px] font-medium tabular-nums tracking-tight text-muted-foreground/45"
                style={{ left: `${left}%` }}
              >
                {fmt(m)}
              </span>
            )
          })}
        </div>

        {/* Off-today controls — only shown when scrubbed off today, since the
            timeline already implies "now". The day label stays PERFECTLY
            centered in the gap; the "Today" jump link is hung absolutely off the
            label's edge so appending it never shifts the label. The link's arrow
            points back toward "today" — a future view (today in the past) gets a
            left arrow + link on the LEFT; a past view gets a right arrow + link
            on the RIGHT. At stage 2 (most compact) the link is just the arrow. */}
        <AnimatePresence initial={false}>
          {!isToday && (
            <motion.div
              key="off-today-controls"
              initial={{ opacity: 0, y: -4 }}
              // Resting y nudges the centered label to sit optically balanced
              // between the top date and the timestamps at each depth: a touch
              // higher at the root, then progressively lower as the depth grows. At
              // stage 2 the whole timeline has ridden far up via the transform lift,
              // so the label is pushed well down toward the timestamps to clear the
              // date/time in the top header it was otherwise overlapping.
              animate={{ opacity: 1, y: stage === 0 ? -5 : stage === 1 ? 1.5 : 18 }}
              exit={{ opacity: 0, y: -4 }}
              transition={panelTransition}
              // No background on this full-width box: at stage 2 it slides down (y)
              // toward the timestamps, and an opaque band here would mask the whole
              // hour ruler. Only the centered label itself carries a local
              // background (below), so it hides just the timestamps directly behind
              // it — the rest stay visible and reappear as the user scrubs the day.
              className="pointer-events-none absolute inset-x-0 top-0 bottom-3.5 flex items-center justify-center"
            >
              {(() => {
                const todayIsLeft = dayOffset > 0
                const Arrow = todayIsLeft ? ArrowLeft : ArrowRight
                return (
                  // Label + back-to-today control share ONE opaque rounded block so
                  // they mask the timestamps behind them as a single continuous
                  // unit (the arrow no longer floats outside the label's background).
                  // The arrow sits on whichever side "today" lies — reversed row
                  // when today is to the left.
                  <div
                    className={cn(
                      "pointer-events-auto inline-flex items-center gap-1 rounded bg-background px-2 py-0.5",
                      todayIsLeft ? "flex-row-reverse" : "flex-row",
                    )}
                  >
                    <span className="whitespace-nowrap text-[11px] font-medium tracking-tight text-foreground">
                      {dayLabel}
                    </span>
                    <button
                      type="button"
                      onClick={goToday}
                      aria-label="Back to today"
                      title="Back to today"
                      className={cn(
                        "flex items-center gap-0.5 whitespace-nowrap rounded-md px-1 py-0.5 text-[10px] font-medium leading-none text-muted-foreground/70 transition-colors [&:hover]:text-foreground",
                        todayIsLeft ? "flex-row" : "flex-row-reverse",
                      )}
                    >
                      <Arrow className="h-3 w-3 shrink-0" strokeWidth={2.75} />
                      {/* The word smoothly collapses to zero width (and reopens)
                          instead of popping in/out. Visible at stages 0 and 1;
                          only the arrow remains at stage 2 (most compact). */}
                      <motion.span
                        className="overflow-hidden"
                        initial={false}
                        animate={{ width: stage <= 1 ? "auto" : 0, opacity: stage <= 1 ? 1 : 0 }}
                        transition={layerTransition}
                      >
                        TODAY
                      </motion.span>
                    </button>
                  </div>
                )
              })()}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Full-bleed timeline: top/bottom borders run to the frame edges to
          suggest continuity with yesterday/tomorrow. Arrows flank the track. */}
      <div className="relative -mx-6 h-14">
        {/* Instant pins — one unified, full-height marker per instant: a
            down-triangle HEAD with the rotated title hanging beneath it, and a
            vertical STEM dropping from the triangle to the bottom of the track.
            The title sits OVER the stem (z-10 above the z-0 line, so the line is
            hidden behind the text). Hovering any part — triangle, label or stem —
            thickens and darkens all three together (state-driven, see
            hoveredInstant). The container is inset to match the viewport so a pin
            lands exactly on its time, and only rendered while in the window. */}
        <div
          className="pointer-events-none absolute inset-y-0 z-30"
          style={{ left: VIEWPORT_INSET_LEFT, right: VIEWPORT_INSET_RIGHT }}
        >
          {evts.map((e) => {
            if (e.kind !== "instant") return null
            const at = e.schedule?.at ?? 0
            const left = pct(at)
            if (left < 0 || left > 100) return null
            const color = getInheritedAccent(e.parentId ?? "s_root") ?? NEUTRAL_MARKER
            const isOpen = stack.includes(e.id)
            const hovered = hoveredInstant === e.id
            // Hover thickens + darkens all three pieces together.
            const lineColor = hovered ? "var(--foreground)" : color
            const onEnter = () => setHoveredInstant(e.id)
            const onLeave = () => setHoveredInstant((cur) => (cur === e.id ? null : cur))
            return (
              <div
                key={e.id}
                // pointer-events-none here so only the three visual pieces are
                // interactive (event chips below stay clickable through the gaps).
                className="pointer-events-none absolute bottom-0 flex w-4 flex-col items-center"
                style={{
                  left: `${left}%`,
                  top: -INSTANT_HEAD_H,
                  transform: "translateX(-50%)",
                  opacity: e.cancelled ? 0.45 : 1,
                }}
              >
                {/* STEM — from just under the triangle to the track bottom,
                    centered and BEHIND the label text. A wide invisible hit area
                    (`before:`) makes the thin line easy to hover. */}
                <span
                  aria-hidden
                  onMouseEnter={onEnter}
                  onMouseLeave={onLeave}
                  className={cn(
                    "pointer-events-auto absolute bottom-0 left-1/2 top-3 z-0 -translate-x-1/2",
                    "transition-[width,background-color] duration-150",
                    "before:absolute before:inset-y-0 before:-inset-x-1 before:content-['']",
                  )}
                  style={{ width: hovered ? 2 : 1, backgroundColor: lineColor }}
                />
                {/* TRIANGLE head — the timeline morph SOURCE (where="timeline").
                    Opening from the timeline is disabled for now; right-click
                    still offers the menu. */}
                <motion.button
                  type="button"
                  initial={false}
                  data-morph-source={e.id}
                  data-morph-where="timeline"
                  transition={panelTransition}
                  onMouseEnter={onEnter}
                  onMouseLeave={onLeave}
                  onContextMenu={(ev) => openMenu(ev, e)}
                  aria-current={isOpen ? "true" : undefined}
                  title={`${e.title} · ${fmt(at)}`}
                  className="pointer-events-auto relative z-10 flex h-3 w-3 items-center justify-center transition-transform duration-150"
                  style={{ color: lineColor, scale: hovered ? 1.25 : 1 }}
                >
                  <NodeGlyph kind="instant" filled strokeWidth={1.5} />
                </motion.button>
                {/* LABEL — rotated, hanging under the triangle, painted OVER the
                    stem so the line vanishes behind the glyphs. */}
                <span
                  onMouseEnter={onEnter}
                  onMouseLeave={onLeave}
                  className={cn(
                    "pointer-events-auto relative z-10 mt-1 max-h-[52px] truncate text-[10px] leading-none tracking-tight",
                    "transition-[color,font-weight] duration-150",
                    e.cancelled && "line-through",
                  )}
                  style={{
                    writingMode: "vertical-rl",
                    color: lineColor,
                    fontWeight: hovered ? 600 : 500,
                  }}
                  title={e.title}
                >
                  {e.title}
                </span>
              </div>
            )
          })}
        </div>

        {/* continuity rails — extend to the screen edges */}
        <div className="absolute left-0 right-0 top-0 h-px bg-border" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-border" />

        <div className="flex h-full items-stretch">
          {/* Zoom selector — a vertical list of single capital letters pinned to
              the far-left screen edge, left of the back arrow: Life, Year,
              Quarter, Month, Week, Day (top→bottom). The active span reads in
              full strength; the rest are discrete grey and brighten on hover.
              Skeleton for now — only "D" actually drives the view. */}
          <div
            // Fixed width (SELECTOR_W) so the viewport's left inset is
            // deterministic and the ruler / instant-label overlays can align to
            // it. The column is `flex-col`, so width is independent of the
            // animated vertical gap.
            style={{ width: SELECTOR_W }}
            className={cn(
              "relative z-10 flex shrink-0 flex-col items-center justify-center bg-background",
              // The spread tightens at stage 2 where the chrome is most compact.
              // A CSS transition on `gap` glides the shrink/expand smoothly —
              // more reliable than animating shorthand `gap` through motion.
              "transition-[gap] duration-300 ease-out",
              stage === 2 ? "gap-[0px]" : stage === 1 ? "gap-[2px]" : "gap-[4px]",
            )}
          >
            {VIEWS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                aria-pressed={view === key}
                aria-label={`${label} view`}
                title={`${label} view`}
                className={cn(
                  // Evenly-gapped letters with comfortable breathing room. Hover
                  // feedback is a font highlight only (no square background): an
                  // inactive letter brightens toward full strength on hover.
                  // NB: uses the arbitrary `[&:hover]` variant rather than Tailwind's
                  // `hover:` — the latter is gated behind `@media (hover: hover)`,
                  // which doesn't match in the preview (and some hybrid devices), so
                  // the highlight silently never fired. `[&:hover]` is ungated.
                  "rounded-[3px] px-1 py-0.5 text-[9px] font-semibold leading-none tracking-wide transition-colors",
                  view === key
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
            onClick={goPrev}
            aria-label="Previous day"
            className="flex w-10 shrink-0 items-center justify-center text-muted-foreground/70 transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {/* Viewport — the continuous lifeline. Drag the empty track to scrub
              time freely; markers sit above the drag layer so their clicks are
              never intercepted. */}
          <div
            ref={viewportRef}
            className="relative h-full flex-1 overflow-hidden border-x border-border bg-card/50"
          >
            {/* hour gridlines — every 1h, with even-hour lines stronger than
                the in-between odd-hour lines to preserve the 2h timestamp rhythm */}
            {gridTicks.map((m) => {
              const left = pct(m)
              if (left < 0 || left > 100) return null
              const isMajor = new Date(m).getHours() % 2 === 0
              return (
                <div
                  key={m}
                  className={cn(
                    "pointer-events-none absolute bottom-0 top-0 w-px",
                    isMajor ? "bg-border/40" : "bg-border/15",
                  )}
                  style={{ left: `${left}%` }}
                />
              )
            })}

            {/* drag surface — behind the markers (earlier in paint order) so it
                only catches pointerdowns on empty track. */}
            <div
              onPointerDown={startDrag}
              className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
              aria-hidden
            />

            {/* now marker — the live current time (`now`, refreshed each ~30s);
                scrolls out of view as the user drags away from today. A crisp
                accent rule capped by a small filled dot at top and bottom reads
                as a precise "this instant" pointer on the lifeline. */}
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

            {/* events + instants. Each carries the accent of the space it
                belongs to and opens its own window. Positioned in absolute time
                so they scroll in/out with the lifeline. */}
            {evts.map((e) => {
              const eventSpaceId = e.parentId ?? "s_root"
              // A child inherits the nearest ancestor accent (e.g. an item in
              // Zero → magenta). Items under the root ("Space 0"), which has no
              // accent, resolve to undefined and fall back to a neutral grey
              // marker. `color` therefore drives the marker; `labelColor`
              // matches it (grey items keep a readable label).
              const color = getInheritedAccent(eventSpaceId)
              const markerColor = color ?? NEUTRAL_MARKER
              // Reserved for the upcoming "highlight a child's related events"
              // step — we no longer dim by relevance, but will soon emphasize
              // related markers instead.
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const related = isInSubtree(contextId, eventSpaceId)
              const isOpen = stack.includes(e.id)
              // Instants render as full-height pins in their own overlay (above),
              // not as in-track markers — skip them here.
              if (e.kind === "instant") return null
              // Overlap-packed lane (see packLanes); 0 when nothing conflicts.
              const lane = lanes.lane.get(e.id) ?? 0

              // --- Event: a span chip ---------------------------------------
              const start = e.schedule?.startAt ?? 0
              const end = e.schedule?.endAt ?? start
              const left = pct(start)
              const width = ((end - start) / WINDOW_SPAN) * 100
              const boxStyle = {
                left: `calc(${left}% + 2px)`,
                width: `calc(${Math.max(width, 6)}% - 4px)`,
                // Top of the bar's packed lane within the centered lane stack.
                top: laneTop(lane),
              } as const
              // Linear-style "elevated bar": the whole bar carries a soft accent
              // TINT with a 1px accent border (no heavy left rule), and a small
              // rounded colour swatch leads the title — the project-colour cue
              // Linear places beside each bar. Subtle shadow lifts it off the track.
              const chipVisual = {
                borderColor: color ? `${color}59` : "var(--border)",
                backgroundColor: color ? `${color}26` : "var(--secondary)",
              } as const

              return (
                <div key={e.id} className="absolute h-6" style={boxStyle}>
                  {/* Persistent chip — the timeline morph SOURCE. Tagged with
                      where="timeline" so opening from here grows the window out
                      of this chip's box. Clicking an already-open event pulses
                      its window instead of reopening; otherwise it opens. */}
                  <motion.button
                    type="button"
                    initial={false}
                    data-morph-source={e.id}
                    data-morph-where="timeline"
                    // Chips are never dimmed by relevance anymore — the user's
                    // whole schedule stays clear regardless of which child is
                    // open. Only a cancelled event reads faded.
                    animate={{ opacity: e.cancelled ? 0.45 : 1 }}
                    transition={panelTransition}
                    // Opening entities FROM the timeline is intentionally disabled
                    // for now (a later feature) — the chip is informational only.
                    onContextMenu={(ev) => openMenu(ev, e)}
                    aria-current={isOpen ? "true" : undefined}
                    title={`${e.title} · ${fmt(start)}–${fmt(end)}`}
                    className={cn(
                      "flex h-6 w-full items-center gap-1.5 overflow-hidden rounded-md border px-2 text-[10.5px] tracking-tight",
                      "text-foreground/85 shadow-sm backdrop-blur-sm transition-[filter] hover:brightness-110",
                    )}
                    style={chipVisual}
                  >
                    {/* Leading colour swatch — the bar's owner-space cue. Title
                        keeps showing INSIDE the bar (truncating when the span is
                        too narrow), matching the current behaviour. */}
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: markerColor }}
                      aria-hidden
                    />
                    <span className={cn("truncate", e.cancelled && "line-through")}>
                      {e.title}
                    </span>
                  </motion.button>
                </div>
              )
            })}
          </div>

          <button
            type="button"
            onClick={goNext}
            aria-label="Next day"
            className="flex w-10 shrink-0 items-center justify-center text-muted-foreground/70 transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </section>
  )
}
