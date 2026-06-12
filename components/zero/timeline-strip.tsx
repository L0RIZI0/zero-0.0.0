"use client"

import { useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { getInheritedAccent, getSpaceEvents, isInSubtree } from "@/lib/zero/data"
import {
  panelTransition,
  layerTransition,
  eventLayoutId,
  eventTitleId,
  instantLayoutId,
  instantTitleId,
} from "@/lib/zero/motion"
import { useZeroNav } from "@/lib/zero/nav-store"
import { NodeGlyph } from "./node-glyph"
import { cn } from "@/lib/utils"

const DAY_START = 8 * 60 // 08:00
const DAY_END = 22 * 60 // 22:00
const SPAN = DAY_END - DAY_START

function fmt(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  const ampm = h >= 12 ? "pm" : "am"
  const hr = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, "0")}${ampm}`
}

// Slide variants for the day track — direction +1 means moving forward in time.
const dayVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? "100%" : "-100%", opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? "-100%" : "100%", opacity: 0 }),
}

export function TimelineStrip({
  spaceId,
  accent,
}: {
  spaceId: string
  accent?: string
}) {
  const { open, stack, dataVersion, requestPulse, openSourceOf } = useZeroNav()
  // The timeline always shows the FULL day (all events). When a child window is
  // open, events outside its subtree dim rather than disappear, so the user
  // keeps spatial context. `spaceId` is the active node's context space.
  const evts = useMemo(() => getSpaceEvents("s_root"), [dataVersion])
  const hours = useMemo(() => {
    const out: number[] = []
    for (let m = DAY_START; m <= DAY_END; m += 120) out.push(m)
    return out
  }, [])

  // The user can scrub the timeline backward/forward in time. dayOffset === 0
  // is today; only then is the "Today" label hidden. `direction` drives the
  // slide so days move left/right smoothly rather than snapping.
  const [dayOffset, setDayOffset] = useState(0)
  const [direction, setDirection] = useState(0)
  const isToday = dayOffset === 0

  const goPrev = () => {
    setDirection(-1)
    setDayOffset((o) => o - 1)
  }
  const goNext = () => {
    setDirection(1)
    setDayOffset((o) => o + 1)
  }
  const goToday = () => {
    setDirection(dayOffset > 0 ? -1 : 1)
    setDayOffset(0)
  }

  const viewedDate = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + dayOffset)
    return d
  }, [dayOffset])

  const dayLabel = viewedDate.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  })

  // A representative "now" marker for the prototype — only on today.
  const nowPct = ((13 * 60 + 5 - DAY_START) / SPAN) * 100

  const todayButton = (
    <button
      type="button"
      onClick={goToday}
      className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
    >
      Today
    </button>
  )
  const dateText = (
    <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground">
      {dayLabel}
    </span>
  )

  return (
    <section aria-label="Timeline" className="px-1">
      {/* Fixed-height row so the label can fade in without pushing the timeline
          down. On today, a static "Today" label sits centered above the track;
          otherwise the viewed date shows with a "Today" button to jump back,
          placed on the side it lies on relative to the viewed day. */}
      <div className="relative h-4">
        <AnimatePresence initial={false} mode="wait">
          {isToday ? (
            <motion.div
              key="today-label"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={panelTransition}
              className="absolute inset-x-0 bottom-0 flex items-end justify-center"
            >
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Today
              </span>
            </motion.div>
          ) : (
            <motion.div
              key="day-label"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={panelTransition}
              className="absolute inset-x-0 top-0 flex items-center justify-center gap-2"
            >
              {dayOffset > 0 ? (
                <>
                  {todayButton}
                  {dateText}
                </>
              ) : (
                <>
                  {dateText}
                  {todayButton}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* hour labels — a static ruler ABOVE the track, aligned to its width */}
      <div className="relative mb-1 h-3.5" style={{ marginLeft: 40, marginRight: 40 }}>
        {hours.map((h) => {
          const left = ((h - DAY_START) / SPAN) * 100
          return (
            <span
              key={h}
              className="absolute -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground/60"
              style={{ left: `${left}%` }}
            >
              {fmt(h)}
            </span>
          )
        })}
      </div>

      {/* Full-bleed timeline: top/bottom borders run to the frame edges to
          suggest continuity with yesterday/tomorrow. Arrows flank the track. */}
      <div className="relative -mx-6 h-14">
        {/* continuity rails — extend to the screen edges */}
        <div className="absolute left-0 right-0 top-0 h-px bg-border" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-border" />

        <div className="flex h-full items-stretch">
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous day"
            className="flex w-10 shrink-0 items-center justify-center text-muted-foreground/70 transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {/* Viewport — the day track slides within it; drag to scrub time. */}
          <div className="relative h-full flex-1 overflow-hidden border-x border-border bg-card/50">
            <AnimatePresence initial={false} custom={direction}>
              <motion.div
                key={dayOffset}
                custom={direction}
                variants={dayVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.18}
                dragSnapToOrigin
                onDragEnd={(_, info) => {
                  if (info.offset.x < -60) goNext()
                  else if (info.offset.x > 60) goPrev()
                }}
                className="absolute inset-0 cursor-grab active:cursor-grabbing"
              >
                {/* hour gridlines */}
                {hours.map((h) => {
                  const left = ((h - DAY_START) / SPAN) * 100
                  return (
                    <div
                      key={h}
                      className="pointer-events-none absolute bottom-0 top-0 w-px bg-border/60"
                      style={{ left: `${left}%` }}
                    />
                  )
                })}

                {/* now marker — today only */}
                {isToday && (
                  <div
                    className="pointer-events-none absolute bottom-1 top-1 z-10 w-px"
                    style={{ left: `${nowPct}%`, backgroundColor: accent ?? "var(--accent)" }}
                  >
                    <span
                      className="absolute -left-[3px] -top-1 h-[7px] w-[7px] rounded-full"
                      style={{ backgroundColor: accent ?? "var(--accent)" }}
                    />
                  </div>
                )}

                {/* events + instants — only render on today for this prototype.
                    Each carries the accent of the space it belongs to and opens
                    its own window. Events render as spans; instants render as a
                    single down-triangle marker at one precise point in time. */}
                {isToday &&
                  evts.map((e, i) => {
                    const eventSpaceId = e.parentId ?? "s_root"
                    // A child inherits the nearest ancestor accent (e.g. an item
                    // in Zero → magenta). Items under the root ("Space 0"), which
                    // has no accent, resolve to undefined and fall back to a
                    // neutral grey marker. `color` therefore drives the marker;
                    // `labelColor` matches it (grey items keep a readable label).
                    const color = getInheritedAccent(eventSpaceId)
                    const markerColor = color ?? NEUTRAL_MARKER
                    const related = isInSubtree(spaceId, eventSpaceId)
                    const isOpen = stack.includes(e.id)
                    const lane = i % 2

                    // --- Instant: a single point marker (down triangle) -------
                    if (e.kind === "instant") {
                      const at = e.at ?? 0
                      const left = ((at - DAY_START) / SPAN) * 100
                      // The timeline marker only lends its shared layoutId to the
                      // frame when the window was opened FROM the timeline. If it
                      // was opened from the DO-list row, the row owns the morph,
                      // so the marker stays put (no overlay handed off).
                      const showMorphOverlay = !isOpen || openSourceOf(e.id) !== "timeline"
                      return (
                        <div
                          key={e.id}
                          className="absolute flex -translate-x-1/2 flex-col items-center"
                          style={{ left: `${left}%`, top: lane === 0 ? 4 : 26 }}
                        >
                          <motion.button
                            type="button"
                            initial={false}
                            animate={{ opacity: isOpen || related ? 1 : 0.25 }}
                            transition={panelTransition}
                            onClick={() => (isOpen ? requestPulse(e.id) : open(e.id, "timeline"))}
                            aria-current={isOpen ? "true" : undefined}
                            title={`${e.title} · ${fmt(at)}`}
                            className="flex flex-col items-center gap-0.5 transition-[filter] hover:brightness-110"
                          >
                            <span
                              className="flex h-3 w-3 items-center justify-center"
                              style={{ color: color ?? "var(--accent)" }}
                            >
                              <NodeGlyph kind="instant" filled strokeWidth={1.5} />
                            </span>
                            <span className="max-w-[80px] truncate text-[10px] tracking-tight text-foreground/90">
                              {e.title}
                            </span>
                          </motion.button>
                          {showMorphOverlay && (
                            <motion.div
                              layoutId={instantLayoutId(e.id)}
                              transition={layerTransition}
                              aria-hidden
                              className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2"
                              style={{ opacity: related ? 1 : 0.25 }}
                            >
                              <motion.span
                                layoutId={instantTitleId(e.id)}
                                transition={layerTransition}
                                className="sr-only"
                              >
                                {e.title}
                              </motion.span>
                            </motion.div>
                          )}
                        </div>
                      )
                    }

                    // --- Event: a span chip -----------------------------------
                    const start = e.start ?? 0
                    const end = e.end ?? start
                    const left = ((start - DAY_START) / SPAN) * 100
                    const width = ((end - start) / SPAN) * 100
                    // Events morph between the TIMELINE and their window when
                    // opened from the timeline. The overlay (which carries the
                    // shared layoutId) lives on the timeline whenever the event
                    // isn't open. If the event was opened from its DO-list row,
                    // the row owns the morph, so the timeline keeps its overlay
                    // (it isn't handed to the frame). Because the chip below
                    // never owns a layoutId, navigation never slides it.
                    const showMorphOverlay = !isOpen || openSourceOf(e.id) !== "timeline"

                    const boxStyle = {
                      left: `calc(${left}% + 2px)`,
                      width: `calc(${Math.max(width, 6)}% - 4px)`,
                      top: lane === 0 ? 6 : 28,
                    } as const
                    const chipVisual = {
                      borderLeftColor: color ?? "var(--accent)",
                      backgroundColor: color ? `${color}26` : "var(--secondary)",
                    } as const

                    return (
                      <div key={e.id} className="absolute h-5" style={boxStyle}>
                        {/* Persistent chip — ALWAYS on the timeline. It never owns
                            a layoutId, so it can't be morphed/slid away. Clicking
                            an already-open event pulses its window instead of
                            reopening; otherwise it opens the event. */}
                        <motion.button
                          type="button"
                          initial={false}
                          // The open event IS the current focus, so its chip stays
                          // lit like any related item; unrelated events dim.
                          animate={{ opacity: isOpen || related ? 1 : 0.25 }}
                          transition={panelTransition}
                          onClick={() => (isOpen ? requestPulse(e.id) : open(e.id, "timeline"))}
                          aria-current={isOpen ? "true" : undefined}
                          title={`${e.title} · ${fmt(start)}–${fmt(end)}`}
                          className={cn(
                            "flex h-5 w-full items-center overflow-hidden rounded-sm border-l-2 px-1.5 text-[10.5px] tracking-tight",
                            "text-foreground/90 backdrop-blur-sm transition-[filter] hover:brightness-110",
                          )}
                          style={chipVisual}
                        >
                          <span className="truncate">{e.title}</span>
                        </motion.button>

                        {/* Morph overlay — a visual twin sitting exactly on top of
                            the chip, carrying the shared layoutId so the expand
                            animation reads as the chip growing into the window. It
                            is non-interactive and unmounts on open (handing the id
                            to the frame), leaving the persistent chip behind. */}
                        {showMorphOverlay && (
                          <motion.div
                            layoutId={eventLayoutId(e.id)}
                            transition={layerTransition}
                            aria-hidden
                            className="pointer-events-none absolute inset-0 flex h-5 items-center overflow-hidden rounded-sm border-l-2 px-1.5 text-[10.5px] tracking-tight text-foreground/90 backdrop-blur-sm"
                            style={{ ...chipVisual, opacity: related ? 1 : 0.25 }}
                          >
                            <motion.span layoutId={eventTitleId(e.id)} transition={layerTransition} className="truncate">
                              {e.title}
                            </motion.span>
                          </motion.div>
                        )}
                      </div>
                    )
                  })}
              </motion.div>
            </AnimatePresence>
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
    </section>
  )
}
