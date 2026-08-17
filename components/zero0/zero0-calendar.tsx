"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getCalendarBars, type CalBar, NEUTRAL, ROOT_SENTINEL_COLOR } from "@/lib/zero/dayline-bars"
import type { DaylineOccRef } from "@/components/zero0/zero0-dayline"
import { NOW_COLOR } from "@/lib/zero/timeline-format"
import { useNowSeconds } from "@/lib/zero/use-now"
import { cn } from "@/lib/utils"

// ============================================================================
// Zero0Calendar (v0.2.313) — the EXPANDED form of the dayline: an Akiflow-style
// multi-day calendar. Whole-DAY columns (count from viewport width) centered on
// the dayline window's center time; each day split PLANNED-left / RECORDED-right;
// overlapping blocks pack into ½/⅓/¼ sub-lanes; a 24h vertical grid with a min
// hour height so short viewports scroll. No zoom (that's the dayline's job).
//
// This renders the SAME ticks as the dayline (via getCalendarBars, identical key
// scheme) so the two can morph into each other. This file owns ONLY the calendar
// layout/packing/rendering + scroll; classification lives in lib/zero/dayline-bars.
// ============================================================================

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
/** Minimum hour row height. 24×20 = 480px content — below the available body height ⇒ vertical scroll. */
const MIN_HOUR_H = 20
/** Comfortable minimum width for a whole day (holds two sub-columns). Fewer, wider days > many cramped. */
const MIN_DAY_W = 150
/** Left gutter width for the hour labels. */
const HOUR_GUTTER_W = 46
/** Top row height for the day-name headers. */
const DAY_HEADER_H = 26
/** Honest minimum block height (like the dayline's no-floor policy, but blocks need a hairline to exist). */
const MIN_BLOCK_H = 3
/** Extra days rendered on EACH side of the visible span, for horizontal scroll headroom. */
const DAY_BUFFER = 7
/** A block must be at least this tall AND wide to hold its label INSIDE; otherwise the label goes to an
 *  external chip in the sibling column with a hairline connector (v0.2.313). */
const LABEL_MIN_H = 22
const LABEL_MIN_W = 40
/** A block this tall can show BOTH its title and its time range inside; shorter shows only the title. */
const LABEL_TIME_H = 40

