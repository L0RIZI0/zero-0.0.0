import { clamp, lerp, smoothstep } from "./time";

/** Hann (raised cosine) with compact support on [-1, 1]. Integral over support = 1. */
export function hann(u: number): number {
  if (u <= -1 || u >= 1) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * u));
}

/** ∫_{-∞}^{u} hann(s) ds, so hannCum(1) = 1. */
export function hannCum(u: number): number {
  if (u <= -1) return 0;
  if (u >= 1) return 1;
  return 0.5 * (u + 1) + Math.sin(Math.PI * u) / (2 * Math.PI);
}

function intervalDensity(t: number, s: number, e: number, ramp: number): number {
  if (t < s - ramp || t > e + ramp) return 0;
  if (t < s) return hann((t - s) / ramp);
  if (t > e) return hann((t - e) / ramp);
  return 1;
}

/**
 * Empty-time weight vs. current zoom.
 * Hours/day stay close to linear so hour marks remain readable.
 * Week and wider: empty stretches collapse hard against busy ones.
 */
export function emptyWeightForSpan(spanMs: number, warpStrength: number): number {
  const days = Math.max(spanMs / 86_400_000, 0.01);
  const t = smoothstep(
    (Math.log(days) - Math.log(0.4)) / (Math.log(12) - Math.log(0.4)),
  );
  const empty = lerp(0.5, 0.008, t);
  return lerp(1, empty, clamp(warpStrength, 0, 1));
}

export function nowLensHalfWidth(spanMs: number): number {
  return clamp(spanMs * 0.16, 40 * 60 * 1000, spanMs * 0.28);
}

/**
 * Density-weighted time warp.
 *
 * W(t) = ∫ (empty + busy bumps) dτ
 * Screen mapping uses W so busy intervals claim more pixels and empty ones coil up.
 *
 * The CDF is rebuilt for the current window (plus padding) at a fixed sample
 * count — cheap enough to do every frame while dragging, and accurate at
 * every zoom from ~20 minutes to a century.
 */
export class WarpField {
  t0 = 0;
  t1 = 1;
  n = 0;
  emptyWeight = 0.08;
  busyWeight = 1;
  private cdf = new Float64Array(0);
  private dens = new Float64Array(0);
  total = 1;

  configure(t0: number, t1: number, n = 2304) {
    if (t1 <= t0) t1 = t0 + 1;
    this.t0 = t0;
    this.t1 = t1;
    this.n = n;
    if (this.cdf.length !== n) {
      this.cdf = new Float64Array(n);
      this.dens = new Float64Array(n);
    }
  }

  rebuild(events: { start: number; end: number }[]) {
    const { n, t0, t1, dens, cdf, emptyWeight, busyWeight } = this;
    dens.fill(emptyWeight);
    const dt = (t1 - t0) / (n - 1);
    const ramp = Math.max(dt * 3.5, 20 * 60 * 1000);
    const boost = Math.max(0, busyWeight - emptyWeight);

    for (const ev of events) {
      const s = Math.min(ev.start, ev.end);
      const e = Math.max(ev.start, ev.end);
      const i0 = Math.max(0, Math.floor((s - ramp - t0) / dt));
      const i1 = Math.min(n - 1, Math.ceil((e + ramp - t0) / dt));
      if (i1 < i0) continue;
      if (i1 - i0 <= 2) {
        // Point mass so short events still register at coarse zoom.
        const i = clamp(Math.round(((s + e) * 0.5 - t0) / dt), 0, n - 1);
        dens[i] += boost * Math.max((e - s) / dt, 0.65);
        continue;
      }
      for (let i = i0; i <= i1; i++) {
        const t = t0 + i * dt;
        dens[i] += boost * intervalDensity(t, s, e, ramp);
      }
    }

    cdf[0] = 0;
    for (let i = 1; i < n; i++) {
      cdf[i] = cdf[i - 1] + 0.5 * (dens[i] + dens[i - 1]) * dt;
    }
    this.total = cdf[n - 1] || 1;
  }

  private index(t: number): { i: number; f: number } {
    const u = ((t - this.t0) / (this.t1 - this.t0)) * (this.n - 1);
    const i = clamp(Math.floor(u), 0, this.n - 2);
    return { i, f: clamp(u - i, 0, 1) };
  }

  /** Cumulative warp W(t) without the now-lens. */
  at(t: number): number {
    if (t <= this.t0) return (t - this.t0) * this.emptyWeight;
    if (t >= this.t1) return this.total + (t - this.t1) * this.emptyWeight;
    const { i, f } = this.index(t);
    return this.cdf[i] * (1 - f) + this.cdf[i + 1] * f;
  }

  densityAt(t: number): number {
    if (t <= this.t0 || t >= this.t1) return this.emptyWeight;
    const { i, f } = this.index(t);
    return this.dens[i] * (1 - f) + this.dens[i + 1] * f;
  }
}

export type Lens = { now: number; halfWidth: number; amp: number };

export function lensDensity(t: number, lens: Lens): number {
  if (lens.amp <= 0 || lens.halfWidth <= 0) return 0;
  return lens.amp * hann((t - lens.now) / lens.halfWidth);
}

export function lensW(t: number, lens: Lens): number {
  if (lens.amp <= 0 || lens.halfWidth <= 0) return 0;
  return lens.amp * lens.halfWidth * hannCum((t - lens.now) / lens.halfWidth);
}

export function lensAmpForSpan(spanMs: number): number {
  const days = spanMs / 86_400_000;
  if (days < 2) return 1.55;
  if (days > 400) return 4.2;
  return lerp(1.55, 4.2, smoothstep(Math.log(days / 2) / Math.log(200)));
}

export const BUSY_WEIGHT = 1.35;
