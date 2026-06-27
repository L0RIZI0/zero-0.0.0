"use client"

import { useMemo } from "react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import { packDay } from "@/lib/zero/day-pack"
import type { SerpItem } from "./timeline-serpentine"
import type { Entity } from "@/lib/zero/types"

const DAY_MS = 86_400_000
const HOUR_AXIS_W = 40
// Seconds for the shared-element morph (mirrors MORPH_MS in timeline-strip).
const MORPH_S = 0.52
// The 7 day columns are anchored on TODAY: two days back through four days forward,
// so "today" sits in the third column and the near future gets the most room.
const DAYS_BEFORE = 2
const DAYS_AFTER = 4
const DAY_COUNT = DAYS_BEFORE + 1 + DAYS_AFTER // 7
// Hour rows to label on the axis (every 3h keeps the gutter readable at fullscreen).
const HOUR_MARKS = [0, 3, 6, 9, 12, 15, 18, 21]

/** Local midnight (00:00) of `epoch`'s day, as epoch ms. */
function startOfDay(epoch: number): number {
  const d = new Date(epoch)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** "SAT JUN 26" — weekday + month abbreviations + day-of-month, uppercased. */
function fmtColumn(ms: number): string {
  const d = new Date(ms)
  const wd = d.toLocaleDateString(undefined, { weekday: "short" })
  const mo = d.toLocaleDateString(undefined, { month: "short" })
  return `${wd} ${mo} ${d.getDate()}`.toUpperCase()
}

/** "1 PM" / "12 AM" — compact 12-hour axis labels. */
function fmtHour(h: number): string {
  const period = h < 12 ? "AM" : "PM"
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr} ${period}`
}

/**
 * THIS WEEK — a true day-column calendar: seven DAY columns flowing left→right
 * (today−2 … today … today+4), with time running VERTICALLY down each column
 * (00:00 top → 24:00 bottom). Items are placed by their real time-of-day and runs
 * of overlapping items split into side-by-side columns (shared `packDay`), so a
 * busy hour fans its entities out horizontally instead of stacking down the day.
 *
 * Multi-day spans are clipped into each day they touch (a full-height block on days
 * they fully cover), which keeps the implementation a single per-day layout pass.
 */
export function TimelineWeek({
  items,
  now,
  morphing,
  onOpen,
  onMenu,
}: {
  items: SerpItem[]
  now: number
  morphing: boolean
  onOpen: (id: string) => void
  onMenu: (e: React.MouseEvent, entity: Entity) => void
}) {
  const today0 = startOfDay(now)
  const firstDay = today0 - DAYS_BEFORE * DAY_MS

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

  // A multi-day item appears in several columns; its shared-element `layoutId` must be
  // unique, so only the LEFTMOST column it occupies bears the morph id (others render
  // plain). Maps item key → first column index it shows in.
  const morphCol = useMemo(() => {
    const m = new Map<string, number>()
    columns.forEach((col, ci) => col.placed.forEach((p) => !m.has(p.it.key) && m.set(p.it.key, ci)))
    return m
  }, [columns])

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      {/* Column header row — one date per day; today is bold/accented. */}
      <div className="flex shrink-0 items-stretch border-b border-border" style={{ paddingLeft: HOUR_AXIS_W }}>
        {columns.map((col) => {
          const isToday = col.ds === today0
          return (
            <div
              key={`h-${col.ds}`}
              className={cn(
                "flex flex-1 items-center justify-center border-l border-border/40 py-1.5 text-[10px] font-semibold tabular-nums tracking-wide",
                isToday ? "text-foreground" : "text-muted-foreground/60",
              )}
            >
              <span
                className={cn(
                  "rounded px-1.5 py-0.5",
                  isToday && "bg-foreground text-background",
                )}
              >
                {fmtColumn(col.ds)}
              </span>
            </div>
          )
        })}
      </div>

      {/* Grid body — hour axis on the left, then the 7 day columns. */}
      <div className="relative flex flex-1 items-stretch overflow-hidden">
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

        {columns.map((col, ci) => {
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

              {/* Items — time-positioned, overlaps fanned into side-by-side columns.
                  The leftmost column an entity occupies bears the shared-element
                  `layoutId` (matches the Lifelane chip's `m-<key>`) so it flies into
                  place when zoom crosses the threshold; the layout tween only runs
                  during the `morphing` window so it never fights the entry fade. */}
              {col.placed.map(({ it, isInstant, sf, ef, col: cIdx, cols }) => {
                const wPct = 100 / cols
                return (
                  <motion.button
                    key={it.key}
                    layoutId={morphCol.get(it.key) === ci ? `m-${it.key}` : undefined}
                    transition={{ layout: { duration: morphing ? MORPH_S : 0, ease: [0.22, 1, 0.36, 1] } }}
                    type="button"
                    onClick={() => it.entity && onOpen(it.entity.id)}
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
                  </motion.button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
