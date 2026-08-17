"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getCalendarBars, type CalBar, NEUTRAL, ROOT_SENTINEL_COLOR } from "@/lib/zero/dayline-bars"
import type { DaylineOccRef } from "@/components/zero0/zero0-dayline"
import { Zero0Glyph } from "@/components/zero0/zero0-glyph"
import { getEntity } from "@/lib/zero/data"
import { getFaceModel } from "@/lib/zero/face-model"
import { NOW_COLOR, rangeText } from "@/lib/zero/timeline-format"
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
const MIN_MS = 60_000
/** Snap dragged edges to the minute; enforce a 1-minute floor so a resize can't invert the span. */
const roundToMinute = (t: number) => Math.round(t / MIN_MS) * MIN_MS
const MIN_OCC_MS = MIN_MS
/** A block must be at least this tall to expose its top/bottom resize handles (otherwise the two 6px
 *  grab zones would overlap and there'd be no body left to click-open). */
const RESIZE_MIN_H = 18
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
/** Vertical fade length (px) for an UNCLEAR start/end, the calendar mirror of the dayline's edge fades
 *  (v0.2.316). A FIXED pixel length (not a time %) because the calendar has NO zoom — so a constant
 *  qualitative "continues / began before" blend at any hour scale. Bottom fade = unknown END, top fade =
 *  unknown START. */
const CAL_FADE_PX = 14
/** An unknown-START block has no real start, so it carries no height of its own; give it this fixed
 *  upward lead-in from its end anchor purely to host the top fade (mirror of the dayline's START_FADE_PX
 *  lead-in tail). */
const CAL_UNKNOWN_START_H = 18
/** Compact human duration for the in-block time line, e.g. `45m`, `2h`, `4h 30m`. Only shown when the
 *  block is roomy enough (see the render's width gate). */
function fmtDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
/** A block this tall can show BOTH its title and its time range inside; shorter shows only the title. */
const LABEL_TIME_H = 40
/** Blocks shorter than this get NO persistent label at all (neither inside nor as an external chip) —
 *  their info shows only on hover via the native tooltip (v0.2.314, Loris ask). EXCEPTIONS: Instants
 *  (zero-duration markers) and ONGOING blocks always keep a label regardless of duration. */
