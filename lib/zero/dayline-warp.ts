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
  bumps: DensityBump[]
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
