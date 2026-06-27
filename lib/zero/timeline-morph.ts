// ============================================================================
// Timeline plane-morph geometry
// ----------------------------------------------------------------------------
// Pure geometry for the Lifelane <-> Atlas "plane morph". Instead of cross-fading
// two separate DOM trees (the old translucent layoutId FLIP), we render ONE overlay
// of elements that each fly from their LIFELANE rect to their ATLAS rect (or back).
//
// Every rect is expressed in the ATLAS LAYER's pixel box — a `width` × `viewHeightPx`
// rectangle whose origin is the card's top-left (the overlay is portaled into that
// same layer, so its coordinates line up with the real Atlas with no conversion).
//
//   LIFELANE side: time runs HORIZONTALLY. A day is a tall band [pct(dayStart) ..
//     pct(dayEnd)] spanning the track height; hour graduations are vertical ticks
//     spaced across the day; the day title floats in the label band above.
//   ATLAS side: time runs VERTICALLY. A day is a column; hour graduations are
//     horizontal lines down the column; the title is the column header.
//
// Interpolating each element's {x,y,w,h} between those two states makes a day's
// horizontal span visibly ROTATE into its vertical column — graduations, boundary
// lines and titles included — while event chips slide from their linear slot into
// their day/time cell. All pure + DOM-free so it can be reasoned about and memoised.
// ============================================================================

import { packDay } from "./day-pack"

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

// --- Atlas grid shape (shared with TimelineWeek so geometry == real DOM) -----
/** Day columns shown in the Atlas: today−2 … today … today+2 (5 columns). The
 *  user pans left/right to reach earlier/later days. */
export const DAYS_BEFORE = 2
export const DAYS_AFTER = 2
export const DAY_COUNT = DAYS_BEFORE + 1 + DAYS_AFTER // 5
/** Left hour-axis gutter width (px). */
export const HOUR_AXIS_W = 40
/** Column header height (px). Fixed so the morph's "to" rect matches the real
 *  header exactly for a seamless hand-off. TimelineWeek pins its header to this. */
export const ATLAS_HEADER_H = 28
/** Hours labelled on the axis / drawn as graduation lines (every 3h). */
export const HOUR_MARKS = [0, 3, 6, 9, 12, 15, 18, 21]

// --- Morph timing ------------------------------------------------------------
export const MORPH_S = 0.52
export const MORPH_EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1]

export type MorphRect = { x: number; y: number; w: number; h: number }
export type MorphKind = "cell" | "hour" | "title" | "chip"
export type MorphPair = {
  key: string
  kind: MorphKind
  /** Lifelane (linear) rect. */
  lane: MorphRect
  /** Atlas (day-grid) rect. */
  atlas: MorphRect
  color?: string
  title?: string
  cancelled?: boolean
}

/** Local midnight (00:00) of `epoch`'s day, as epoch ms. */
export function startOfDay(epoch: number): number {
  const d = new Date(epoch)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** First (leftmost) day column for a given panned center. */
export function firstDayFor(centerMs: number): number {
  return startOfDay(centerMs) - DAYS_BEFORE * DAY_MS
}

/** "SAT JUN 26" — weekday + month + day-of-month, uppercased (matches TimelineWeek). */
export function fmtColumn(ms: number): string {
  const d = new Date(ms)
  const wd = d.toLocaleDateString(undefined, { weekday: "short" })
  const mo = d.toLocaleDateString(undefined, { month: "short" })
  return `${wd} ${mo} ${d.getDate()}`.toUpperCase()
}

/** Atlas pixel geometry derived from the layer box. */
export function atlasGeom(width: number, viewHeightPx: number) {
  const colW = (width - HOUR_AXIS_W) / DAY_COUNT
  const bodyTop = ATLAS_HEADER_H
  const bodyH = Math.max(1, viewHeightPx - ATLAS_HEADER_H)
  const colX = (i: number) => HOUR_AXIS_W + i * colW
  return { colW, bodyTop, bodyH, colX }
}

/** Linear interpolation between two rects (t: 0 = a, 1 = b). */
export function lerpRect(a: MorphRect, b: MorphRect, t: number): MorphRect {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
  }
}

