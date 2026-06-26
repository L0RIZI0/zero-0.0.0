"use client"

import { useMemo } from "react"
import { cn } from "@/lib/utils"
import type { Entity } from "@/lib/zero/types"

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

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

/**
 * SERPENTINE TIMELINE (MVP) — time wrapped into a row of WEEK COLUMNS flowing
 * left→right (past→future). Within each column time runs VERTICALLY through seven
 * day-rows (Mon top → Sun bottom), so an entity takes a vertical span rather than a
 * horizontal one. Multi-day spans become tall blocks; a span crossing a week
 * boundary simply re-appears (clipped) in the next column. Instants are dots in
 * their day-row. Overlapping items in a column pack into side-by-side sub-columns.
 *
 * This is a SELF-CONTAINED render path: the linear lifeline is untouched and the
 * parent swaps to this when the serpentine toggle is on. Mother ribbons, semantic
 * rollup tuning, clustering and stream fidelity are intentionally deferred.
 */
export function TimelineSerpentine({
  items,
  centerMs,
  weekCount,
  now,
  height,
  onOpen,
  onMenu,
}: {
  items: SerpItem[]
  centerMs: number
  weekCount: number
  now: number
  height: number
  onOpen: (id: string) => void
  onMenu: (e: React.MouseEvent, entity: Entity) => void
}) {
  // Window of weeks centered on the viewport center, so toggling serpentine keeps
  // you looking at roughly the same moment the linear view was framing.
  const firstWeekStart = useMemo(
    () => startOfWeek(centerMs) - Math.floor(weekCount / 2) * WEEK_MS,
    [centerMs, weekCount],
  )

  const columns = useMemo(() => {
    const cols: {
      ws: number
      we: number
      placed: { it: SerpItem; isInstant: boolean; topF: number; botF: number; lane: number }[]
      laneCount: number
    }[] = []
    for (let c = 0; c < weekCount; c++) {
      const ws = firstWeekStart + c * WEEK_MS
      const we = ws + WEEK_MS
      // Items overlapping this week. Instants only when their moment falls inside.
      const inWeek = items.filter((it) => {
        if (it.kind === "instant" || it.from === it.to) return it.from >= ws && it.from < we
        return it.to > ws && it.from < we
      })
      // Vertical fractions within the week (0 = Mon 00:00, 1 = next Mon 00:00).
      const placed = inWeek.map((it) => {
        const isInstant = it.kind === "instant" || it.from === it.to
        const cf = Math.max(it.from, ws)
        const ct = Math.min(it.to, we)
        const topF = (cf - ws) / WEEK_MS
        const botF = isInstant ? topF : (ct - ws) / WEEK_MS
        return { it, isInstant, topF, botF, lane: 0 }
      })
      // Greedy sub-lane packing by vertical-interval overlap (a thin min footprint
      // so two items at nearly the same time still split into separate sub-columns).
      const sorted = [...placed].sort((a, b) => a.topF - b.topF)
      const laneEnds: number[] = []
      for (const p of sorted) {
        const startF = p.topF
        const endF = Math.max(p.botF, p.topF + 0.014)
        let idx = laneEnds.findIndex((e) => e <= startF)
        if (idx === -1) {
          idx = laneEnds.length
          laneEnds.push(endF)
        } else {
          laneEnds[idx] = endF
        }
        p.lane = idx
      }
      cols.push({ ws, we, placed, laneCount: Math.max(1, laneEnds.length) })
    }
    return cols
  }, [items, firstWeekStart, weekCount])

  const fmtWeek = (ws: number) =>
    new Date(ws).toLocaleDateString(undefined, { month: "short", day: "numeric" })

  return (
    <div className="absolute inset-0 flex flex-col bg-background" style={{ height }}>
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
          const laneW = 100 / col.laneCount
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

              {/* Placed items. */}
              {col.placed.map(({ it, isInstant, topF, botF, lane }) => {
                const left = lane * laneW
                if (isInstant) {
                  return (
                    <button
                      key={it.key}
                      type="button"
                      onClick={() => it.entity && onOpen(it.entity.id)}
                      onContextMenu={(ev) => it.entity && onMenu(ev, it.entity)}
                      title={it.title}
                      className="absolute z-10 flex -translate-y-1/2 items-center gap-1 rounded px-1 text-[8.5px] leading-none tracking-tight text-foreground/80 transition-[filter] hover:brightness-110"
                      style={{ top: `${topF * 100}%`, left: `${left}%`, width: `${laneW}%`, opacity: it.dim }}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: it.color }}
                        aria-hidden
                      />
                      <span className={cn("truncate", it.cancelled && "line-through")}>{it.title}</span>
                    </button>
                  )
                }
                const heightPct = Math.max((botF - topF) * 100, 2.2)
                return (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => it.entity && onOpen(it.entity.id)}
                    onContextMenu={(ev) => it.entity && onMenu(ev, it.entity)}
                    title={it.count ? `${it.title} · ${it.count}` : it.title}
                    className={cn(
                      "absolute z-10 flex flex-col overflow-hidden rounded-[3px] border px-1 py-0.5 text-left text-[8.5px] leading-tight tracking-tight",
                      "text-foreground/85 shadow-sm transition-[filter] hover:brightness-110",
                      it.kind === "band" && "border-dashed",
                    )}
                    style={{
                      top: `${topF * 100}%`,
                      height: `${heightPct}%`,
                      minHeight: 12,
                      left: `calc(${left}% + 1px)`,
                      width: `calc(${laneW}% - 2px)`,
                      borderColor: `${it.color}59`,
                      backgroundColor: `${it.color}26`,
                      opacity: it.dim,
                    }}
                  >
                    <span className="flex items-center gap-1">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: it.color }}
                        aria-hidden
                      />
                      <span className={cn("truncate", it.cancelled && "line-through")}>{it.title}</span>
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
