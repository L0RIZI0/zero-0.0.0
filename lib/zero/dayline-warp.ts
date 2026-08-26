/**
 * NON-LINEAR ("fisheye") TIME AXIS for the dayline — v0.2.345, experimental.
 *
 * WHY THIS EXISTS
 * The dayline's default time→x map is LINEAR: `x = (t - winStart) / viewSpan`. That is affine, which is
 * exactly why pan/zoom can be a single composited parent transform (O(1) per frame for N ticks — see
 * .310–.312). It has one bad failure mode though: when the only planned entity is six months out, the
 * dayline is 99% empty space. This module provides the alternative — a smooth warp that DILATES windows
 * of interest ("foci") and COMPRESSES the dead space between them, so a long horizon stays readable.
 *
 * THE FORMULATION (density integral — deliberately NOT a hand-placed piecewise map)
 * We do not define positions directly. We define a DENSITY `d(t)` (relative px per ms) as a flat baseline
 * plus a sum of smooth bumps, then INTEGRATE it to get position:
 *
 *     d(t) = base + Σ wᵢ · raisedCosine((t − cᵢ) / hᵢ)       x(t) = ∫d / ∫d over the whole horizon
 *
 * Integrating is the whole trick. A raised cosine is C¹ (value AND slope reach zero at its edges), so the
 * density is smooth, so the POSITION is C¹-continuous — meaning a tick's on-screen SPEED changes smoothly
 * as it crosses a focus boundary. That is the "smooth joints" property. The naive alternative — piecewise
 * CONSTANT density (e.g. "this third of the screen is one day") — integrates to a piecewise-LINEAR
 * position with velocity KINKS at every joint, which reads as a visible stutter. Hence bumps, not steps.
 *
 * WHY `base` IS SMALL AND DERIVED, NOT 1
 * The first cut of this used `d = 1 + Σ bumps`, which cannot COMPRESS: density only ever rises above the
 * linear pace, so on a 171-day horizon the flat baseline dominates the integral and the focus around now
 * still collapsed to ~2% of the axis (measured — this is what the unit test caught). Dilating foci is only
 * half the job; the dead space has to shrink too. So `base` is instead DERIVED from a target FOCUS SHARE:
 *
 *     ∫bumpᵢ = wᵢ·hᵢ   ⇒   base = Σ(wᵢ·hᵢ) · (1 − F) / (F · span)
 *
 * where F is the fraction of the axis the foci should collectively own. That makes the result
 * HORIZON-LENGTH INDEPENDENT — stretch the horizon from 3 days to 3 years and the foci keep the same share
 * of the screen while the connective tissue absorbs all of the growth, which is precisely the behaviour
 * wanted for "now plus one thing six months out".
 *
 * COST
 * `pctFor` is O(1) via a precomputed cumulative table + lerp, so per-frame cost is the same order as the
 * linear map. What the warp actually costs is ARCHITECTURAL, not computational: x(t) is no longer affine,
 * so pan/zoom can no longer be one parent transform. That is why the first consumer of this module is the
 * NO-SCROLL "horizon" mode — with no panning there is no per-frame re-layout at all, so none of the
 * .310–.312 gesture machinery has to be rewritten to prove the idea out.
 *
 * INVARIANTS worth preserving in any consumer:
 *  • LAYOUT stays in TIME space. Lane packing / clustering depend only on time OVERLAP, which is
 *    warp-invariant (a monotonic map preserves ordering and intersection), so .335-style clustering keeps
 *    working untouched. Warp only at PAINT time.
 *  • Widths must be computed as `pctFor(end) − pctFor(start)`, NEVER as `duration × scale`. That form is
 *    also exactly correct in linear mode (an affine map's differences are proportional), so call sites can
 *    use one expression for both modes.
 *  • Text must be positioned, never scaled (no `scaleX`) — scaling is what distorts glyphs.
 */

/** One smooth dilation window. `weight` is how much density it ADDS at its center (0 = no effect). */
export type DensityBump = {
  /** Focus center, epoch ms. */
  center: number
  /** Half-extent in ms — the bump is exactly zero at `center ± halfWidth`. */
  halfWidth: number
  /** Peak added density at the center, relative to the 1.0 baseline. */
  weight: number
}

