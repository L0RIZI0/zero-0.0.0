/** Rise/set for Lausanne (46.52°N, 6.63°E). Decorative, not ephemeris-grade. */

import { DAY, HOUR, startOfDay } from "./time";

const LAT = (46.5198 * Math.PI) / 180;

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

const _slot: { sod: number; v: { rise: number; set: number } }[] = [];

/** Day-length fraction 0–1. */
export function dayLengthFrac(ms: number): number {
  const date = new Date(ms);
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = (ms - start) / 86_400_000;
  const dec = ((23.44 * Math.PI) / 180) * Math.sin((2 * Math.PI * (doy - 81)) / 365.25);
  const x = -Math.tan(LAT) * Math.tan(dec);
  const a = Math.acos(clamp(x, -1, 1));
  return (2 * a) / (2 * Math.PI);
}

export function sunTimes(ms: number): { rise: number; set: number } {
  const sod = startOfDay(ms);
  for (let i = 0; i < _slot.length; i++) if (_slot[i].sod === sod) return _slot[i].v;
  const frac = clamp(dayLengthFrac(sod + 12 * HOUR), 0.2, 0.84);
  const half = (frac * DAY) / 2;
  const noon = sod + 12 * HOUR + 80 * 60 * 1000;
  const v = { rise: noon - half, set: noon + half };
  if (_slot.length >= 6) _slot.shift();
  _slot.push({ sod, v });
  return v;
}

/** 0 at knots, 1 at mid. */
export function sunHeight(u: number): number {
  return Math.sin(Math.PI * clamp(u, 0, 1));
}

/**
 * One sine through day and night. 0 at rise and set.
 * Night depth is night/day duration so the derivative matches at the knots —
 * no forced shallow nights, just a continuous wave.
 */
export function sunUnit(t: number): number {
  const { rise, set } = sunTimes(t);
  if (t < rise) {
    const prev = sunTimes(t - DAY);
    const dayW = Math.max(1, prev.set - prev.rise);
    const nightW = Math.max(1, rise - prev.set);
    return -(nightW / dayW) * sunHeight((t - prev.set) / nightW);
  }
  const dayW = Math.max(1, set - rise);
  if (t <= set) return sunHeight((t - rise) / dayW);
  const next = sunTimes(t + DAY);
  const nightW = Math.max(1, next.rise - set);
  return -(nightW / dayW) * sunHeight((t - set) / nightW);
}

/** −1 winter solstice, +1 summer. */
export function seasonSigned(ms: number): number {
  return clamp((dayLengthFrac(ms) - 0.5) / 0.18, -1, 1);
}
