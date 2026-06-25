// ============================================================================
// Timeline scale engine
// ----------------------------------------------------------------------------
// The continuous, multi-scale time<->pixel substrate for the "life stream"
// timeline. Everything here is PURE (no React, no DOM) so it can be unit-reasoned
// about, memoised cheaply, and — if real data ever gets heavy — moved into a Web
// Worker untouched.
//
// The viewport is fully described by `{ startMs, spanMs }`:
//   - `startMs` — absolute epoch ms pinned to the LEFT edge of the viewport.
//   - `spanMs`  — how much time the viewport covers (hours at Day zoom, ~90 years
//                 at Life zoom). This replaces the old fixed 14h WINDOW_SPAN; zoom
//                 is now simply "change spanMs".
//
// A `width` (px) turns that into a d3 time scale for time->pixel mapping. We lean
// on d3-scale / d3-time for the parts that are genuinely fiddly (nice tick
// rounding, DST-safe stepping, multi-granularity intervals) and keep our own thin
// layer for everything Zero-specific (presets, LOD grain, two-tier ticks).
// ============================================================================

import { scaleTime, type ScaleTime } from "d3-scale"
import { timeMinute, timeHour, timeDay, timeWeek, timeMonth, timeYear, type TimeInterval } from "d3-time"
import { timeFormat } from "d3-time-format"

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
const MONTH_MS = 30 * DAY_MS // nominal, for px estimates only
const YEAR_MS = 365.25 * DAY_MS

// --- Zoom presets -----------------------------------------------------------
// The six selector letters map to a nominal span. Zoom is continuous BETWEEN
// these — the presets are just the snap targets the selector jumps to, and the
// reference points the selector highlights as you free-zoom past them.
export type ViewKey = "L" | "Y" | "Q" | "M" | "W" | "D"

export const VIEWS: ReadonlyArray<readonly [ViewKey, string]> = [
  ["L", "Life"],
  ["Y", "Year"],
  ["Q", "Quarter"],
  ["M", "Month"],
  ["W", "Week"],
  ["D", "Day"],
] as const

/** Nominal viewport span (ms) for each preset. "Day" frames a generous working
 *  day (~16h); "Life" frames ~90 years — the whole arc birth→old-age. */
export const VIEW_SPAN_MS: Record<ViewKey, number> = {
  D: 16 * HOUR_MS,
  W: WEEK_MS,
  M: 31 * DAY_MS,
  Q: 92 * DAY_MS,
  Y: 366 * DAY_MS,
  L: 90 * YEAR_MS,
}

// Hard zoom limits. Below ~15min the lifeline stops being useful; above ~120
// years we'd be past any human lifespan. Clamping keeps the scale well-behaved
// (and stops a frantic trackpad from launching into geological time).
export const MIN_SPAN_MS = 15 * MINUTE_MS
export const MAX_SPAN_MS = 120 * YEAR_MS

export function clampSpan(spanMs: number): number {
  return Math.min(MAX_SPAN_MS, Math.max(MIN_SPAN_MS, spanMs))
}

/** Snap a free span to the NEAREST preset key (log-distance, since spans range
 *  over ~5 orders of magnitude). Drives which selector letter reads as active
 *  while the user free-zooms. */
export function spanToView(spanMs: number): ViewKey {
  let best: ViewKey = "D"
  let bestD = Infinity
  for (const [key] of VIEWS) {
    const d = Math.abs(Math.log(spanMs) - Math.log(VIEW_SPAN_MS[key]))
    if (d < bestD) {
      bestD = d
      best = key
    }
  }
  return best
}

// --- Scale ------------------------------------------------------------------
export type TimelineScale = ScaleTime<number, number>

/** Build the d3 time scale mapping [startMs, startMs+spanMs] -> [0, width] px. */
export function makeScale(startMs: number, spanMs: number, width: number): TimelineScale {
  return scaleTime()
    .domain([new Date(startMs), new Date(startMs + spanMs)])
    .range([0, Math.max(1, width)])
}

