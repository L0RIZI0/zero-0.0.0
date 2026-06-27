"use client"

import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { packDay, type DayPlaced } from "@/lib/zero/day-pack"
import type { Entity } from "@/lib/zero/types"

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
// A span at/above this duration is treated as "multi-day" and rendered as a tall
// vertical block spanning its day-rows; anything shorter is a single-day item
// that gets stacked inside its day's band as a readable mini-list line.
const MULTI_DAY_MIN_MS = 1.5 * DAY_MS
const MULTI_COL_PX = 16 // width of each multi-day sub-column (left side of a week)

/** One placeable item in the serpentine grid — spans/bands/streams arrive with a
 *  real [from,to] interval; instants arrive with from === to. `dim` is the
 *  pre-computed relatedness opacity (the parent already knows the focus subtree). */
export interface SerpItem {
  key: string
  from: number
  to: number
  color: string
  title: string
  kind: "event" | "space" | "band" | "stream" | "instant"
  dim: number
  entity?: Entity
  cancelled?: boolean
  count?: number
}

/** Local Monday-00:00 of `epoch`'s week, epoch ms (weeks start on Monday). */
function startOfWeek(epoch: number): number {
  const d = new Date(epoch)
  d.setHours(0, 0, 0, 0)
  const dow = (d.getDay() + 6) % 7 // Sun=0 → 6, Mon=1 → 0
  d.setDate(d.getDate() - dow)
  return d.getTime()
}

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"]
const DAY_AXIS_W = 16

type MultiBlock = { it: SerpItem; topF: number; botF: number; lane: number }
type DayItem = { it: SerpItem; isInstant: boolean }
type Column = {
  ws: number
  we: number
  multi: MultiBlock[]
  multiLanes: number
  days: DayPlaced<SerpItem>[][] // length 7, Mon→Sun
}

/**
 * SERPENTINE TIMELINE (MVP) — time wrapped into a row of WEEK COLUMNS flowing
 * left→right (past→future). Within each column time runs VERTICALLY through seven
 * day-rows (Mon top → Sun bottom), so an entity takes a vertical span rather than a
 * horizontal one.
 *
 * Two classes of item coexist so neither gets crushed:
 *  • MULTI-DAY spans (≥ ~1.5 days) → tall vertical blocks on the LEFT of the column,
 *    spanning their day-rows, greedily packed into side-by-side sub-columns. A span
 *    crossing a week boundary re-appears (clipped) in the next column.
 *  • SINGLE-DAY items (intraday events + instants) → bucketed by day and laid out
 *    INSIDE that day's band like a mini day-calendar: positioned vertically by their
 *    real time-of-day, and overlapping items split into side-by-side COLUMNS so they
 *    sit next to each other instead of stacking down and eating the whole day range.
 *
 * Self-contained render path: the linear lifeline is untouched and the parent swaps
 * to this when the toggle is on. Mother ribbons, rollup tuning, clustering and
 * stream fidelity are intentionally deferred.
 */
