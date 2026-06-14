"use client"

import { useMemo, useRef, useState } from "react"
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

const DAY = 24 * 60 // minutes in a day
const DEFAULT_START = 8 * 60 // 08:00 — left edge of a day's default framing
const DEFAULT_END = 22 * 60 // 22:00 — right edge of a day's default framing
// The visible window is always this wide (14h). The continuous "lifeline" is
// expressed in ABSOLUTE minutes measured from midnight of today (day 0), so
// today 8am = 480, tomorrow 1am = 1500, yesterday 11pm = -60, etc. `viewStart`
// is the absolute minute pinned to the left edge of the viewport.
const WINDOW_SPAN = DEFAULT_END - DEFAULT_START // 840

// "Now" for the prototype: today at 1:05pm, in absolute minutes.
const NOW_ABS = 13 * 60 + 5

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

function fmt(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  const ampm = h >= 12 ? "pm" : "am"
  const hr = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, "0")}${ampm}`
}

// Minute-of-day (0..1439) for an absolute minute, handling negatives.
function minuteOfDay(abs: number) {
  return ((Math.round(abs) % DAY) + DAY) % DAY
}

export function TimelineStrip({
  contextId,
  accent,
}: {
  contextId: string
  accent?: string
}) {
  const { open, stack, dataVersion, requestPulse, notifyDataChanged } = useZeroNav()
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  // Shell compaction stage (0 root, 1 one child, 2 two+ children), mirroring
  // shellStageFor. Drives the most compact treatments — e.g. the "Today" link
  // collapses to just its arrow and the zoom selector tightens at stage 2.
  const stage = Math.min(stack.length - 1, 2)

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

  // --- Continuous lifeline state -------------------------------------------
  // `viewStart` is the absolute minute at the left edge of the viewport. It can
  // be any real value — dragging scrubs it freely (a continuous lifeline of
  // time), while the arrows snap to a day's default 8am–10pm framing.
  const [viewStart, setViewStart] = useState(DEFAULT_START)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const animRef = useRef<ReturnType<typeof animate> | null>(null)

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

  // Absolute-minute → percentage across the viewport.
  const pct = (abs: number) => ((abs - viewStart) / WINDOW_SPAN) * 100

  // Which day the CENTER of the window lands in, relative to today (day 0).
  const dayOffset = Math.floor((viewStart + WINDOW_SPAN / 2) / DAY)
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

  const dayDefaultStart = (offset: number) => offset * DAY + DEFAULT_START
  const goPrev = () => animateView(dayDefaultStart(dayOffset - 1))
  const goNext = () => animateView(dayDefaultStart(dayOffset + 1))
  const goToday = () => animateView(DEFAULT_START)

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
      const deltaMin = ((ev.clientX - startX) / width) * WINDOW_SPAN
      setViewStart(startView - deltaMin)
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
  const ticks = useMemo(() => {
    const first = Math.ceil(viewStart / 120) * 120
    const out: number[] = []
    for (let m = first; m <= viewStart + WINDOW_SPAN; m += 120) out.push(m)
    return out
  }, [viewStart])

  // Gridlines every 1h (denser than the 2h timestamps). Lines on an even hour
  // (where a timestamp sits) read as "major"; the in-between odd-hour lines are
  // fainter so the 2h rhythm stays legible.
  const gridTicks = useMemo(() => {
    const first = Math.ceil(viewStart / 60) * 60
    const out: number[] = []
    for (let m = first; m <= viewStart + WINDOW_SPAN; m += 60) out.push(m)
    return out
  }, [viewStart])

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
          "relative mb-1 transition-[height] duration-300 ease-out",
          // At stage 2 the band shrinks so the bottom-anchored hour ruler — and
          // the timeline track + zoom selectors below it — ride a bit higher,
          // balancing the day label between the top date and the timestamps.
          stage === 2 ? "h-8" : "h-10",
        )}
      >
        {/* hour ruler — anchored to the bottom, aligned to the track width */}
        <div className="absolute inset-x-0 bottom-0 h-3.5" style={{ marginLeft: 40, marginRight: 40 }}>
          {ticks.map((m) => {
            const left = pct(m)
            if (left < 0 || left > 100) return null
            return (
              <span
                key={m}
                className="absolute bottom-0 -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground/60"
                style={{ left: `${left}%` }}
              >
                {fmt(minuteOfDay(m))}
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
              // higher at the root, then progressively lower as the band tightens
              // (it was reading too high at stages 1 and 2).
              animate={{ opacity: 1, y: stage === 0 ? -2 : stage === 1 ? 1.5 : 3.5 }}
              exit={{ opacity: 0, y: -4 }}
              transition={panelTransition}
              className="absolute inset-x-0 top-0 bottom-3.5 flex items-center justify-center bg-background"
            >
              {(() => {
                const todayIsLeft = dayOffset > 0
                const Arrow = todayIsLeft ? ArrowLeft : ArrowRight
                return (
                  <span className="relative text-[11px] font-medium tracking-tight text-foreground">
                    {dayLabel}
                    <button
                      type="button"
                      onClick={goToday}
                      aria-label="Back to today"
                      title="Back to today"
                      className={cn(
                        // Generous padding + hover background give the arrow a
                        // reliable hit/feedback area once it collapses to just
                        // the icon at deeper stages.
                        "absolute top-1/2 flex -translate-y-1/2 items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 py-1 text-[10px] font-medium leading-none text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground",
                        todayIsLeft ? "right-full mr-2" : "left-full ml-2 flex-row-reverse",
                      )}
                    >
                      <Arrow className="h-3 w-3 shrink-0" strokeWidth={2.75} />
                      {/* The word smoothly collapses to zero width (and reopens)
                          when leaving/entering the root stage, instead of
                          popping in and out. Only visible at stage 0. */}
                      <motion.span
                        className="overflow-hidden"
                        initial={false}
                        animate={{ width: stage === 0 ? "auto" : 0, opacity: stage === 0 ? 1 : 0 }}
                        transition={layerTransition}
                      >
                        TODAY
                      </motion.span>
                    </button>
                  </span>
                )
              })()}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Full-bleed timeline: top/bottom borders run to the frame edges to
          suggest continuity with yesterday/tomorrow. Arrows flank the track. */}
      <div className="relative -mx-6 h-14">
        {/* Instant labels — written vertically and anchored to the TOP of the
            track so they rise above the marker without adding layout height.
            Inset `left-10 right-10` to match the viewport; only rendered while
            within the visible window so they don't bleed over the arrows. */}
        <div className="pointer-events-none absolute bottom-full left-10 right-10 z-0">
          {evts.map((e) => {
            if (e.kind !== "instant") return null
            const left = pct(e.at ?? 0)
            if (left < 0 || left > 100) return null
            const labelColor = getInheritedAccent(e.parentId ?? "s_root") ?? NEUTRAL_MARKER
            return (
              <span
                key={e.id}
                className={cn(
                  "absolute bottom-1 max-h-[40vh] truncate text-[10px] font-medium leading-none tracking-tight",
                  e.cancelled && "line-through opacity-50",
                )}
                style={{
                  left: `${left}%`,
                  color: labelColor,
                  writingMode: "vertical-rl",
                  transform: "translateX(-50%)",
                }}
                title={e.title}
              >
                {e.title}
              </span>
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
            className={cn(
              "relative z-10 flex shrink-0 flex-col items-center justify-center bg-background pl-0.5 pr-[7px]",
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
                  // Evenly-gapped letters with comfortable breathing room. A
                  // hover background gives feedback on every letter, including
                  // the active one whose text is already full strength and so
                  // wouldn't change on a color-only hover.
                  "rounded-[3px] px-1 py-0.5 text-[9px] font-semibold leading-none tracking-wide transition-colors hover:bg-foreground/10",
                  view === key
                    ? "text-foreground"
                    : "text-muted-foreground/40 hover:text-foreground/80",
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
              const isMajor = (m / 60) % 2 === 0
              return (
                <div
                  key={m}
                  className={cn(
                    "pointer-events-none absolute bottom-0 top-0 w-px",
                    isMajor ? "bg-border/60" : "bg-border/25",
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

            {/* now marker — pinned at today 1:05pm in absolute time; scrolls out
                of view as the user drags away from today. */}
            <div
              className="pointer-events-none absolute bottom-1 top-1 z-10 w-px"
              style={{ left: `${pct(NOW_ABS)}%`, backgroundColor: accent ?? "var(--accent)" }}
            >
              <span
                className="absolute -left-[3px] -top-1 h-[7px] w-[7px] rounded-full"
                style={{ backgroundColor: accent ?? "var(--accent)" }}
              />
            </div>

            {/* events + instants. Each carries the accent of the space it
                belongs to and opens its own window. Positioned in absolute time
                so they scroll in/out with the lifeline. */}
            {evts.map((e, i) => {
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
              const lane = i % 2

              // --- Instant: a single point marker (down triangle) -----------
              if (e.kind === "instant") {
                const at = e.at ?? 0
                const left = pct(at)
                // The marker is the timeline morph SOURCE: tagged with
                // where="timeline" so opening from here grows the window out of
                // this point (the DO-list row carries where="row" for the other
                // entry path). No layoutId / overlay twin anymore.
                return (
                  <div
                    key={e.id}
                    className="absolute flex -translate-x-1/2 flex-col items-center"
                    style={{ left: `${left}%`, top: lane === 0 ? 4 : 26 }}
                  >
                    <motion.button
                      type="button"
                      initial={false}
                      data-morph-source={e.id}
                      data-morph-where="timeline"
                      // Markers are never dimmed by relevance anymore — the
                      // user's whole schedule stays clear regardless of which
                      // child is open. Only a cancelled marker reads faded.
                      animate={{ opacity: e.cancelled ? 0.45 : 1 }}
                      transition={panelTransition}
                      onClick={() => (isOpen ? requestPulse(e.id) : open(e.id, "timeline"))}
                      onContextMenu={(ev) => openMenu(ev, e)}
                      aria-current={isOpen ? "true" : undefined}
                      title={`${e.title} · ${fmt(at)}`}
                      className="flex flex-col items-center transition-[filter] hover:brightness-110"
                    >
                      <span
                        className="flex h-3 w-3 items-center justify-center"
                        style={{ color: markerColor }}
                      >
                        <NodeGlyph kind="instant" filled strokeWidth={1.5} />
                      </span>
                    </motion.button>
                  </div>
                )
              }

              // --- Event: a span chip ---------------------------------------
              const start = e.start ?? 0
              const end = e.end ?? start
              const left = pct(start)
              const width = ((end - start) / WINDOW_SPAN) * 100
              const boxStyle = {
                left: `calc(${left}% + 2px)`,
                width: `calc(${Math.max(width, 6)}% - 4px)`,
                top: lane === 0 ? 6 : 28,
              } as const
              // Brighter fill now that the overlay no longer doubles up on top
              // of the chip — keeps the chips popping on their own.
              const chipVisual = {
                borderLeftColor: markerColor,
                backgroundColor: color ? `${color}40` : "var(--secondary)",
              } as const

              return (
                <div key={e.id} className="absolute h-5" style={boxStyle}>
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
                    onClick={() => (isOpen ? requestPulse(e.id) : open(e.id, "timeline"))}
                    onContextMenu={(ev) => openMenu(ev, e)}
                    aria-current={isOpen ? "true" : undefined}
                    title={`${e.title} · ${fmt(start)}–${fmt(end)}`}
                    className={cn(
                      "flex h-5 w-full items-center overflow-hidden rounded-sm border-l-2 px-1.5 text-[10.5px] tracking-tight",
                      "text-foreground/90 backdrop-blur-sm transition-[filter] hover:brightness-110",
                    )}
                    style={chipVisual}
                  >
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