// --- LOD grain --------------------------------------------------------------
// The single "how zoomed are we?" signal, derived from ms-per-pixel. Drives BOTH
// tick density and which aggregation bucket the data layer uses. Coarser grain =
// more aggregation. Ordered fine -> coarse.
export type Grain = "hour" | "day" | "week" | "month" | "quarter" | "year" | "decade"

const GRAIN_ORDER: Grain[] = ["hour", "day", "week", "month", "quarter", "year", "decade"]

/** Nominal ms width of one unit of each grain — used for px estimates. */
export const GRAIN_MS: Record<Grain, number> = {
  hour: HOUR_MS,
  day: DAY_MS,
  week: WEEK_MS,
  month: MONTH_MS,
  quarter: 3 * MONTH_MS,
  year: YEAR_MS,
  decade: 10 * YEAR_MS,
}

/** Pick the finest grain whose unit is at least ~70px wide at the current zoom,
 *  so individual units are visually distinguishable. This is the LOD pivot used by
 *  the DATA layer (which bucket to aggregate into) and the scrubber precision. */
export function lodGrain(spanMs: number, width: number): Grain {
  const pxPerMs = Math.max(1, width) / spanMs
  const MIN_UNIT_PX = 70
  for (const g of GRAIN_ORDER) {
    if (GRAIN_MS[g] * pxPerMs >= MIN_UNIT_PX) return g
  }
  return "decade"
}

// The RULER is intentionally finer than the data LOD: we want a densely populated
// set of graduations (so the scale always feels alive) while keeping LABELS spaced
// out enough to read. A minor graduation only needs ~32px; a *labeled* tick needs
// ~52px from its neighbour, so labels are thinned to "nice" steps independently of
// how many tick marks we draw. This is why hours keep showing far longer than they
// did when ticks were locked to the 70px data grain.
const MIN_TICK_PX = 32
const MIN_LABEL_PX = 52

// The ruler can subdivide FINER than the data LOD ever does. The data layer's
// finest `Grain` is "hour" (sub-hour buckets would be pointless for aggregation),
// but when the user zooms deep into a single day we still want the lifeline to
// keep sprouting graduations — halves, quarters, then 5-minute marks. `RulerGrain`
// is therefore a RULER-ONLY superset of `Grain`; it never touches `queryTimeline`,
// `lodGrain`, or the scrubber, so the data path is completely unaffected.
export type RulerGrain = "min5" | "min15" | "min30" | Grain

const RULER_GRAIN_ORDER: RulerGrain[] = ["min5", "min15", "min30", ...GRAIN_ORDER]

/** Nominal ms of one unit of each ruler grain (extends GRAIN_MS with sub-hour). */
const RULER_GRAIN_MS: Record<RulerGrain, number> = {
  min5: 5 * MINUTE_MS,
  min15: 15 * MINUTE_MS,
  min30: 30 * MINUTE_MS,
  ...GRAIN_MS,
}

/** Finest ruler grain whose unit is at least ~32px — the graduation density of
 *  the ruler. Can descend to 5-minute marks at deep zoom. */
export function tickGrain(spanMs: number, width: number): RulerGrain {
  const pxPerMs = Math.max(1, width) / spanMs
  for (const g of RULER_GRAIN_ORDER) {
    if (RULER_GRAIN_MS[g] * pxPerMs >= MIN_TICK_PX) return g
  }
  return "decade"
}

// --- Ticks ------------------------------------------------------------------
// Two-tier ruler: MINOR ticks at the current grain, MAJOR ticks at the next
// coarser context unit (these get a bolder line + a contextual label, e.g. month
// names under day ticks, years under month ticks). Built with d3-time intervals
// so stepping is DST-safe and aligned to real calendar boundaries.

export interface Tick {
  ms: number
  label: string
  major: boolean
  /** Whether to render this tick's text. ALL ticks draw a graduation line, but
   *  minor labels are thinned to "nice" steps so they never crowd. Majors are
   *  always labeled. */
  labeled: boolean
}

