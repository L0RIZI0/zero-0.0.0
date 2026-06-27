"use client"

import { useMemo, useRef } from "react"
import { cn } from "@/lib/utils"
import { packDay } from "@/lib/zero/day-pack"
import {
  DAY_COUNT,
  DAYS_BEFORE,
  HOUR_AXIS_W,
  ATLAS_HEADER_H,
  HOUR_MARKS,
  startOfDay,
  firstDayFor,
  fmtColumn,
} from "@/lib/zero/timeline-morph"
import type { SerpItem } from "./timeline-serpentine"
import type { Entity } from "@/lib/zero/types"

const DAY_MS = 86_400_000

/** "1 PM" / "12 AM" — compact 12-hour axis labels. */
function fmtHour(h: number): string {
  const period = h < 12 ? "AM" : "PM"
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr} ${period}`
}

/**
 * THIS WEEK — a true day-column calendar: five DAY columns flowing left→right
 * (center−2 … center … center+2), with time running VERTICALLY down each column
 * (00:00 top → 24:00 bottom). Items are placed by their real time-of-day and runs
 * of overlapping items split into side-by-side columns (shared `packDay`), so a
 * busy hour fans its entities out horizontally instead of stacking down the day.
 *
 * The visible window is anchored on `centerMs` (today, shifted by whole-day drags)
 * rather than always on "now", so the user can DRAG the grid left/right to reach
 * earlier/later days. The header height and column geometry are imported from
 * `timeline-morph` so the plane-morph overlay lands entities on exactly these rects.
 */
export function TimelineWeek({
  items,
  now,
  centerMs,
  onPanDays,
  onOpen,
  onMenu,
}: {
  items: SerpItem[]
  now: number
  centerMs: number
  onPanDays: (deltaDays: number) => void
  onOpen: (id: string) => void
  onMenu: (e: React.MouseEvent, entity: Entity) => void
}) {
  const today0 = startOfDay(now)
  const firstDay = firstDayFor(centerMs)

  const columns = useMemo(() => {
    return Array.from({ length: DAY_COUNT }, (_, i) => {
      const ds = firstDay + i * DAY_MS
      const de = ds + DAY_MS
      const bucket = items
        .filter((it) => {
          const isInstant = it.kind === "instant" || it.from === it.to
          return isInstant ? it.from >= ds && it.from < de : it.from < de && it.to > ds
        })
        .map((it) => ({ it, isInstant: it.kind === "instant" || it.from === it.to }))
      return { ds, de, placed: packDay(bucket, ds) }
    })
  }, [items, firstDay])

  // --- Drag-to-pan ----------------------------------------------------------
  // Dragging the grid horizontally pans the visible window by whole days: each time
  // the pointer crosses one column-width we step `onPanDays(±1)`. `panned` guards the
  // click so a pan-drag that starts on a chip doesn't also open that entity.
  const drag = useRef<{ x0: number; colW: number; lastStep: number; panned: boolean } | null>(null)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const w = e.currentTarget.clientWidth
    const colW = Math.max(1, (w - HOUR_AXIS_W) / DAY_COUNT)
    drag.current = { x0: e.clientX, colW, lastStep: 0, panned: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x0
    // Drag RIGHT (dx > 0) reveals EARLIER days, so the center moves back (negative).
    const step = Math.trunc(-dx / d.colW)
    if (step !== d.lastStep) {
      onPanDays(step - d.lastStep)
      d.lastStep = step
      d.panned = true
    }
  }
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    // Keep `panned` truthy for the click that immediately follows a pan, then clear.
    const wasPanned = drag.current?.panned ?? false
    drag.current = null
    if (wasPanned) {
      panGuard.current = true
      setTimeout(() => (panGuard.current = false), 0)
    }
  }
  const panGuard = useRef(false)

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      {/* Column header row — one date per day; today is bold/accented. Fixed height
          (ATLAS_HEADER_H) so the morph overlay's title "to" rect matches exactly. */}
      <div
        className="flex shrink-0 items-stretch border-b border-border"
        style={{ paddingLeft: HOUR_AXIS_W, height: ATLAS_HEADER_H }}
      >
        {columns.map((col) => {
          const isToday = col.ds === today0
          return (
            <div
              key={`h-${col.ds}`}
              className={cn(
                "flex flex-1 items-center justify-center border-l border-border/40 text-[10px] font-semibold tabular-nums tracking-wide",
                isToday ? "text-foreground" : "text-muted-foreground/60",
              )}
            >
              <span className={cn("rounded px-1.5 py-0.5", isToday && "bg-foreground text-background")}>
                {fmtColumn(col.ds)}
              </span>
            </div>
          )
        })}
      </div>

      {/* Grid body — hour axis on the left, then the day columns. Drag to pan days. */}
      <div
        className="relative flex flex-1 touch-none items-stretch overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ cursor: "grab" }}
      >
        {/* Hour axis. */}
        <div className="relative shrink-0" style={{ width: HOUR_AXIS_W }} aria-hidden>
          {HOUR_MARKS.map((h) => (
            <span
              key={h}
              className="absolute right-1.5 -translate-y-1/2 text-[9px] font-medium tabular-nums text-muted-foreground/50"
              style={{ top: `${(h / 24) * 100}%` }}
            >
              {fmtHour(h)}
            </span>
          ))}
        </div>

        {columns.map((col) => {
          const isToday = col.ds === today0
          const nowF = now >= col.ds && now < col.de ? (now - col.ds) / DAY_MS : null
          return (
            <div
              key={`c-${col.ds}`}
              className={cn("relative flex-1 border-l border-border/40", isToday && "bg-foreground/[0.03]")}
            >
              {/* Hour gridlines — subtle every hour, a touch stronger at the marks. */}
              {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
                <div
                  key={h}
                  className={cn(
                    "pointer-events-none absolute inset-x-0 h-px",
                    HOUR_MARKS.includes(h) ? "bg-border/30" : "bg-border/15",
                  )}
                  style={{ top: `${(h / 24) * 100}%` }}
                  aria-hidden
                />
              ))}

              {/* Now line across today's column. */}
              {nowF != null && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-20 h-px bg-foreground/70"
                  style={{ top: `${nowF * 100}%` }}
                  aria-hidden
                >
                  <span className="absolute left-0.5 -top-2 text-[7px] font-semibold uppercase tracking-wide text-foreground/70">
                    now
                  </span>
                </div>
              )}

              {/* Items — time-positioned, overlaps fanned into side-by-side columns. */}
              {col.placed.map(({ it, isInstant, sf, ef, col: cIdx, cols }) => {
                const wPct = 100 / cols
                return (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => {
                      if (panGuard.current) return
                      it.entity && onOpen(it.entity.id)
                    }}
                    onContextMenu={(ev) => it.entity && onMenu(ev, it.entity)}
                    title={it.title}
                    className={cn(
                      "absolute z-10 flex flex-col gap-0.5 overflow-hidden rounded-[3px] px-1 py-0.5 text-left text-[9px] leading-tight tracking-tight",
                      "text-foreground/85 transition-[filter] hover:brightness-110",
                      !isInstant && "border",
                    )}
                    style={{
                      top: `${sf * 100}%`,
                      height: isInstant ? undefined : `${(ef - sf) * 100}%`,
                      minHeight: 14,
                      left: `calc(${cIdx * wPct}% + 1px)`,
                      width: `calc(${wPct}% - 2px)`,
                      borderColor: isInstant ? undefined : `${it.color}66`,
                      backgroundColor: isInstant ? undefined : `${it.color}26`,
                      opacity: it.dim,
                    }}
                  >
                    <span className="flex items-center gap-1">
                      {isInstant && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: it.color }}
                          aria-hidden
                        />
                      )}
                      <span className={cn("truncate font-medium", it.cancelled && "line-through")}>{it.title}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
