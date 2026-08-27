// ─────────────────────────────────────────────────────────────────────────────────────────────────
// OVERFLOW-SCROLL LENS AXIS (v0.2.347)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The third and final formulation of the fisheye axis. The two before it both tried to fit the WHOLE
 * horizon into the lane, and both broke for the same structural reason:
 *
 *  - `.345 buildHorizonWarp` split a fixed focus share N ways, so lenses SHRANK as occurrences were added.
 *  - `.346 buildLensWarp` gave each lens a pixel budget but still had to sum to the viewport, so with
 *    enough marks every budget got scaled toward the 1px floor — the guarantee degraded exactly when it
 *    mattered. It also meant panning had almost nothing to do: if everything already fits, there is
 *    nowhere to pan TO, which is why `.346` panning felt inert even after the two real bugs were fixed.
 *
 * This model drops the no-scroll constraint instead of the size guarantee. The axis is laid out in its own
 * CONTENT space, as wide as it needs to be, and the lane becomes a moving window onto it:
 *
 *      content:  [····1900s····][LENS][··gap··][LENS][·······2100s·······]      (contentW px, fixed)
 *      lane:                  └────── viewportW ──────┘                        (scrollPx offset)
 *
 * Consequences, all of them the point:
 *  1. **Every lens is always its full width.** No budget scaling, ever — `lensPx` is a constant.
 *  2. **Panning is genuinely 1:1.** `scrollPx` IS a pixel offset, so content tracks the pointer exactly.
 *     No inverse-warp trickery, and no way for a pan to be a no-op.
 *  3. **The domain can be enormous** (±125 years) because dead time is compressed sublinearly, so
 *     reaching the 1900s or the 2100s costs a bounded, traversable number of pixels.
 *
 * The layout is deliberately **scroll-INDEPENDENT**: segments are a pure function of `(now, marks,
 * viewportW)`. Letting geometry depend on scroll position would close a feedback loop (layout → scroll →
 * layout) that jitters. Scroll only ever shifts the window.
 */
import type { TimeWarp } from "./dayline-warp"

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
/** Mean tropical year. Only used to size the domain, so the approximation is irrelevant. */
const YEAR_MS = 365.2425 * DAY_MS

export const PAN = {
  /**
   * Domain half-widths. ±125 years puts the reachable range at roughly 1901…2151 — "back to the 19XXs and
   * up to the 21XXs". This is affordable ONLY because of the sublinear dead-space law below; under a linear
   * axis the same domain would be ~90,000 day-columns wide.
   */
  domainPastMs: 125 * YEAR_MS,
  domainFutureMs: 125 * YEAR_MS,

  /** Where NOW sits at rest, as a fraction of the lane. */
  nowAnchorFrac: 1 / 3,

  /** A lens is `max(minLensPx, viewportW * maxLensFrac)` — a hard constant now, never scaled down. */
  minLensPx: 150,
  maxLensFrac: 1 / 5,

  /**
   * DEAD-SPACE LAW — `deadBasePx + deadScalePx * days^deadExponent`.
   *
   * Sublinear by necessity: linear dead space cannot span centuries, and pure log compression collapses
   * them so hard there is nothing left to pan through (125 years came out ~110px, i.e. the entire 20th
   * century sat inside one flick). A square root is the middle ground and reads well at every scale:
   *
   *      1 day → 15px      1 week → 28px      1 month → 52px
   *      1 year → 168px    10 years → 522px   125 years → ~1.8kpx
   *
   * A month of empty time therefore costs about a third of one lens, which is what "condense the shrunk
   * areas more" asks for: the old law gave that same month ~40% of the whole lane.
   */
  deadBasePx: 6,
  deadScalePx: 8.5,
  deadExponent: 0.5,

  /** Lenses whose dead gap would render thinner than this merge into one. */
  mergeGapPx: 12,

  /** Zero-duration marks (Instants, `at`/`due` points) get this much nominal span so their lens isn't
   *  degenerate — a 0ms lens consumes width but renders 0px of tick. */
  pointSpanMs: 2 * HOUR_MS,

  /** NOW always gets its own lens, so wherever the uzer pans there is readable local detail at today. */
  nowLensMs: 12 * HOUR_MS,

  /**
   * How far out to GATHER occurrences. Deliberately far smaller than the domain: the recurrence engine
   * expands rules per-day, so asking it for 250 years of a daily rule would be ~90,000 occurrences. Marks
   * beyond this window still exist and still render — they just don't earn a dilating lens.
   */
  markGatherPastMs: 30 * DAY_MS,
  markGatherFutureMs: 365 * DAY_MS,

  /**
   * Cap on lenses. Each one adds a full `lensPx` to `contentW`, so an unbounded count makes the timeline
   * unpannably long (a daily rule for a year = 365 lenses ≈ 65,000px). When exceeded, the marks NEAREST
   * NOW win, since those are the ones the uzer is looking at.
   */
  maxLenses: 240,

  /** Off-screen px kept renderable either side of the lane so bars don't pop in at the edges. */
  edgeMarginPx: 140,
} as const