// "Nice" label steps per grain, in counts of that grain's own unit. The thinner
// picks the SMALLEST step whose pixel spacing clears MIN_LABEL_PX, so labels land
// on round values (every 2h, 3h, 6h… / every 5 days / every 5 years…).
const LABEL_STEPS: Record<RulerGrain, number[]> = {
  min5: [1, 3, 6, 12], // label every 5 / 15 / 30 / 60 min
  min15: [1, 2, 4], // every 15 / 30 / 60 min
  min30: [1, 2], // every 30 / 60 min
  hour: [1, 2, 3, 4, 6, 12],
  day: [1, 2, 5, 10],
  week: [1, 2, 4],
  month: [1, 2, 3, 6],
  quarter: [1, 2, 4],
  year: [1, 2, 5, 10, 25, 50],
  decade: [1, 2, 5],
}

/** Stable integer index of a date in units of `grain`, used for label divisibility.
 *  Resets at the next-coarser boundary where that boundary is itself a major tick
 *  (e.g. hours reset each day, days each month) so labels re-anchor to round values. */
function unitIndex(grain: RulerGrain, d: Date): number {
  switch (grain) {
    case "min5":
      return Math.floor(d.getMinutes() / 5) // resets each hour
    case "min15":
      return Math.floor(d.getMinutes() / 15)
    case "min30":
      return Math.floor(d.getMinutes() / 30)
    case "hour":
      return d.getHours()
    case "day":
      return d.getDate() - 1
    case "week":
      return Math.floor(d.getTime() / WEEK_MS)
    case "month":
      return d.getMonth()
    case "quarter":
      return Math.floor(d.getMonth() / 3)
    case "year":
      return d.getFullYear()
    case "decade":
      return Math.floor(d.getFullYear() / 10)
  }
}

/** Pick the smallest nice label step (in grain units) that clears MIN_LABEL_PX. */
function pickLabelStep(grain: RulerGrain, pxPerMs: number): number {
  const minorPx = RULER_GRAIN_MS[grain] * pxPerMs
  const steps = LABEL_STEPS[grain]
  for (const s of steps) {
    if (s * minorPx >= MIN_LABEL_PX) return s
  }
  return steps[steps.length - 1]
}

interface GrainTickConfig {
  /** d3 interval generating the MINOR ticks. */
  minor: TimeInterval
  /** d3 interval generating MAJOR (context) ticks. */
  major: TimeInterval
  /** Minor label (short). */
  fmtMinor: (d: Date) => string
  /** Major/context label. */
  fmtMajor: (d: Date) => string
}

const fmtHour = timeFormat("%-I%p") // 8AM
const fmtHourMin = timeFormat("%-I:%M") // 8:30
const fmtHourLower = (d: Date) => fmtHour(d).toLowerCase() // 8am (sub-hour context)
const fmtMinPast = timeFormat(":%M") // :15 (minutes past the hour)
const fmtWeekday = timeFormat("%a %-d") // Mon 5
const fmtDayNum = timeFormat("%-d") // 5
const fmtMonthShort = timeFormat("%b") // Jun
const fmtMonthYear = timeFormat("%b %Y") // Jun 2026
const fmtYear = timeFormat("%Y") // 2026
const fmtDayFull = timeFormat("%a %b %-d") // Mon Jun 5

// Quarter label (Q1..Q4) — d3 has no quarter token, so derive from the month.
function fmtQuarter(d: Date): string {
  return `Q${Math.floor(d.getMonth() / 3) + 1}`
}
// Decade label (2020s).
function fmtDecade(d: Date): string {
  return `${Math.floor(d.getFullYear() / 10) * 10}s`
}