export type TimeWarp = {
  /** Horizon bounds (epoch ms). `pctFor(start) === 0`, `pctFor(end) === 100`. */
  start: number
  end: number
  /** Time → percentage across the horizon, monotonically increasing. O(1). */
  pctFor: (t: number) => number
  /** Inverse: percentage → time. Needed for hit-testing and drag-to-replan. O(log n). */
  timeAt: (pct: number) => number
  /**
   * Local density at `t`, NORMALIZED so 1.0 = the pace a purely linear axis would run at. >1 means this
   * instant is dilated (a ms buys more px than average), <1 compressed. Consumers MUST use this to scale
   * drag sensitivity (px→ms is `1 / densityAt`), or resizing feels wrong inside a compressed zone.
   */
  densityAt: (t: number) => number
  /**
   * The density bumps this warp was built from. Present only for the density-integral builder
   * (`buildHorizonWarp`); the lens-plan builder has no bump concept, so it is optional. Nothing outside
   * this module reads it — it's kept for debugging the smooth formulation.
   */
  bumps?: DensityBump[]
}

/**
 * C¹ bump: 1 at u=0, 0 at |u|>=1, with ZERO SLOPE at both ends so it joins the baseline invisibly.
 * (A triangular or rectangular window would leave a slope discontinuity ⇒ visible velocity kink.)
 */
function raisedCosine(u: number): number {
  const a = Math.abs(u)
  if (a >= 1) return 0
  return 0.5 * (1 + Math.cos(Math.PI * a))
}

/** Resolution of the cumulative table. 1024 samples over any horizon is plenty — the density is smooth
 *  and band-limited by the narrowest bump, and we lerp between samples. */
const BUCKETS = 1024

/**
 * Build the warp. Samples `d(t)` on a uniform grid, integrates with the trapezoid rule into a cumulative
 * table, and normalizes to [0,100]. Everything after construction is table lookups.
 *
 * Passing an empty `bumps` yields a warp that is EXACTLY the linear map (density is a flat 1), which makes
 * it safe to use unconditionally and keeps the degenerate case honest rather than special-cased.
 */
export function makeTimeWarp(
  start: number,
  end: number,
  bumps: DensityBump[],
  opts: {
    /**
     * Fraction of the axis the foci should collectively own (0–1). The flat baseline is DERIVED from this
     * (see the header note), which is what makes the layout independent of horizon length. Omit — or pass
     * no bumps — for the plain linear axis.
     */
    focusShare?: number
    buckets?: number
  } = {},
): TimeWarp {
  const buckets = opts.buckets ?? BUCKETS
  const span = Math.max(1, end - start)
  const step = span / buckets
  // Derive the compressed baseline from the requested focus share. ∫ of a raised-cosine bump is exactly
  // weight × halfWidth, so the focus mass is known analytically — no search needed.
  const focusMass = bumps.reduce((sum, b) => sum + Math.max(0, b.weight) * Math.max(0, b.halfWidth), 0)
  const F = Math.max(0.01, Math.min(0.99, opts.focusShare ?? 0))
  const base = focusMass > 0 && opts.focusShare ? (focusMass * (1 - F)) / (F * span) : 1
  // Raw density samples at each grid point (buckets + 1 of them).
  const dens = new Float64Array(buckets + 1)
  for (let i = 0; i <= buckets; i++) {
    const t = start + i * step
    let d = base
    for (const b of bumps) {
      if (b.halfWidth > 0 && b.weight !== 0) d += b.weight * raisedCosine((t - b.center) / b.halfWidth)
    }
    dens[i] = d
  }
  // Cumulative integral (trapezoid). cum[i] = ∫ d from start to start + i*step.
  const cum = new Float64Array(buckets + 1)
  for (let i = 1; i <= buckets; i++) cum[i] = cum[i - 1] + ((dens[i - 1] + dens[i]) / 2) * step
  const total = cum[buckets] || 1
  // Mean density over the horizon — dividing by this makes densityAt read as "×linear pace".
  const meanDens = total / span

  const pctFor = (t: number): number => {
    if (t <= start) return 0
    if (t >= end) return 100
    const f = (t - start) / step
    const i = Math.min(buckets - 1, Math.floor(f))
    const frac = f - i
    // Integrate the trapezoid PARTIALLY into bucket i so pctFor is smooth, not stair-stepped.
    const dHere = dens[i] + (dens[i + 1] - dens[i]) * frac
    const partial = ((dens[i] + dHere) / 2) * (frac * step)
    return ((cum[i] + partial) / total) * 100
  }

  const timeAt = (pct: number): number => {
    if (pct <= 0) return start
    if (pct >= 100) return end
    const target = (pct / 100) * total
    // Binary search the last bucket whose cumulative is <= target.
    let lo = 0
    let hi = buckets
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid] <= target) lo = mid
      else hi = mid
    }
    const rem = target - cum[lo]
    // Invert the trapezoid on this bucket. Density is linear here (d = a + b·u for u in [0,step]), so the
    // integral is a + b·u²/2 — solve the quadratic; fall back to the flat case when b ≈ 0.
    const a = dens[lo]
    const b = (dens[lo + 1] - dens[lo]) / step
    let u: number
    if (Math.abs(b) < 1e-12) u = rem / (a || 1)
    else {
      const disc = Math.max(0, a * a + 2 * b * rem)
      u = (Math.sqrt(disc) - a) / b
    }
    return start + lo * step + Math.max(0, Math.min(step, u))
  }

  const densityAt = (t: number): number => {
    if (t <= start) return dens[0] / meanDens
    if (t >= end) return dens[buckets] / meanDens
    const f = (t - start) / step
    const i = Math.min(buckets - 1, Math.floor(f))
    const frac = f - i
    return (dens[i] + (dens[i + 1] - dens[i]) * frac) / meanDens
  }

  return { start, end, pctFor, timeAt, densityAt, bumps }
}