const LABEL_MIN_DURATION_MS = 5 * 60_000

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
  /** Whether this block gets a PERSISTENT label at all. Sub-5min blocks (except Instants/ongoing) are
   *  label-free — hover the block for its tooltip instead (v0.2.314). */
  labeled: boolean
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
  /** Live resize preview (v0.2.315): while dragging a block's edge, the matching block uses these
   *  absolute start/end (clamped to this day) so it grows/shrinks under the cursor before commit. */
  preview?: { key: string; start: number; end: number } | null,
): { blocks: PlacedBlock[]; chips: LabelChip[] } {
  const dayEnd = dayStart + DAY_MS
  const build = (blocks: Block[], halfX: number): PlacedBlock[] =>
    blocks.map((b) => {
      // Apply the live resize preview to the dragged block (clamped to this day's window).
      const cs = preview && preview.key === b.bar.key ? Math.max(dayStart, Math.min(preview.start, dayEnd)) : b.clipStart
      const ce = preview && preview.key === b.bar.key ? Math.max(dayStart, Math.min(preview.end, dayEnd)) : b.clipEnd
      // An UNKNOWN-START bar has no real start (start === end === its end anchor) so it has no natural
      // height — give it a fixed upward lead-in from the anchor purely to host the top fade (v0.2.316),
      // the vertical mirror of the dayline's leftward START_FADE_PX tail.
      const unknownStart = !!b.bar.unknownStart && b.bar.startMs == null
      const anchorY = ((ce - dayStart) / DAY_MS) * contentH
      const by = unknownStart ? Math.max(0, anchorY - CAL_UNKNOWN_START_H) : ((cs - dayStart) / DAY_MS) * contentH
      const bh = unknownStart ? CAL_UNKNOWN_START_H : Math.max(MIN_BLOCK_H, ((ce - cs) / DAY_MS) * contentH)
      const subW = colW / b.laneCount
      const bw = Math.max(1, subW - 1)
      const bx = halfX + b.lane * subW + 0.5
      // Duration from the bar's absolute span (NOT the clipped/floored height) so a block split across
      // days is still judged by its true length. Instants + ongoing blocks always keep a label.
      const durMs = b.bar.startMs != null ? b.bar.endMs - b.bar.startMs : 0
      const labeled = !!b.bar.instant || !!b.bar.ongoing || durMs >= LABEL_MIN_DURATION_MS
      const internal = labeled && bh >= LABEL_MIN_H && bw >= LABEL_MIN_W
      return { bar: b.bar, bx, by, bw, bh, internal, labeled }
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
  for (const r of plannedR) if (r.labeled && !r.internal) place(r, "planned")
  for (const r of recordedR) if (r.labeled && !r.internal) place(r, "recorded")

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
  onOccurrenceRetime,
  onSessionRetime,
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
  /** Drag a PLANNED block's top/bottom edge → commit its new start/end (mirror of the dayline's
   *  edge-drag retime, but VERTICAL). Absent ⇒ planned blocks are not resizable. */
  onOccurrenceRetime?: (entityId: string, occ: NonNullable<DaylineOccRef>, start: number, end: number) => void
  /** Bottom-rail mirror: drag a RECORDED block's top/bottom edge → commit its new session span. */
  onSessionRetime?: (entityId: string, anchorId: number, start: number, end: number) => void
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

  /** The presentation glyph descriptor for a block's entity (kind + state), shared with the content
   *  rows via `getFaceModel` — so a block shows the SAME glyph the entity shows everywhere else. */
  const glyphFor = useCallback((id: string) => {
    const e = getEntity(id)
    return e ? getFaceModel(e, now) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, dataRev])

  // ── BLOCK EDGE-RESIZE (v0.2.315) — the calendar mirror of the dayline's edge-drag retime, but
  // VERTICAL: drag a block's TOP handle to move its start, its BOTTOM handle to move its end (the
  // other edge stays put). px→ms uses `contentH` (one whole day spans contentH px), captured at grab
  // like the dayline captures its lane width. `calEditRef` holds the live span; `editPreview` mirrors
  // it into the render so the block resizes under the cursor before commit; `editDraggedRef` gates the
  // click-to-open that would otherwise fire on release. Routes planned → onOccurrenceRetime, recorded
  // → onSessionRetime, exactly like the dayline.
  const calEditRef = useRef<{
    edge: "start" | "end"
    key: string
    entityId: string
    occRef?: NonNullable<DaylineOccRef>
    sessionAnchorId?: number
    origStart: number
    origEnd: number
    startY: number
    contentH: number
    curStart: number
    curEnd: number
  } | null>(null)
  const [editPreview, setEditPreview] = useState<{ key: string; start: number; end: number } | null>(null)
  const editDraggedRef = useRef(false)

  const beginResize = useCallback(
    (edge: "start" | "end", bar: CalBar) => (e: React.PointerEvent) => {
      const isOcc = bar.track === "planned" && !!bar.occRef && !!onOccurrenceRetime
      const isSession = bar.track === "recorded" && bar.sessionAnchorId != null && !!onSessionRetime
      if (e.button !== 0 || (!isOcc && !isSession) || bar.startMs == null || bar.endMs == null) return
      e.stopPropagation()
      calEditRef.current = {
        edge,
        key: bar.key,
        entityId: bar.id,
        occRef: isOcc ? bar.occRef : undefined,
        sessionAnchorId: isSession ? bar.sessionAnchorId : undefined,
        origStart: bar.startMs,
        origEnd: bar.endMs,
        startY: e.clientY,
        contentH,
        curStart: bar.startMs,
        curEnd: bar.endMs,
      }
      editDraggedRef.current = false
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [onOccurrenceRetime, onSessionRetime, contentH],
  )
  const moveResize = useCallback((e: React.PointerEvent) => {
    const d = calEditRef.current
    if (!d) return
    e.stopPropagation()
    const dy = e.clientY - d.startY
    if (Math.abs(dy) > 2) editDraggedRef.current = true
    const deltaMs = (dy / d.contentH) * DAY_MS
    let start = d.origStart
    let end = d.origEnd
    if (d.edge === "start") start = Math.min(roundToMinute(d.origStart + deltaMs), d.origEnd - MIN_OCC_MS)
    else end = Math.max(roundToMinute(d.origEnd + deltaMs), d.origStart + MIN_OCC_MS)
    d.curStart = start
    d.curEnd = end
    setEditPreview({ key: d.key, start, end })
  }, [])
  const endResize = useCallback(
    (e: React.PointerEvent) => {
      const d = calEditRef.current
      calEditRef.current = null
      if (!d) return
      e.stopPropagation()
      const el = e.currentTarget as HTMLElement
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (editDraggedRef.current && (d.curStart !== d.origStart || d.curEnd !== d.origEnd)) {
        if (d.sessionAnchorId != null) onSessionRetime?.(d.entityId, d.sessionAnchorId, d.curStart, d.curEnd)
        else if (d.occRef) onOccurrenceRetime?.(d.entityId, d.occRef, d.curStart, d.curEnd)
      }
      setEditPreview(null)
      requestAnimationFrame(() => {
        editDraggedRef.current = false
      })
    },
    [onOccurrenceRetime, onSessionRetime],
  )

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
              const { blocks, chips } = layoutDay(plannedBlocks, recordedBlocks, d.start, colW, contentH, editPreview)
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
                    const g = glyphFor(r.bar.id)
                    // Resizable ⇒ the block has a retime writer for its rail (planned occ / recorded session).
                    const resizable =
                      (r.bar.track === "planned" && !!r.bar.occRef && !!onOccurrenceRetime) ||
                      (r.bar.track === "recorded" && r.bar.sessionAnchorId != null && !!onSessionRetime)
                    const showHandles = resizable && r.bh >= RESIZE_MIN_H
                    // While THIS block is being resized, recompute its range text live from the preview
                    // span so the in-block label + tooltip track the drag in real time (v0.2.315). The
                    // preview holds the whole-occurrence span (not day-clipped), so a multi-day block
                    // still reads its true new start/end as `start – end`.
                    const previewing = editPreview?.key === r.bar.key
                    const liveRange = previewing ? rangeText(editPreview!.start, editPreview!.end) : r.bar.range
                    // Unclear-edge FADES (v0.2.316): fade the block body to transparent off the BOTTOM for
                    // an unknown/open end (ongoing), off the TOP for an unknown start — the vertical mirror
                    // of the dayline's edge fades. Points and instants (single moments) never fade.
                    const fadeEnd = (!!r.bar.unknownEnd || !!r.bar.openEnded) && !r.bar.point && !r.bar.instant
                    const fadeStart = !!r.bar.unknownStart && !r.bar.point && !r.bar.instant
                    const endSolidPct = Math.max(0, ((r.bh - CAL_FADE_PX) / r.bh) * 100)
                    const fadeMask = fadeEnd
                      ? `linear-gradient(to bottom, #000 ${endSolidPct}%, transparent 100%)`
                      : fadeStart
                        ? `linear-gradient(to bottom, transparent 0, #000 ${CAL_FADE_PX}px)`
                        : undefined
                    // Live duration shown after the range when the block is roomy AND the span is concrete
                    // (skip open/unclear edges — there's no fixed length to show).
                    const durStart = previewing ? editPreview!.start : (r.bar.startMs ?? r.bar.endMs)
                    const durEnd = previewing ? editPreview!.end : r.bar.endMs
                    const durMs = durEnd - durStart
                    const showDuration = (showTime || previewing) && r.bw >= 84 && !fadeEnd && !fadeStart && durMs >= 60_000
                    return (
                      <button
                        key={r.bar.key + ":" + i}
                        type="button"
                        data-calblock
                        data-calkey={r.bar.key}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (editDraggedRef.current) return // swallow the click that ends a resize drag
                          onOpen(r.bar.id)
                        }}
                        onContextMenu={(e) => ctxMenu(r.bar, e)}
                        className={cn(
                          "absolute overflow-hidden rounded-[3px] text-left transition-opacity",
                          dim && "opacity-40",
                        )}
                        style={{ left: r.bx, top: r.by, width: r.bw, height: r.bh }}
                        title={`${r.bar.title} · ${liveRange}`}
                      >
                        {/* FILL LAYER (v0.2.316) — carries the accent fill, hairline border AND the
                            unclear-edge fade mask, so the label above stays fully crisp while the block
                            body fades to transparent at an unknown start/end (mirror of the dayline). */}
                        <span
                          aria-hidden
                          className={cn("absolute inset-0 rounded-[3px]", isRoot ? "border" : "border border-black/10")}
                          style={{ background, borderColor: border, maskImage: fadeMask, WebkitMaskImage: fadeMask }}
                        />
                        {r.internal && (
                          <span
                            className="relative flex h-full flex-col gap-0.5 px-1 py-0.5 leading-tight"
                            style={{ color: ink }}
                          >
                            {/* Glyph (the entity's own kind/state mark, e.g. a scheduled Space's thick
                                hexagon outline) sits left of the WRAPPING title (v0.2.315). It inherits
                                `ink` via currentColor so it reads on the accent fill. `mt-[1px]` aligns it
                                to the first title line; `line-clamp-2` lets the title wrap beside it. */}
                            <span className="flex items-start gap-1">
                              {g && (
                                <Zero0Glyph
                                  kind={g.kind}
                                  filled={g.filled}
                                  done={g.showCheck}
                                  cancelled={g.cancelled}
                                  requested={g.requested}
                                  scheduled={g.scheduled}
                                  ongoing={g.ongoing}
                                  className="mt-[1px] h-3 w-3 shrink-0"
                                />
                              )}
                              <span className="line-clamp-2 min-h-0 break-words text-[10px] font-medium">
                                {r.bar.title}
                              </span>
                            </span>
                            {(showTime || previewing) && (
                              <span className="shrink-0 truncate text-[9px] tabular-nums opacity-70">
                                {liveRange}
                                {showDuration && ` · ${fmtDuration(durMs)}`}
                              </span>
                            )}
                          </span>
                        )}
                        {/* TOP / BOTTOM RESIZE HANDLES (v0.2.315) — vertical mirror of the dayline's edge
                            drag. Top moves the start, bottom moves the end; each stops propagation so it
                            never triggers the block's open-click or the empty-area collapse. */}
                        {showHandles && (
                          <>
                            <span
                              className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-ns-resize"
                              onPointerDown={beginResize("start", r.bar)}
                              onPointerMove={moveResize}
                              onPointerUp={endResize}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span
                              className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-ns-resize"
                              onPointerDown={beginResize("end", r.bar)}
                              onPointerMove={moveResize}
                              onPointerUp={endResize}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </>
                        )}
                      </button>
                    )
                  })}

                  {/* External label chips (for blocks too small to hold their label inside) */}
                  {chips.map((c, i) => {
                    const dim = highlightId != null && highlightId !== c.bar.id
                    const accent = c.bar.color === ROOT_SENTINEL_COLOR ? NEUTRAL : (c.bar.sky ?? c.bar.color)
                    const g = glyphFor(c.bar.id)
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
                        title={`${c.bar.title} · ${
                          editPreview?.key === c.bar.key ? rangeText(editPreview.start, editPreview.end) : c.bar.range
                        }`}
                      >
                        {/* The entity glyph in its accent (mirror of the in-block glyph); falls back to a
                            simple accent dot if no model is available. */}
                        {g ? (
                          <span className="shrink-0" style={{ color: accent }}>
                            <Zero0Glyph
                              kind={g.kind}
                              filled={g.filled}
                              done={g.showCheck}
                              cancelled={g.cancelled}
                              requested={g.requested}
                              scheduled={g.scheduled}
                              ongoing={g.ongoing}
                              className="h-3 w-3"
                            />
                          </span>
                        ) : (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />
                        )}
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