const TICK_CONFIG: Record<RulerGrain, GrainTickConfig> = {
  // Sub-hour ruler grains: minors are minute marks (":15"), the bold context tier
  // is the hour ("8am"). The day context drops away this deep, but the scrubber's
  // center label still carries the full date.
  min5: {
    minor: timeMinute.every(5)!,
    major: timeHour.every(1)!,
    fmtMinor: fmtMinPast,
    fmtMajor: fmtHourLower,
  },
  min15: {
    minor: timeMinute.every(15)!,
    major: timeHour.every(1)!,
    fmtMinor: fmtMinPast,
    fmtMajor: fmtHourLower,
  },
  min30: {
    minor: timeMinute.every(30)!,
    major: timeHour.every(1)!,
    fmtMinor: fmtMinPast,
    fmtMajor: fmtHourLower,
  },
  hour: {
    minor: timeHour.every(1)!,
    major: timeDay.every(1)!,
    fmtMinor: (d) => (d.getMinutes() === 0 ? fmtHour(d).toLowerCase() : fmtHourMin(d)),
    fmtMajor: fmtDayFull,
  },
  day: {
    minor: timeDay.every(1)!,
    major: timeMonth.every(1)!,
    fmtMinor: fmtDayNum,
    fmtMajor: fmtMonthYear,
  },
  week: {
    minor: timeWeek.every(1)!,
    major: timeMonth.every(1)!,
    fmtMinor: fmtWeekday,
    fmtMajor: fmtMonthYear,
  },
  month: {
    minor: timeMonth.every(1)!,
    major: timeYear.every(1)!,
    fmtMinor: fmtMonthShort,
    fmtMajor: fmtYear,
  },
  quarter: {
    minor: timeMonth.every(3)!,
    major: timeYear.every(1)!,
    fmtMinor: fmtQuarter,
    fmtMajor: fmtYear,
  },
  year: {
    minor: timeYear.every(1)!,
    major: timeYear.every(10)!,
    fmtMinor: fmtYear,
    fmtMajor: fmtDecade,
  },
  decade: {
    minor: timeYear.every(10)!,
    major: timeYear.every(50)!,
    fmtMinor: fmtDecade,
    fmtMajor: (d) => fmtYear(d),
  },
}

/**
 * Build the two-tier tick set for the current viewport. Pads the range by one
 * unit on each side so ticks don't pop at the edges while panning. Major ticks
 * win when a timestamp coincides with both tiers (so a year line under month
 * ticks reads as major, not doubled).
 */
export function timelineTicks(startMs: number, spanMs: number, width: number): Tick[] {
  const grain = tickGrain(spanMs, width)
  const cfg = TICK_CONFIG[grain]
  const pxPerMs = Math.max(1, width) / spanMs
  const labelStep = pickLabelStep(grain, pxPerMs)
  const lo = new Date(startMs - spanMs * 0.05)
  const hi = new Date(startMs + spanMs * 1.05)

  const majorSet = new Set<number>()
  const out: Tick[] = []
  for (const d of cfg.major.range(lo, hi)) {
    const ms = d.getTime()
    majorSet.add(ms)
    out.push({ ms, label: cfg.fmtMajor(d), major: true, labeled: true })
  }
  for (const d of cfg.minor.range(lo, hi)) {
    const ms = d.getTime()
    if (majorSet.has(ms)) continue // already a major tick
    // Draw every minor graduation, but only label those on a nice step boundary.
    const labeled = unitIndex(grain, d) % labelStep === 0
    out.push({ ms, label: cfg.fmtMinor(d), major: false, labeled })
  }
  out.sort((a, b) => a.ms - b.ms)
  return out
}

// --- Scrubber label ---------------------------------------------------------
const fmtScrubDay = timeFormat("%a %b %-d, %Y") // Mon Jun 5, 2026
const fmtScrubMonth = timeFormat("%B %Y") // June 2026
const fmtScrubYear = timeFormat("%Y")

/** Granularity-aware label for the viewport CENTER, shown in the scrubber. The
 *  precision tracks the zoom: a day at fine zoom, a month mid, a year coarse. */
export function scrubLabel(centerMs: number, grain: Grain): string {
  const d = new Date(centerMs)
  switch (grain) {
    case "hour":
    case "day":
    case "week":
      return fmtScrubDay(d)
    case "month":
    case "quarter":
      return fmtScrubMonth(d)
    default:
      return fmtScrubYear(d)
  }
}
