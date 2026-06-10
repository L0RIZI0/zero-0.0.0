"use client"

import { useMemo } from "react"
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

  // A representative "now" marker for the prototype.
  const nowPct = ((13 * 60 + 5 - DAY_START) / SPAN) * 100

  return (
    <section aria-label="Timeline" className="px-1">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Today
        </h2>
        <span className="text-[11px] tracking-tight text-muted-foreground/70">
          {evts.length} {evts.length === 1 ? "event" : "events"}
        </span>
      </div>

      <div className="relative h-16 w-full rounded-sm border border-border bg-card/50">
        {/* hour gridlines */}
        {hours.map((h) => {
          const left = ((h - DAY_START) / SPAN) * 100
          return (
            <div
              key={h}
              className="absolute top-0 bottom-5 w-px bg-border/60"
              style={{ left: `${left}%` }}
            >
              <span className="absolute -bottom-5 -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground/60">
                {fmt(h)}
              </span>
            </div>
          )
        })}

        {/* now marker */}
        <div
          className="absolute top-1 bottom-5 z-10 w-px"
          style={{ left: `${nowPct}%`, backgroundColor: accent ?? "var(--accent)" }}
        >
          <span
            className="absolute -top-1 -left-[3px] h-[7px] w-[7px] rounded-full"
            style={{ backgroundColor: accent ?? "var(--accent)" }}
          />
        </div>

        {/* events */}
        {evts.map((e, i) => {
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
                top: lane === 0 ? 8 : 30,
              }}
            >
              <span className="truncate">{e.title}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