export type LensInterval = { start: number; end: number }

export type ScrollLensWarp = TimeWarp & {
  /** Merged focus intervals actually laid out as lenses. */
  lenses: LensInterval[]
  /** Full width of the laid-out axis in px. Always `>= viewportW`. */
  contentW: number
  /** Current scroll offset in content px. */
  scrollPx: number
  /** The offset that puts NOW at `nowAnchorFrac` — i.e. the rest position a recenter returns to. */
  restScrollPx: number
  /** Maximum legal scroll (`contentW - viewportW`). */
  maxScrollPx: number
  /** Time at the left lane edge, minus `edgeMarginPx` of headroom. Bars/guides should build from this. */
  visibleStart: number
  /** Time at the right lane edge, plus `edgeMarginPx` of headroom. */
  visibleEnd: number
  /** Time → content px (scroll-independent). */
  contentXFor: (t: number) => number
  /** Content px → time (scroll-independent). */
  contentTimeAt: (x: number) => number
}

type Seg = { t0: number; t1: number; x0: number; x1: number; lens: boolean }

/** The dead-space law. Closed-form in duration alone — see `PAN.deadBasePx`. */
export function deadGapPx(ms: number): number {
  const days = Math.max(0, ms) / DAY_MS
  return PAN.deadBasePx + PAN.deadScalePx * Math.pow(days, PAN.deadExponent)
}

/**
 * Build the scrollable fisheye axis.
 *
 * @param now       Current time. Anchors the domain and gets its own lens.
 * @param marks     Focus intervals (planned occurrences). Order and overlap don't matter.
 * @param viewportW Lane width in px.
 * @param scrollOverride Explicit scroll offset from a pan, or `null` to rest at the NOW anchor.
 */