const MIN_MS = 60_000
const HOUR_MS = 60 * MIN_MS
const DAY_MS = 24 * HOUR_MS

/** A time point of interest the horizon should keep readable (a planned occurrence, a session, …). */
export type HorizonMark = { start: number; end?: number }

/** Tunables for {@link buildHorizonWarp}, all in ms unless noted. Exported so the caller can tweak
 *  without editing this module (and so the values are visible in one place while we evaluate the idea). */
export const HORIZON = {
  /** How far into the past the horizon reaches by default. */
  pastMs: 12 * HOUR_MS,
  /** Hard cap on how far back a stray old mark may drag the horizon start. */
  maxPastMs: 30 * DAY_MS,
  /** Minimum forward reach, so an empty plan still shows a sane "today + tomorrow". */
  minFutureMs: 36 * HOUR_MS,
  /** Hard cap on forward reach — a mark 5 years out shouldn't define the whole axis. */
  maxFutureMs: 400 * DAY_MS,
  /** Marks closer than this merge into one focus (so a busy afternoon is ONE bubble, not twenty). */
  clusterGapMs: 8 * HOUR_MS,
  /** Half-width floor for a focus — a zero-length instant still deserves a readable window. */
  minFocusHalfMs: 3 * HOUR_MS,
  /**
   * Fraction of the axis owned by the foci collectively; the rest is compressed connective tissue.
   * 0.8 keeps the dead space visible as a real (if squeezed) stretch of time rather than erasing it —
   * the compression should read as "a lot of time passes here", not as a hard cut.
   */
  focusShare: 0.8,
  /** RELATIVE weight of the NOW focus ("the present is the first focus" — heaviest). Weights are
   *  relative to each other only; absolute scale is set by `focusShare`. */
  nowWeight: 2,
  /** Half-width of the NOW focus. */
  nowHalfMs: 10 * HOUR_MS,
  /** RELATIVE weight of a planned/recorded cluster focus. */
  markWeight: 1,
  /** Padding added around a cluster's extent when sizing its focus. */
  clusterPadMs: 2 * HOUR_MS,
}

/**
 * Build the NO-SCROLL "whole horizon" warp: one axis spanning from a little before now out to the last
 * thing worth showing, with NOW always visible and dilated, each cluster of marks dilated, and the dead
 * space between them compressed. This is the variant that pays for itself immediately — the warp is
 * essentially static (it only drifts as `now` advances), so there is no per-frame re-layout.
 *
 * Returns `null` when the content doesn't justify a warp (everything already fits within roughly a day),
 * so the caller can just stay on the plain linear axis instead of applying a pointless distortion.
 */
