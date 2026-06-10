"use client"

import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { getSpaceEvents } from "@/lib/zero/data"
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

export function TimelineStrip({
  spaceId,
  accent,
}: {
  spaceId: string
  accent?: string
}) {
  const evts = useMemo(() => getSpaceEvents(spaceId), [spaceId])
  const hours = useMemo(() => {
    const out: number[] = []
    for (let m = DAY_START; m <= DAY_END; m += 120) out.push(m)
    return out
  }, [])

  // The user can scrub the timeline backward/forward in time. dayOffset === 0
  // is today; only then is the "Today" label hidden.
  const [dayOffset, setDayOffset] = useState(0)
  const isToday = dayOffset === 0

  const viewedDate = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + dayOffset)
    return d
  }, [dayOffset])

  const dayLabel = isToday
    ? "Today"
    : viewedDate.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })

  // A representative "now" marker for the prototype — only on today.
  const nowPct = ((13 * 60 + 5 - DAY_START) / SPAN) * 100

  return (
    <section aria-label="Timeline" className="px-1">
      {/* The day label only appears when viewing a day other than today. */}
      {!isToday && (
        <div className="mb-1.5 flex items-center justify-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground">
            {dayLabel}
          </span>
          <button
            type="button"
            onClick={() => setDayOffset(0)}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            Today
          </button>
        </div>
      )}

      {/* Full-bleed timeline: top/bottom borders run to the frame edges to
          suggest continuity with yesterday/tomorrow. Arrows flank the track. */}
      <div className="relative -mx-6 h-14">
        {/* continuity rails — extend to the screen edges */}
        <div className="absolute left-0 right-0 top-0 h-px bg-border" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-border" />

        <div className="flex h-full items-stretch">
          <button
            type="button"
            onClick={() => setDayOffset((o) => o - 1)}
            aria-label="Previous day"
            className="flex w-10 shrink-0 items-center justify-center text-muted-foreground/70 transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <div className="relative h-full flex-1 border-x border-border bg-card/50">
            {/* hour gridlines */}
            {hours.map((h) => {
              const left = ((h - DAY_START) / SPAN) * 100
              return (
                <div
                  key={h}
                  className="absolute top-0 bottom-0 w-px bg-border/60"
                  style={{ left: `${left}%` }}
                />
              )
            })}

            {/* now marker — today only */}
            {isToday && (
              <div
                className="absolute top-1 bottom-1 z-10 w-px"
                style={{ left: `${nowPct}%`, backgroundColor: accent ?? "var(--accent)" }}
              >
                <span
                  className="absolute -top-1 -left-[3px] h-[7px] w-[7px] rounded-full"
                  style={{ backgroundColor: accent ?? "var(--accent)" }}
                />
              </div>
            )}

            {/* events — only render on today for this prototype */}
            {isToday &&
              evts.map((e, i) => {
                const left = ((e.start - DAY_START) / SPAN) * 100
                const width = ((e.end - e.start) / SPAN) * 100
                const lane = i % 2
                return (
                  <div
                    key={e.id}
                    title={`${e.title} · ${fmt(e.start)}–${fmt(e.end)}`}
                    className={cn(
                      "absolute flex h-5 items-center overflow-hidden rounded-sm border px-1.5 text-[10.5px] tracking-tight",
                      "border-foreground/10 bg-secondary/90 text-foreground/90 backdrop-blur-sm",
                    )}
                    style={{
                      left: `calc(${left}% + 2px)`,
                      width: `calc(${Math.max(width, 6)}% - 4px)`,
                      top: lane === 0 ? 6 : 28,
                    }}
                  >
                    <span className="truncate">{e.title}</span>
                  </div>
                )
              })}
          </div>

          <button
            type="button"
            onClick={() => setDayOffset((o) => o + 1)}
            aria-label="Next day"
            className="flex w-10 shrink-0 items-center justify-center text-muted-foreground/70 transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* hour labels — placed below the timeline track, aligned to its width */}
      <div className="relative mt-1 h-3.5" style={{ marginLeft: 40, marginRight: 40 }}>
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
    </section>
  )
}