export function buildScrollLensWarp(
  now: number,
  marks: { start: number; end?: number }[],
  viewportW: number,
  scrollOverride: number | null = null,
): ScrollLensWarp | null {
  if (!(viewportW > 0)) return null

  const lo = now - PAN.domainPastMs
  const hi = now + PAN.domainFutureMs
  const lensPx = Math.max(PAN.minLensPx, viewportW * PAN.maxLensFrac)

  // ── Focus intervals. NOW is folded in as a mark so today always reads clearly, and because it is a
  // pure function of `now` it keeps the layout scroll-independent.
  const raw: LensInterval[] = [{ start: now - PAN.nowLensMs / 2, end: now + PAN.nowLensMs / 2 }]
  for (const m of marks) {
    const s = m.start
    const e = m.end ?? m.start
    if (e < lo || s > hi) continue
    if (e - s < PAN.pointSpanMs) {
      const mid = (s + e) / 2
      raw.push({ start: mid - PAN.pointSpanMs / 2, end: mid + PAN.pointSpanMs / 2 })
    } else {
      raw.push({ start: s, end: e })
    }
  }
  for (const i of raw) {
    i.start = Math.max(lo, Math.min(hi, i.start))
    i.end = Math.max(i.start, Math.min(hi, i.end))
  }
  raw.sort((a, b) => a.start - b.start)

  // ── MERGE. One pass, no iteration: because `deadGapPx` depends only on duration (not on a shared
  // budget), "would this gap render thinner than `mergeGapPx`?" is answerable up front. The `.346` model
  // had to solve this circularly — gap width depended on the allocation, which depended on the lens set.
  let lenses: LensInterval[] = []
  for (const i of raw) {
    const prev = lenses[lenses.length - 1]
    if (prev && (i.start <= prev.end || deadGapPx(i.start - prev.end) < PAN.mergeGapPx)) {
      prev.end = Math.max(prev.end, i.end)
    } else {
      lenses.push({ ...i })
    }
  }

  // ── CAP, nearest-to-now first (see `PAN.maxLenses`), then restore chronological order.
  if (lenses.length > PAN.maxLenses) {
    const dist = (l: LensInterval) => (l.end < now ? now - l.end : l.start > now ? l.start - now : 0)
    lenses = lenses
      .slice()
      .sort((a, b) => dist(a) - dist(b))
      .slice(0, PAN.maxLenses)
      .sort((a, b) => a.start - b.start)
  }

  // ── Lay out the alternating gap/lens chain in content space.
  const segs: Seg[] = []
  let x = 0
  let cursor = lo
  for (const l of lenses) {
    if (l.start > cursor) {
      const w = deadGapPx(l.start - cursor)
      segs.push({ t0: cursor, t1: l.start, x0: x, x1: x + w, lens: false })
      x += w
      cursor = l.start
    }
    segs.push({ t0: l.start, t1: l.end, x0: x, x1: x + lensPx, lens: true })
    x += lensPx
    cursor = l.end
  }
  if (hi > cursor) {
    const w = deadGapPx(hi - cursor)
    segs.push({ t0: cursor, t1: hi, x0: x, x1: x + w, lens: false })
    x += w
  }
  if (!segs.length) return null
  let contentW = x

  // ── If the axis somehow came out narrower than the lane (e.g. one lens spanning the whole domain),
  // inflate the GAPS to fill it. Keeps the "no dead margin" property of the earlier models in that corner
  // case without ever shrinking a lens.
  if (contentW < viewportW) {
    const lensTotal = segs.reduce((a, s) => a + (s.lens ? s.x1 - s.x0 : 0), 0)
    const gapTotal = contentW - lensTotal
    const slack = viewportW - contentW
    if (gapTotal > 0) {
      const f = (gapTotal + slack) / gapTotal
      let cx = 0
      for (const s of segs) {
        const w = s.lens ? s.x1 - s.x0 : (s.x1 - s.x0) * f
        s.x0 = cx
        s.x1 = cx + w
        cx += w
      }
      contentW = cx
    }
  }

  const lastSeg = segs[segs.length - 1]

  const contentXFor = (t: number): number => {
    if (t <= lo) return 0
    if (t >= hi) return contentW
    let a = 0
    let b = segs.length - 1
    while (a < b) {
      const m = (a + b) >> 1
      if (segs[m].t1 <= t) a = m + 1
      else b = m
    }
    const s = segs[a]
    const dt = s.t1 - s.t0
    if (dt <= 0) return s.x0
    return s.x0 + ((t - s.t0) / dt) * (s.x1 - s.x0)
  }

  const contentTimeAt = (cx: number): number => {
    if (cx <= 0) return lo
    if (cx >= contentW) return hi
    let a = 0
    let b = segs.length - 1
    while (a < b) {
      const m = (a + b) >> 1
      if (segs[m].x1 <= cx) a = m + 1
      else b = m
    }
    const s = segs[a]
    const dx = s.x1 - s.x0
    if (dx <= 0) return s.t0
    return s.t0 + ((cx - s.x0) / dx) * (s.t1 - s.t0)
  }

  const maxScrollPx = Math.max(0, contentW - viewportW)
  const restScrollPx = Math.max(0, Math.min(maxScrollPx, contentXFor(now) - viewportW * PAN.nowAnchorFrac))
  const scrollPx = Math.max(0, Math.min(maxScrollPx, scrollOverride ?? restScrollPx))

  // Uniform pace, for `densityAt`'s "× real time" ratio.
  const uniform = contentW / Math.max(1, hi - lo)

  return {
    start: lo,
    end: hi,
    lenses,
    contentW,
    scrollPx,
    restScrollPx,
    maxScrollPx,
    visibleStart: contentTimeAt(scrollPx - PAN.edgeMarginPx),
    visibleEnd: contentTimeAt(scrollPx + viewportW + PAN.edgeMarginPx),
    contentXFor,
    contentTimeAt,
    // NOTE: unlike the earlier models this is NOT clamped to [0,100] — anything off-screen is legitimately
    // outside the lane, and callers rely on that to position partially-visible bars correctly.
    pctFor: (t: number) => ((contentXFor(t) - scrollPx) / viewportW) * 100,
    timeAt: (pct: number) => contentTimeAt(scrollPx + (pct / 100) * viewportW),
    densityAt: (t: number) => {
      const tc = Math.min(hi, Math.max(lo, t))
      let a = 0
      let b = segs.length - 1
      while (a < b) {
        const m = (a + b) >> 1
        if (segs[m].t1 <= tc) a = m + 1
        else b = m
      }
      const s = segs[a] ?? lastSeg
      const dt = s.t1 - s.t0
      if (dt <= 0) return 1
      return (s.x1 - s.x0) / dt / uniform
    },
  }
}