export function TimelineSerpentine({
  items,
  centerMs,
  weekCount,
  now,
  onOpen,
  onMenu,
}: {
  items: SerpItem[]
  centerMs: number
  weekCount: number
  now: number
  onOpen: (id: string) => void
  onMenu: (e: React.MouseEvent, entity: Entity) => void
}) {
  // Window of weeks centered on the viewport center, so toggling serpentine keeps
  // you looking at roughly the same moment the linear view was framing.
  const firstWeekStart = useMemo(
    () => startOfWeek(centerMs) - Math.floor(weekCount / 2) * WEEK_MS,
    [centerMs, weekCount],
  )

  const columns = useMemo<Column[]>(() => {
    const cols: Column[] = []
    for (let c = 0; c < weekCount; c++) {
      const ws = firstWeekStart + c * WEEK_MS
      const we = ws + WEEK_MS
      const days: DayItem[][] = Array.from({ length: 7 }, () => [])
      const multiRaw: MultiBlock[] = []

      for (const it of items) {
        const isInstant = it.kind === "instant" || it.from === it.to
        if (isInstant) {
          if (it.from < ws || it.from >= we) continue
          const d = Math.min(6, Math.max(0, Math.floor((it.from - ws) / DAY_MS)))
          days[d].push({ it, isInstant: true })
          continue
        }
        // Span/band/stream — must overlap this week.
        if (it.to <= ws || it.from >= we) continue
        const cf = Math.max(it.from, ws)
        const ct = Math.min(it.to, we)
        if (it.to - it.from >= MULTI_DAY_MIN_MS) {
          multiRaw.push({ it, topF: (cf - ws) / WEEK_MS, botF: (ct - ws) / WEEK_MS, lane: 0 })
        } else {
          // Short span living inside a single day band → treat like a day item.
          const d = Math.min(6, Math.max(0, Math.floor((cf - ws) / DAY_MS)))
          days[d].push({ it, isInstant: false })
        }
      }

      // Greedy sub-lane packing for multi-day blocks by vertical-interval overlap.
      const sorted = multiRaw.sort((a, b) => a.topF - b.topF)
      const laneEnds: number[] = []
      for (const p of sorted) {
        let idx = laneEnds.findIndex((e) => e <= p.topF + 0.0001)
        if (idx === -1) {
          idx = laneEnds.length
          laneEnds.push(p.botF)
        } else {
          laneEnds[idx] = p.botF
        }
        p.lane = idx
      }
      // Lay out each day's items as a mini day-calendar (time-positioned + columned).
      const placedDays = days.map((bucket, d) => packDay(bucket, ws + d * DAY_MS))

      cols.push({ ws, we, multi: sorted, multiLanes: Math.max(0, laneEnds.length), days: placedDays })
    }
    return cols
  }, [items, firstWeekStart, weekCount])

  const fmtWeek = (ws: number) =>
    new Date(ws).toLocaleDateString(undefined, { month: "short", day: "numeric" })

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      {/* Week header row — each column's starting date; the current week is bold. */}
      <div className="flex h-5 shrink-0 items-stretch" style={{ paddingLeft: DAY_AXIS_W }}>
        {columns.map((col) => {
          const isThisWeek = now >= col.ws && now < col.we
          return (
            <div
              key={`h-${col.ws}`}
              className={cn(
                "flex flex-1 items-center justify-center border-l border-border/40 text-[9.5px] tabular-nums tracking-tight",
                isThisWeek ? "font-semibold text-foreground" : "font-medium text-muted-foreground/60",
              )}
            >
              {fmtWeek(col.ws)}
            </div>
          )
        })}
      </div>

      {/* Grid body — day-axis letters on the left, then the week columns. */}
      <div className="relative flex flex-1 items-stretch overflow-hidden">
        {/* Day-of-week axis, aligned to each of the 7 row centers. */}
        <div className="relative shrink-0" style={{ width: DAY_AXIS_W }} aria-hidden>
          {DAY_LABELS.map((d, i) => (
            <span
              key={i}
              className="absolute left-0 right-0 -translate-y-1/2 text-center text-[8px] font-medium text-muted-foreground/40"
              style={{ top: `${((i + 0.5) / 7) * 100}%` }}
            >
              {d}
            </span>
          ))}
        </div>

        {columns.map((col) => {
          const isThisWeek = now >= col.ws && now < col.we
          const nowF = isThisWeek ? (now - col.ws) / WEEK_MS : null
          const multiOffset = col.multiLanes * MULTI_COL_PX
          return (
            <div key={`c-${col.ws}`} className="relative flex-1 border-l border-border/40">
              {/* Day-row gridlines (6 internal dividers). */}
              {Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  className="pointer-events-none absolute inset-x-0 h-px bg-border/25"
                  style={{ top: `${((i + 1) / 7) * 100}%` }}
                  aria-hidden
                />
              ))}

              {/* Today line across the current week's column. */}
              {nowF != null && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-20 h-px bg-foreground/70"
                  style={{ top: `${nowF * 100}%` }}
                  aria-hidden
                >
                  <span className="absolute right-0.5 -top-2 text-[7px] font-semibold uppercase tracking-wide text-foreground/70">
                    now
                  </span>
                </div>
              )}

              {/* MULTI-DAY blocks — tall vertical bars in left sub-columns. */}
              {col.multi.map(({ it, topF, botF, lane }) => {
                const heightPct = Math.max((botF - topF) * 100, 3)
                return (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => it.entity && onOpen(it.entity.id)}
                    onContextMenu={(ev) => it.entity && onMenu(ev, it.entity)}
                    title={it.count ? `${it.title} · ${it.count}` : it.title}
                    className={cn(
                      "absolute z-10 flex flex-col overflow-hidden rounded-[3px] border text-left",
                      "shadow-sm transition-[filter] hover:brightness-110",
                      it.kind === "band" && "border-dashed",
                    )}
                    style={{
                      top: `${topF * 100}%`,
                      height: `${heightPct}%`,
                      minHeight: 14,
                      left: lane * MULTI_COL_PX + 1,
                      width: MULTI_COL_PX - 2,
                      borderColor: `${it.color}66`,
                      backgroundColor: `${it.color}2e`,
                      opacity: it.dim,
                    }}
                  >
                    {/* Rotated title so a thin multi-day column stays legible. */}
                    <span
                      className={cn(
                        "absolute left-1/2 top-1 -translate-x-1/2 whitespace-nowrap text-[8px] leading-none tracking-tight text-foreground/85",
                        it.cancelled && "line-through",
                      )}
                      style={{ writingMode: "vertical-rl" }}
                    >
                      {it.title}
                    </span>
                  </button>
                )
              })}

              {/* SINGLE-DAY items — a mini day-calendar inside each day band: items are
                  placed by time-of-day and overlapping ones split into side-by-side
                  columns. Each band is a positioned container so item top/height (% of
                  the band = fraction of the day) and left/width (% = overlap column)
                  resolve against it. */}
              {col.days.map((placed, d) => {
                if (placed.length === 0) return null
                return (
                  <div
                    key={`d-${d}`}
                    className="absolute z-10"
                    style={{
                      top: `${(d / 7) * 100}%`,
                      height: `${(1 / 7) * 100}%`,
                      left: multiOffset + 1,
                      right: 1,
                    }}
                  >
                    {placed.map(({ it, isInstant, sf, ef, col: cIdx, cols }) => {
                      const wPct = 100 / cols
                      return (
                        <button
                          key={it.key}
                          type="button"
                          onClick={() => it.entity && onOpen(it.entity.id)}
                          onContextMenu={(ev) => it.entity && onMenu(ev, it.entity)}
                          title={it.title}
                          className={cn(
                            "absolute flex items-start gap-1 overflow-hidden rounded-[2px] px-1 py-0.5 text-left text-[8.5px] leading-none tracking-tight",
                            "text-foreground/85 transition-[filter] hover:brightness-110",
                            !isInstant && "border",
                          )}
                          style={{
                            top: `${sf * 100}%`,
                            height: isInstant ? undefined : `${(ef - sf) * 100}%`,
                            minHeight: 11,
                            left: `${cIdx * wPct}%`,
                            width: `calc(${wPct}% - 1px)`,
                            borderColor: isInstant ? undefined : `${it.color}55`,
                            backgroundColor: isInstant ? undefined : `${it.color}22`,
                            opacity: it.dim,
                          }}
                        >
                          {isInstant && (
                            <span
                              className="mt-px h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: it.color }}
                              aria-hidden
                            />
                          )}
                          <span className={cn("truncate", it.cancelled && "line-through")}>{it.title}</span>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