export function buildHorizonWarp(now: number, marks: HorizonMark[]): TimeWarp | null {
  // Bound the horizon by content, clamped so one outlier can't define the axis.
  let first = now - HORIZON.pastMs
  let last = now + HORIZON.minFutureMs
  for (const m of marks) {
    const s = m.start
    const e = m.end ?? m.start
    if (s < first) first = Math.max(s, now - HORIZON.maxPastMs)
    if (e > last) last = Math.min(e + HORIZON.clusterPadMs, now + HORIZON.maxFutureMs)
  }
  const start = Math.min(first, now - HORIZON.pastMs)
  const end = Math.max(last, now + HORIZON.minFutureMs)
  // Not worth warping — a ≤2-day horizon is already legible linearly.
  if (end - start <= 2 * DAY_MS) return null

  // CLUSTER the marks so a dense afternoon becomes a single focus rather than a pile of overlapping
  // bumps (overlapping bumps would sum into a runaway density spike and starve everything else).
  const inWindow = marks
    .map((m) => ({ s: Math.max(start, m.start), e: Math.min(end, m.end ?? m.start) }))
    .filter((m) => m.e >= start && m.s <= end)
    .sort((a, b) => a.s - b.s)
  const clusters: { s: number; e: number }[] = []
  for (const m of inWindow) {
    const prev = clusters[clusters.length - 1]
    if (prev && m.s - prev.e <= HORIZON.clusterGapMs) prev.e = Math.max(prev.e, m.e)
    else clusters.push({ s: m.s, e: m.e })
  }

  const bumps: DensityBump[] = [{ center: now, halfWidth: HORIZON.nowHalfMs, weight: HORIZON.nowWeight }]
  for (const c of clusters) {
    const center = (c.s + c.e) / 2
    // Skip clusters swallowed by the NOW focus — they're already dilated, and a second bump on top would
    // just spike the density there.
    if (Math.abs(center - now) < HORIZON.nowHalfMs * 0.6) continue
    const halfWidth = Math.max(HORIZON.minFocusHalfMs, (c.e - c.s) / 2 + HORIZON.clusterPadMs)
    bumps.push({ center, halfWidth, weight: HORIZON.markWeight })
  }
  return makeTimeWarp(start, end, bumps, { focusShare: HORIZON.focusShare })
}

/**
 * Pick a GRIDLINE step for a warped/long horizon so the guide count stays bounded. Without this a
 * six-month horizon at hourly granularity would mount thousands of nodes for lines that are sub-pixel
 * apart anyway. Returns the step in ms; the caller walks aligned boundaries at that step.
 */