/** Local midnight (epoch ms) for the day containing `epoch`. */
function startOfDay(epoch: number): number {
  const d = new Date(epoch)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
/** Real next-midnight — handles DST (23/25h days) since it re-reads the clock. */
function nextMidnight(dayStart: number): number {
  const d = new Date(dayStart)
  d.setDate(d.getDate() + 1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** A packed calendar block: a bar clipped to one day+column, with its sub-lane slot. */
interface Block {
  bar: CalBar
  clipStart: number
  clipEnd: number
  lane: number
  laneCount: number
}

/** Greedy interval-graph sub-lane packing: each block takes the lowest lane whose previous block
 *  ended ≤ its start, else a new lane. Returns blocks with `lane`/`laneCount` (= max concurrency). */
function packColumn(bars: { bar: CalBar; clipStart: number; clipEnd: number }[]): Block[] {
  const sorted = [...bars].sort((a, b) => a.clipStart - b.clipStart || a.clipEnd - b.clipEnd)
  const laneEnds: number[] = []
  const placed: Block[] = []
  for (const b of sorted) {
    let lane = laneEnds.findIndex((end) => end <= b.clipStart)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(b.clipEnd)
    } else {
      laneEnds[lane] = b.clipEnd
    }
    placed.push({ bar: b.bar, clipStart: b.clipStart, clipEnd: b.clipEnd, lane, laneCount: 1 })
  }
  const laneCount = Math.max(1, laneEnds.length)
  for (const p of placed) p.laneCount = laneCount
  return placed
}

/** External-label chip height. */
const CHIP_H = 16

/** A block positioned in DAY-LOCAL coords (x=0 at the day's left edge), with whether its label fits inside. */
interface PlacedBlock {
  bar: CalBar
  bx: number
  by: number
  bw: number
  bh: number
  internal: boolean
}
/** An external label chip (day-local) for a block too small to hold its label inside, plus the SVG path
 *  of the hairline connector from the block edge to the chip. */
interface LabelChip {
  bar: CalBar
  lx: number
  ly: number
  lw: number
  lh: number
  path: string
}

/** Lay out ONE day: turn packed planned/recorded blocks into day-local block rects, decide which can
 *  hold their label inside, and for the rest place an external chip in the SIBLING column (planned→
 *  recorded, recorded→planned) at a free vertical slot near the block, with a curved hairline connector
 *  (v0.2.313 — the "label on the other column" behavior). Coords are day-local so the caller only offsets
 *  by the day's x. */
function layoutDay(
  plannedBlocks: Block[],
  recordedBlocks: Block[],
  dayStart: number,
  colW: number,
  contentH: number,
): { blocks: PlacedBlock[]; chips: LabelChip[] } {
  const build = (blocks: Block[], halfX: number): PlacedBlock[] =>
    blocks.map((b) => {
      const by = ((b.clipStart - dayStart) / DAY_MS) * contentH
      const bh = Math.max(MIN_BLOCK_H, ((b.clipEnd - b.clipStart) / DAY_MS) * contentH)
      const subW = colW / b.laneCount
      const bw = Math.max(1, subW - 1)
      const bx = halfX + b.lane * subW + 0.5
      const internal = bh >= LABEL_MIN_H && bw >= LABEL_MIN_W
      return { bar: b.bar, bx, by, bw, bh, internal }
    })
  const plannedR = build(plannedBlocks, 0)
  const recordedR = build(recordedBlocks, colW)

  // Occupancy (y-intervals) per half, seeded with that half's blocks; chips accrete so they don't stack.
  const occ = { planned: [] as [number, number][], recorded: [] as [number, number][] }
  for (const r of plannedR) occ.planned.push([r.by, r.by + r.bh])
  for (const r of recordedR) occ.recorded.push([r.by, r.by + r.bh])
  const overlaps = (list: [number, number][], top: number, bot: number) =>
    list.some(([t, b]) => top < b && bot > t)

  const chips: LabelChip[] = []
  const place = (r: PlacedBlock, from: "planned" | "recorded") => {
    const to = from === "planned" ? "recorded" : "planned"
    const toX = to === "planned" ? 0 : colW
    const lw = Math.max(24, colW - 3)
    const lh = CHIP_H
    const desired = Math.min(Math.max(r.by + r.bh / 2 - lh / 2, 0), Math.max(0, contentH - lh))
    let ly = desired
    for (let step = 0; step <= contentH; step += 3) {
      const cands = step === 0 ? [desired] : [desired + step, desired - step]
      let hit = false
      for (const cand of cands) {
        if (cand < 0 || cand + lh > contentH) continue
        if (!overlaps(occ[to], cand, cand + lh)) {
          ly = cand
          hit = true
          break
        }
      }
      if (hit) break
    }
    occ[to].push([ly, ly + lh])
    const lx = toX + 1.5
    // Connector: from the block's INNER edge (planned→right edge, recorded→left edge) to the chip's
    // near edge, as a horizontal-tangent cubic so it curves smoothly when the chip is offset vertically.
    const ay = r.by + r.bh / 2
    const ax = from === "planned" ? r.bx + r.bw : r.bx
    const cy = ly + lh / 2
    const cx = to === "planned" ? lx + lw : lx
    const dx = (cx - ax) / 2
    const path = `M ${ax.toFixed(1)} ${ay.toFixed(1)} C ${(ax + dx).toFixed(1)} ${ay.toFixed(1)}, ${(cx - dx).toFixed(1)} ${cy.toFixed(1)}, ${cx.toFixed(1)} ${cy.toFixed(1)}`
    chips.push({ bar: r.bar, lx, ly, lw, lh, path })
  }
  for (const r of plannedR) if (!r.internal) place(r, "planned")
  for (const r of recordedR) if (!r.internal) place(r, "recorded")

  return { blocks: [...plannedR, ...recordedR], chips }
}

/** A readable text ink for a solid accent fill. oklch strings expose lightness directly as the first
 *  number (0..1); a hex fallback uses relative luminance. Light fills ⇒ dark ink, dark fills ⇒ light. */
function readableInk(color: string): string {
  const dark = "oklch(0.22 0 0)"
  const light = "oklch(0.98 0 0)"
  const ok = color.match(/oklch\(\s*([\d.]+)/i)
  if (ok) return Number.parseFloat(ok[1]) > 0.62 ? dark : light
  const hex = color.match(/^#?([0-9a-f]{6})$/i)
  if (hex) {
    const n = Number.parseInt(hex[1], 16)
    const r = (n >> 16) & 255,
      g = (n >> 8) & 255,
      b = n & 255
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return lum > 0.6 ? dark : light
  }
  return dark
}

/** Resolve a bar's fill/border/ink for a block. Mirrors the dayline: the colorless root maps to a
 *  theme-background chip with a grey hairline; everything else uses its accent fill. */
function blockColors(bar: CalBar): { background: string; border: string; ink: string; isRoot: boolean } {
  if (bar.color === ROOT_SENTINEL_COLOR) {
    return { background: "var(--background)", border: NEUTRAL, ink: "var(--foreground)", isRoot: true }
  }
  const background = bar.sky ?? bar.color
  return { background, border: bar.stroke ?? bar.color, ink: readableInk(background), isRoot: false }
}

export function Zero0Calendar({
  centerTime,
  height,
  onOpen,
  onEmptyClick,
  onContextMenuEntity,
  onOccurrenceMenu,
  onSessionMenu,
  dataRev,
  highlightId = null,
}: {
  /** The dayline window's center time — the calendar centers its visible days on THIS day. */
  centerTime: number
  /** Pixel height the calendar should occupy (the Agenda animates this during the morph). */
  height: number
  onOpen: (id: string) => void
  /** Click on empty calendar area → collapse back to the dayline. */
  onEmptyClick?: () => void
  onContextMenuEntity?: (id: string, ev: React.MouseEvent) => void
  onOccurrenceMenu?: (entityId: string, occ: NonNullable<DaylineOccRef>, ev: React.MouseEvent) => void
  onSessionMenu?: (entityId: string, anchorId: number, ev: React.MouseEvent) => void
  dataRev: number
  highlightId?: string | null
}) {
  const now = useNowSeconds()
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const dayHeaderInnerRef = useRef<HTMLDivElement | null>(null)
  const hourGutterInnerRef = useRef<HTMLDivElement | null>(null)
  const [frameW, setFrameW] = useState(0)

  // Measure the frame width to choose how many day columns fit comfortably.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setFrameW(w)
    })
    ro.observe(el)
    setFrameW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const bodyH = Math.max(0, height - DAY_HEADER_H)
  // hourH grows to fit 24h in the body when there's room; floors at MIN_HOUR_H (⇒ vertical scroll).
  const hourH = Math.max(MIN_HOUR_H, Math.floor(bodyH / 24))
  const contentH = 24 * hourH
  const needsVScroll = contentH > bodyH + 0.5

  // Day columns. `visibleDays` fit in the frame; render a buffer each side for horizontal scroll.
  const dayColW = Math.max(MIN_DAY_W, frameW > 0 ? frameW / Math.max(1, Math.floor(frameW / MIN_DAY_W)) : MIN_DAY_W)
  const visibleDays = Math.max(1, Math.floor((frameW || MIN_DAY_W) / MIN_DAY_W))
  const centerDay = startOfDay(centerTime)
  // Left-most rendered day = centerDay shifted left by half the visible span + the buffer.
  const firstDay = useMemo(() => {
    let d = centerDay
    const back = Math.floor(visibleDays / 2) + DAY_BUFFER
    for (let i = 0; i < back; i++) d = startOfDay(d - HOUR_MS * 6) // step safely back one day (DST-safe)
    return d
  }, [centerDay, visibleDays])
  const totalDays = visibleDays + 2 * DAY_BUFFER
  const days = useMemo(() => {
    const out: { start: number; end: number }[] = []
    let d = firstDay
    for (let i = 0; i < totalDays; i++) {
      const end = nextMidnight(d)
      out.push({ start: d, end })
      d = end
    }
    return out
  }, [firstDay, totalDays])

  const rangeLo = days[0]?.start ?? centerDay
  const rangeHi = days[days.length - 1]?.end ?? centerDay + DAY_MS

  // Build the shared bars, then pack per day per column.
  const { planned, recorded } = useMemo(
    () => getCalendarBars(rangeLo, rangeHi, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangeLo, rangeHi, now, dataRev],
  )

  /** For a track's bars, clip to the day and pack. */
  const packForDay = useCallback((bars: CalBar[], dayStart: number, dayEnd: number): Block[] => {
    const clipped: { bar: CalBar; clipStart: number; clipEnd: number }[] = []
    for (const bar of bars) {
      const s = bar.startMs ?? bar.endMs
      const e = bar.endMs
      if (e <= dayStart || s >= dayEnd) continue
      clipped.push({ bar, clipStart: Math.max(s, dayStart), clipEnd: Math.min(e, dayEnd) })
    }
    return packColumn(clipped)
  }, [])

  // Center the initial scroll: horizontally on centerDay, vertically on now (when scrolling).
  const didInit = useRef(false)
  useEffect(() => {
    const body = bodyRef.current
    if (!body || frameW === 0 || didInit.current) return
    didInit.current = true
    const centerIdx = days.findIndex((d) => d.start === centerDay)
    if (centerIdx >= 0) {
      const target = centerIdx * dayColW - (frameW - dayColW) / 2
      body.scrollLeft = Math.max(0, target)
    }
    if (needsVScroll) {
      const nowY = ((now - startOfDay(now)) / DAY_MS) * contentH
      body.scrollTop = Math.max(0, nowY - bodyH / 2)
    }
  }, [frameW, days, centerDay, dayColW, needsVScroll, now, contentH, bodyH])

  // Sync sticky header/gutter to the body scroll via transforms (robust cross-axis sticky).
  const onBodyScroll = useCallback(() => {
    const body = bodyRef.current
    if (!body) return
    if (dayHeaderInnerRef.current) dayHeaderInnerRef.current.style.transform = `translateX(${-body.scrollLeft}px)`
    if (hourGutterInnerRef.current) hourGutterInnerRef.current.style.transform = `translateY(${-body.scrollTop}px)`
  }, [])

  // When vertical content fits, redirect vertical wheel to horizontal day scroll (plan behavior).
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const body = bodyRef.current
      if (!body) return
      if (!needsVScroll && e.deltaY !== 0 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        body.scrollLeft += e.deltaY
      }
    },
    [needsVScroll],
  )

  const todayStart = startOfDay(now)
  const totalW = totalDays * dayColW
  const hours = Array.from({ length: 24 }, (_, h) => h)

  return (
    <div
      className="relative flex select-none flex-col overflow-hidden bg-background"
      style={{ height }}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("[data-calblock]")) onEmptyClick?.()
      }}
    >
      {/* DAY HEADER ROW (sticky top, synced to horizontal scroll) */}
      <div className="flex shrink-0 border-b border-border" style={{ height: DAY_HEADER_H }}>
        <div className="shrink-0 border-r border-border" style={{ width: HOUR_GUTTER_W }} />
        <div className="relative flex-1 overflow-hidden">
          <div ref={dayHeaderInnerRef} className="absolute inset-y-0 left-0 flex" style={{ width: totalW }}>
            {days.map((d) => {
              const isToday = d.start === todayStart
              return (
                <div
                  key={d.start}
                  className={cn(
                    "flex items-center gap-1.5 border-r border-border px-2 text-[11px] uppercase tracking-wider",
                    isToday ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                  style={{ width: dayColW }}
                >
                  <span className="tabular-nums">{new Date(d.start).toLocaleDateString([], { weekday: "short" })}</span>
                  <span className="tabular-nums">{new Date(d.start).getDate()}</span>
                  {isToday && <span className="h-1 w-1 rounded-full" style={{ backgroundColor: NOW_COLOR }} />}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* BODY: hour gutter (sticky left) + scrollable grid */}
      <div className="flex min-h-0 flex-1">
        {/* HOUR GUTTER (synced to vertical scroll) */}
        <div className="relative shrink-0 overflow-hidden border-r border-border" style={{ width: HOUR_GUTTER_W }}>
          <div ref={hourGutterInnerRef} className="absolute inset-x-0 top-0" style={{ height: contentH }}>
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: h * hourH }}
              >
                {h === 0 ? "" : `${h.toString().padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
        </div>

        {/* SCROLL BODY (both axes) */}
        <div
          ref={bodyRef}
          className={cn("relative min-w-0 flex-1", needsVScroll ? "overflow-auto" : "overflow-x-auto overflow-y-hidden")}
          onScroll={onBodyScroll}
          onWheel={onWheel}
        >
          <div className="relative" style={{ width: totalW, height: contentH }}>
            {/* Hour gridlines */}
            {hours.map((h) => (
              <div
                key={h}
                className="pointer-events-none absolute inset-x-0 border-t border-border/40"
                style={{ top: h * hourH }}
              />
            ))}

            {/* Day columns: dividers + the two-column split + packed blocks + external labels */}
            {days.map((d, di) => {
              const x = di * dayColW
              const colW = dayColW / 2
              const plannedBlocks = packForDay(planned, d.start, d.end)
              const recordedBlocks = packForDay(recorded, d.start, d.end)
              const { blocks, chips } = layoutDay(plannedBlocks, recordedBlocks, d.start, colW, contentH)
              const ctxMenu = (bar: CalBar, e: React.MouseEvent) => {
                if (bar.occRef && onOccurrenceMenu) onOccurrenceMenu(bar.id, bar.occRef, e)
                else if (bar.sessionAnchorId != null && onSessionMenu) onSessionMenu(bar.id, bar.sessionAnchorId, e)
                else onContextMenuEntity?.(bar.id, e)
              }
              return (
                // Day wrapper — positioned at the day's x so blocks/chips/connectors use DAY-LOCAL coords.
                <div key={d.start} className="absolute top-0" style={{ left: x, width: dayColW, height: contentH }}>
                  {/* day divider (left edge) + mid divider between the two columns */}
                  <div className="pointer-events-none absolute inset-y-0 left-0 border-l border-border" />
                  <div className="pointer-events-none absolute inset-y-0 border-l border-border/30" style={{ left: colW }} />

                  {/* Connector hairlines (behind blocks + chips) */}
                  {chips.length > 0 && (
                    <svg
                      className="pointer-events-none absolute inset-0 overflow-visible"
                      width={dayColW}
                      height={contentH}
                      aria-hidden
                    >
                      {chips.map((c, i) => (
                        <path
                          key={i}
                          d={c.path}
                          fill="none"
                          stroke="var(--muted-foreground)"
                          strokeOpacity={0.45}
                          strokeWidth={1}
                        />
                      ))}
                    </svg>
                  )}

                  {/* Blocks */}
                  {blocks.map((r, i) => {
                    const { background, border, ink, isRoot } = blockColors(r.bar)
                    const dim = highlightId != null && highlightId !== r.bar.id
                    const showTime = r.bh >= LABEL_TIME_H
                    return (
                      <button
                        key={r.bar.key + ":" + i}
                        type="button"
                        data-calblock
                        data-calkey={r.bar.key}
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpen(r.bar.id)
                        }}
                        onContextMenu={(e) => ctxMenu(r.bar, e)}
                        className={cn(
                          "absolute overflow-hidden rounded-[3px] text-left transition-opacity",
                          isRoot ? "border" : "border border-black/10",
                          dim && "opacity-40",
                        )}
                        style={{ left: r.bx, top: r.by, width: r.bw, height: r.bh, background, borderColor: border }}
                        title={`${r.bar.title} · ${r.bar.range}`}
                      >
                        {r.internal && (
                          <span
                            className="flex h-full flex-col gap-0.5 px-1 py-0.5 leading-tight"
                            style={{ color: ink }}
                          >
                            <span className="truncate text-[10px] font-medium">{r.bar.title}</span>
                            {showTime && (
                              <span className="truncate text-[9px] tabular-nums opacity-70">{r.bar.range}</span>
                            )}
                          </span>
                        )}
                      </button>
                    )
                  })}

                  {/* External label chips (for blocks too small to hold their label inside) */}
                  {chips.map((c, i) => {
                    const dim = highlightId != null && highlightId !== c.bar.id
                    const dot = c.bar.color === ROOT_SENTINEL_COLOR ? NEUTRAL : (c.bar.sky ?? c.bar.color)
                    return (
                      <button
                        key={c.bar.key + ":lbl:" + i}
                        type="button"
                        data-calblock
                        data-calkey={c.bar.key}
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpen(c.bar.id)
                        }}
                        onContextMenu={(e) => ctxMenu(c.bar, e)}
                        className={cn(
                          "absolute flex items-center gap-1 overflow-hidden rounded-[3px] border border-border bg-background px-1 text-left transition-opacity",
                          dim && "opacity-40",
                        )}
                        style={{ left: c.lx, top: c.ly, width: c.lw, height: c.lh }}
                        title={`${c.bar.title} · ${c.bar.range}`}
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} />
                        <span className="truncate text-[10px] text-foreground">{c.bar.title}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })}

            {/* NOW line (only across today's column) */}
            {now >= rangeLo &&
              now < rangeHi &&
              (() => {
                const di = days.findIndex((d) => now >= d.start && now < d.end)
                if (di < 0) return null
                const x = di * dayColW
                const y = ((now - todayStart) / DAY_MS) * contentH
                return (
                  <div
                    className="pointer-events-none absolute z-10"
                    style={{ left: x, top: y, width: dayColW, height: 1, backgroundColor: NOW_COLOR }}
                  >
                    <div
                      className="absolute -left-0.5 -top-1 h-0 w-0"
                      style={{
                        borderTop: "4px solid transparent",
                        borderBottom: "4px solid transparent",
                        borderLeft: `5px solid ${NOW_COLOR}`,
                      }}
                    />
                  </div>
                )
              })()}
          </div>
        </div>
      </div>
    </div>
  )
}