export interface BuildMorphInput {
  /** Event/instant items already flattened for the timeline (same array the Atlas uses). */
  items: {
    key: string
    from: number
    to: number
    color?: string
    title: string
    kind?: string
    cancelled?: boolean
  }[]
  startMs: number
  spanMs: number
  /** Layer box. */
  width: number
  viewHeightPx: number
  /** Lifelane track top (card-y of the first lane row) and the day-band height. */
  laneBandTopY: number
  bandH: number
  /** Lifelane y (card coords) for a chip key, or null if it has no visible lane
   *  (collapsed mother / off lane) — such chips are skipped (no morph twin). */
  chipLaneY: (key: string) => number | null
  /** Panned week center (defaults handled by caller). */
  weekCenter: number
}

/**
 * Build every morph pair (day cells, hour graduations, column titles, chips) with
 * both its Lifelane and Atlas rect in layer-pixel coordinates.
 */
export function buildMorphPairs(input: BuildMorphInput): MorphPair[] {
  const { items, startMs, spanMs, width, viewHeightPx, laneBandTopY, bandH, chipLaneY, weekCenter } = input
  const pct = (ms: number) => ((ms - startMs) / spanMs) * width
  const { colW, bodyTop, bodyH, colX } = atlasGeom(width, viewHeightPx)
  const firstDay = firstDayFor(weekCenter)
  const pairs: MorphPair[] = []

  for (let i = 0; i < DAY_COUNT; i++) {
    const ds = firstDay + i * DAY_MS
    const de = ds + DAY_MS

    // Day cell: horizontal band -> vertical column.
    pairs.push({
      key: `cell:${ds}`,
      kind: "cell",
      lane: { x: pct(ds), y: laneBandTopY, w: (DAY_MS / spanMs) * width, h: bandH },
      atlas: { x: colX(i), y: bodyTop, w: colW, h: bodyH },
    })

    // Hour graduations: vertical ticks across the day -> horizontal lines down the column.
    for (const h of HOUR_MARKS) {
      const hourMs = ds + h * HOUR_MS
      pairs.push({
        key: `hour:${ds}:${h}`,
        kind: "hour",
        lane: { x: pct(hourMs), y: laneBandTopY, w: 1, h: bandH },
        atlas: { x: colX(i), y: bodyTop + (h / 24) * bodyH, w: colW, h: 1 },
      })
    }

    // Column title: floats in the label band over the day -> column header.
    const titleW = 64
    pairs.push({
      key: `title:${ds}`,
      kind: "title",
      title: fmtColumn(ds),
      lane: { x: pct(ds + DAY_MS / 2) - titleW / 2, y: laneBandTopY - 18, w: titleW, h: 14 },
      atlas: { x: colX(i), y: 0, w: colW, h: ATLAS_HEADER_H },
    })

    // Chips for this day: run the SAME packing the Atlas uses so the "to" rect lands
    // exactly where the real grid will place the chip.
    const bucket = items
      .filter((it) => {
        const isInstant = it.kind === "instant" || it.from === it.to
        return isInstant ? it.from >= ds && it.from < de : it.from < de && it.to > ds
      })
      .map((it) => ({ it, isInstant: it.kind === "instant" || it.from === it.to }))
    const placed = packDay(bucket, ds)
    for (const p of placed) {
      // A multi-day item is placed in several columns; only morph it in the FIRST
      // (leftmost) column it appears in, so each chip key has a single morph twin.
      const itStartDayIdx = Math.floor((startOfDay(p.it.from) - firstDay) / DAY_MS)
      const firstVisibleIdx = Math.max(0, itStartDayIdx)
      if (i !== firstVisibleIdx) continue
      const laneY = chipLaneY(p.it.key)
      if (laneY == null) continue // no visible lane on the Lifelane — skip morph
      const cw = colW / p.cols
      const fromW = Math.max((p.it.to - p.it.from) / spanMs, 0.004) * width
      pairs.push({
        key: `chip:${p.it.key}`,
        kind: "chip",
        color: p.it.color,
        title: p.it.title,
        cancelled: p.it.cancelled,
        lane: { x: pct(p.it.from), y: laneY, w: fromW, h: 24 },
        atlas: {
          x: colX(i) + p.col * cw + 1,
          y: bodyTop + p.sf * bodyH,
          w: cw - 2,
          h: Math.max((p.ef - p.sf) * bodyH, 14),
        },
      })
    }
  }

  return pairs
}