export function chooseGuideStep(spanMs: number, maxLines = 80): number {
  const steps = [HOUR_MS, 3 * HOUR_MS, 6 * HOUR_MS, 12 * HOUR_MS, DAY_MS, 2 * DAY_MS, 7 * DAY_MS, 14 * DAY_MS, 28 * DAY_MS]
  for (const s of steps) if (spanMs / s <= maxLines) return s
  return steps[steps.length - 1]
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// LENS PLAN — absolute-pixel fisheye (v0.2.346)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * `buildHorizonWarp` above allocates RELATIVE density shares: it says "this region gets 3× the pace of
 * that one" and lets the actual pixel width fall out of the integral. That is smooth (C¹) but it cannot
 * promise a tick any specific SIZE — which is exactly what the spec now demands ("at most 1/5 of the
 * viewport, minimum 150px, every tick visible even at 1px").
 *
 * So this builder inverts the formulation: pixel budgets are decided FIRST, then time is mapped onto
 * them. The axis becomes a chain of alternating GAP and LENS segments, each with a fixed time span and a
 * fixed pixel width, and `pctFor` is piecewise-linear across that chain.
 *
 * The tradeoff is deliberate: we give up C¹ smoothness (density is now piecewise-constant, so the pace
 * changes abruptly at a lens edge) in exchange for hard guarantees on tick size and exact anchoring.
 * Guarantees are what the spec asks for; smoothness only mattered for the pinch-zoom feel, which is
 * disabled on this axis anyway.
 *
 * Three properties hold by construction, not by tuning:
 *  1. `pctFor(anchorTime) === nowAnchorFrac * 100` — because the domain is split at the anchor and the
 *     left side is allocated exactly `nowAnchorFrac` of the width. No solver, no iteration.
 *  2. Every lens gets `>= minTickPx`, so no planned occurrence can vanish.
 *  3. Total width is exactly the viewport, so the whole horizon always fits with no scrolling.
 */
export const LENS = {
  /** How far back the horizon reaches from the anchor. */
  pastMs: 12 * HOUR_MS,
  /** Hard future cap — "be reasonable, at most the next 6 months". Panning moves the anchor, not this. */
  futureCapMs: 182 * DAY_MS,
  /** Never show less future than this, even with no marks at all. */
  minFutureMs: 36 * HOUR_MS,
  /** Fraction of the width at which the anchor (normally NOW) sits. */
  nowAnchorFrac: 1 / 3,
  /** A lens targets `max(minLensPx, viewportW * maxLensFrac)`. The floor wins on narrow viewports. */
  minLensPx: 150,
  maxLensFrac: 1 / 5,
  /** Absolute floor per lens once budgets are scaled down — guarantees visibility. */
  minTickPx: 1,
  /** Two lenses whose rendered gap would be thinner than this merge into one. */
  mergeGapPx: 24,
  /** Dead space still gets a sliver so adjacent lenses read as separate. */
  minGapPx: 6,
  /** Padding past the last mark so a trailing tick isn't flush against the edge. */
  tailPadMs: 12 * HOUR_MS,
  /**
   * Nominal time span given to a ZERO-DURATION mark (an Instant, or an `at`/`due` point). Without it the
   * lens is degenerate: it still consumes a full pixel budget, but `pctFor(start) === pctFor(end)` so the
   * tick measures 0px wide and the budget is spent on nothing. Widening it into a real window also matches
   * intent — for a moment in time you want to see the hours AROUND it, which is what a lens is for.
   */
  pointSpanMs: 2 * HOUR_MS,
} as const

type Seg = { t0: number; t1: number; x0: number; x1: number; lens: boolean }
export type LensWarp = TimeWarp & {
  /** Merged, clipped focus intervals actually rendered as lenses (epoch ms). For label anchoring. */
  lenses: { start: number; end: number }[]
  /** The time pinned at `nowAnchorFrac`. Equals `now` until the user pans. */
  anchorTime: number
}

/**
 * Allocate one side of the anchor. `sideW` px must cover exactly `[t0, t1]`, containing `lenses`
 * (already clipped to the side and sorted). Emits the alternating gap/lens chain.
 *
 * Budgeting is a straight proportional-scaling problem: lenses ask for `want` each; if the total ask
 * exceeds what's left after reserving a minimum gap sliver, every lens is scaled by the same factor
 * (floored at `minTickPx`). Whatever remains goes to the gaps in proportion to their DURATION, so a
 * three-month dead span still reads as longer than a two-day one.
 */
function allocSide(
  t0: number,
  t1: number,
  sideW: number,
  lenses: { start: number; end: number }[],
  want: number,
  out: Seg[],
): void {
  if (sideW <= 0) return
  if (!lenses.length) {
    out.push({ t0, t1, x0: 0, x1: sideW, lens: false })
    return
  }
  const nGaps = lenses.length + 1
  const reserved = Math.min(sideW * 0.5, nGaps * LENS.minGapPx)
  const askTotal = lenses.length * want
  const lensBudget = Math.max(0, sideW - reserved)
  const scale = askTotal > lensBudget ? lensBudget / askTotal : 1
  const lensPx = lenses.map(() => Math.max(LENS.minTickPx, want * scale))

  // Gap durations, including the two edge gaps. Negative slivers clamp to 0.
  const gapMs: number[] = []
  let cursor = t0
  for (const l of lenses) {
    gapMs.push(Math.max(0, l.start - cursor))
    cursor = l.end
  }
  gapMs.push(Math.max(0, t1 - cursor))
  const gapMsTotal = gapMs.reduce((a, b) => a + b, 0)
  const gapPxTotal = Math.max(0, sideW - lensPx.reduce((a, b) => a + b, 0))
  // Duration-proportional when there IS dead time; otherwise split evenly so we never divide by zero.
  const gapPx = gapMs.map((ms) => (gapMsTotal > 0 ? (ms / gapMsTotal) * gapPxTotal : gapPxTotal / nGaps))

  let x = 0
  cursor = t0
  for (let i = 0; i < lenses.length; i++) {
    if (gapPx[i] > 0 || gapMs[i] > 0) {
      out.push({ t0: cursor, t1: cursor + gapMs[i], x0: x, x1: x + gapPx[i], lens: false })
      x += gapPx[i]
      cursor += gapMs[i]
    }
    out.push({ t0: lenses[i].start, t1: lenses[i].end, x0: x, x1: x + lensPx[i], lens: true })
    x += lensPx[i]
    cursor = lenses[i].end
  }
  // Trailing edge gap. Ends exactly at `sideW` so the chain closes with no rounding drift.
  out.push({ t0: cursor, t1, x0: x, x1: sideW, lens: false })
}

/**
 * Build the absolute-pixel fisheye axis.
 *
 * @param now        Current time — bounds the horizon and is the default anchor.
 * @param marks      Focus intervals (planned occurrences, and sessions when that rail is shown).
 * @param viewportW  Lane width in px. Budgets are meaningless without it, so this is required.
 * @param anchorTime Time to pin at `nowAnchorFrac`; defaults to `now`. Panning passes a shifted value.
 */
export function buildLensWarp(
  now: number,
  marks: HorizonMark[],
  viewportW: number,
  anchorTime: number = now,
): LensWarp | null {
  if (!(viewportW > 0)) return null

  // ── Domain. Future is content-driven but hard-capped at 6 months; past is fixed. The anchor can be
  // panned outside [now-past, now+cap], so the domain is widened to always contain it.
  const lastMark = marks.reduce((mx, m) => Math.max(mx, m.end ?? m.start), Number.NEGATIVE_INFINITY)
  const futureWanted = Number.isFinite(lastMark)
    ? Math.min(LENS.futureCapMs, Math.max(LENS.minFutureMs, lastMark + LENS.tailPadMs - now))
    : LENS.minFutureMs
  const lo = Math.min(now - LENS.pastMs, anchorTime - LENS.pastMs)
  const hi = Math.max(now + futureWanted, anchorTime + LENS.minFutureMs)
  if (hi <= lo) return null
  const anchor = Math.min(hi, Math.max(lo, anchorTime))

  // ── Focus intervals: clip to domain, give points a nominal span, sort, drop empties.
  let ivals = marks
    // Drop marks that don't overlap the domain BEFORE clamping. Filtering after would let an occurrence
    // months past the 6-month cap survive as a phantom lens pinned to the right edge (it clamps to
    // start===end===hi, which the point-widening below then inflates into a real window).
    .filter((m) => m.start < hi && (m.end ?? m.start) > lo)
    .map((m) => {
      const s = Math.max(lo, Math.min(hi, m.start))
      const e = Math.max(lo, Math.min(hi, m.end ?? m.start))
      // Zero-duration marks become a centered window (see LENS.pointSpanMs), then re-clip to the domain.
      if (e - s < LENS.pointSpanMs) {
        const mid = (s + e) / 2
        const half = LENS.pointSpanMs / 2
        return {
          start: Math.max(lo, Math.min(hi - LENS.pointSpanMs, mid - half)),
          end: Math.min(hi, Math.max(lo + LENS.pointSpanMs, mid + half)),
        }
      }
      return { start: s, end: Math.max(s, e) }
    })
    .filter((i) => i.start < hi && i.end > lo)
    .sort((a, b) => a.start - b.start)

  const want = Math.max(LENS.minLensPx, viewportW * LENS.maxLensFrac)

  // ── MERGE PASS. Whether two lenses are "too close" depends on the gap's rendered width, which depends
  // on the allocation, which depends on the lens set — circular. Resolve by iterating: estimate dead-space
  // pace from the current set, merge the single worst offender, repeat. Each pass strictly shrinks the set,
  // so this terminates; the loop bound is just belt-and-braces.
  for (let pass = 0; pass < ivals.length + 1 && ivals.length > 1; pass++) {
    const lensMs = ivals.reduce((a, i) => a + (i.end - i.start), 0)
    const deadMs = Math.max(1, hi - lo - lensMs)
    const deadPx = Math.max(0, viewportW - Math.min(viewportW, ivals.length * want))
    const pxPerMs = deadPx / deadMs
    let worst = -1
    let worstPx = Infinity
    for (let i = 1; i < ivals.length; i++) {
      const gPx = Math.max(0, ivals[i].start - ivals[i - 1].end) * pxPerMs
      if (gPx < worstPx) {
        worstPx = gPx
        worst = i
      }
    }
    if (worst < 0 || worstPx >= LENS.mergeGapPx) break
    ivals.splice(worst - 1, 2, {
      start: ivals[worst - 1].start,
      end: Math.max(ivals[worst - 1].end, ivals[worst].end),
    })
  }
  // Overlapping intervals would break monotonicity of the segment chain, so coalesce any that touch.
  ivals = ivals.reduce<{ start: number; end: number }[]>((acc, i) => {
    const prev = acc[acc.length - 1]
    if (prev && i.start <= prev.end) prev.end = Math.max(prev.end, i.end)
    else acc.push({ ...i })
    return acc
  }, [])

  // ── Split at the anchor so the 1/3 rule is exact. An interval straddling the anchor is cut in two, each
  // half living in its own side's budget.
  const leftW = viewportW * LENS.nowAnchorFrac
  const left: { start: number; end: number }[] = []
  const right: { start: number; end: number }[] = []
  for (const i of ivals) {
    if (i.end <= anchor) left.push(i)
    else if (i.start >= anchor) right.push(i)
    else {
      left.push({ start: i.start, end: anchor })
      right.push({ start: anchor, end: i.end })
    }
  }

  const segs: Seg[] = []
  const leftSegs: Seg[] = []
  allocSide(lo, anchor, leftW, left, want, leftSegs)
  for (const s of leftSegs) segs.push(s)
  const rightSegs: Seg[] = []
  allocSide(anchor, hi, viewportW - leftW, right, want, rightSegs)
  for (const s of rightSegs) segs.push({ ...s, x0: s.x0 + leftW, x1: s.x1 + leftW })

  // Normalize to percentages and enforce strict monotonicity for the binary searches.
  const chain = segs.filter((s) => s.t1 > s.t0 || s.x1 > s.x0)
  if (!chain.length) return null
  for (const s of chain) {
    s.x0 = (s.x0 / viewportW) * 100
    s.x1 = (s.x1 / viewportW) * 100
  }
  const totalPxPerMs = 100 / Math.max(1, hi - lo)

  const pctFor = (t: number): number => {
    if (t <= lo) return 0
    if (t >= hi) return 100
    let a = 0
    let b = chain.length - 1
    while (a < b) {
      const m = (a + b) >> 1
      if (chain[m].t1 <= t) a = m + 1
      else b = m
    }
    const s = chain[a]
    const dt = s.t1 - s.t0
    if (dt <= 0) return s.x0
    return s.x0 + ((t - s.t0) / dt) * (s.x1 - s.x0)
  }

  const timeAt = (pct: number): number => {
    if (pct <= 0) return lo
    if (pct >= 100) return hi
    let a = 0
    let b = chain.length - 1
    while (a < b) {
      const m = (a + b) >> 1
      if (chain[m].x1 <= pct) a = m + 1
      else b = m
    }
    const s = chain[a]
    const dx = s.x1 - s.x0
    if (dx <= 0) return s.t0
    return s.t0 + ((pct - s.x0) / dx) * (s.t1 - s.t0)
  }

  const densityAt = (t: number): number => {
    const tc = Math.min(hi, Math.max(lo, t))
    let a = 0
    let b = chain.length - 1
    while (a < b) {
      const m = (a + b) >> 1
      if (chain[m].t1 <= tc) a = m + 1
      else b = m
    }
    const s = chain[a]
    const dt = s.t1 - s.t0
    if (dt <= 0) return 1
    return ((s.x1 - s.x0) / dt) / totalPxPerMs
  }

  return { start: lo, end: hi, pctFor, timeAt, densityAt, lenses: ivals, anchorTime: anchor }
}
