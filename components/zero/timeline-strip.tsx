"use client"

import { useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { getSpace, getSpaceEvents, isInSubtree } from "@/lib/zero/data"
import { panelTransition } from "@/lib/zero/motion"
import { useZeroNav } from "@/lib/zero/nav-store"
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
  const { openSpace, dataVersion } = useZeroNav()
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

                {/* events — only render on today for this prototype. Each event
                    carries the accent of the space it belongs to and opens that
                    space as a layer, just like a task. */}
                {isToday &&
                  evts.map((e, i) => {
                    const start = e.start ?? 0
                    const end = e.end ?? start
                    const left = ((start - DAY_START) / SPAN) * 100
                    const width = ((end - start) / SPAN) * 100
                    const lane = i % 2
                    const eventSpaceId = e.parentId ?? "s_root"
                    const space = getSpace(eventSpaceId)
                    const color = space?.accent
                    // Dim events that aren't in the active node's subtree.
                    const related = isInSubtree(spaceId, eventSpaceId)
                    return (
                      <motion.button
                        key={e.id}
                        type="button"
                        initial={false}
                        animate={{ opacity: related ? 1 : 0.25 }}
                        transition={panelTransition}
                        onClick={() => openSpace(eventSpaceId)}
                        title={`${e.title} · ${fmt(start)}–${fmt(end)}`}
                        className={cn(
                          "absolute flex h-5 items-center overflow-hidden rounded-sm border-l-2 px-1.5 text-[10.5px] tracking-tight",
                          "text-foreground/90 backdrop-blur-sm transition-[filter] hover:brightness-110",
                        )}
                        style={{
                          left: `calc(${left}% + 2px)`,
                          width: `calc(${Math.max(width, 6)}% - 4px)`,
                          top: lane === 0 ? 6 : 28,
                          borderLeftColor: color ?? "var(--accent)",
                          backgroundColor: color ? `${color}26` : "var(--secondary)",
                        }}
                      >
                        <span className="truncate">{e.title}</span>
                      </motion.button>
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
