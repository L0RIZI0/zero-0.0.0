import type { TickMark, TickUnit } from "./types";
import {
  addUnit,
  floorTo,
  formatTickLabel,
  HOUR,
  unitApproxMs,
} from "./time";

type Level = { unit: TickUnit; step: number; major: boolean; label: boolean };

export type LabelLane = "year" | "month" | "day" | "time";

const LEVELS: Level[] = [
  { unit: "year", step: 10, major: true, label: true },
  { unit: "year", step: 5, major: true, label: true },
  { unit: "year", step: 1, major: true, label: true },
  { unit: "month", step: 3, major: true, label: true },
  { unit: "month", step: 1, major: true, label: true },
  { unit: "week", step: 1, major: true, label: true },
  { unit: "day", step: 1, major: true, label: true },
  { unit: "hour", step: 12, major: true, label: true },
  { unit: "hour", step: 6, major: true, label: true },
  { unit: "hour", step: 3, major: true, label: true },
  { unit: "hour", step: 1, major: true, label: true },
  { unit: "minute", step: 30, major: false, label: true },
  { unit: "minute", step: 15, major: false, label: true },
  { unit: "minute", step: 5, major: false, label: false },
];

export function labelLane(unit: TickUnit): LabelLane {
  if (unit === "year") return "year";
  if (unit === "month") return "month";
  if (unit === "hour" || unit === "minute") return "time";
  return "day";
}

function labelMinPx(unit: TickUnit, spanMs: number): number {
  if (unit === "hour" && spanMs < 2 * 86_400_000) return 28;
  if (unit === "hour") return 44;
  if (unit === "minute") return 44;
  if (unit === "day" && spanMs < 12 * 86_400_000) return 48;
  return 64;
}

export function buildTicks(
  tLeft: number,
  tRight: number,
  spanMs: number,
  timeToX: (t: number) => number,
  width: number,
  measure: (label: string) => number,
): TickMark[] {
  const padT = spanMs * 0.08;
  const a = tLeft - padT;
  const b = tRight + padT;
  const ticks: TickMark[] = [];
  const usedLabel: Record<LabelLane, { x0: number; x1: number }[]> = {
    year: [],
    month: [],
    day: [],
    time: [],
  };
  const usedMajorX: number[] = [];

  const collides = (lane: LabelLane, x0: number, x1: number) =>
    usedLabel[lane].some((u) => x0 < u.x1 && x1 > u.x0);

  for (const level of LEVELS) {
    const approx = unitApproxMs(level.unit, level.step);
    const avgPx = (approx / spanMs) * width;
    if (avgPx < 3 && level.unit !== "year") continue;
    if (avgPx > width * 1.8) continue;
    if (level.unit === "week") {
      const dayPx = (unitApproxMs("day", 1) / spanMs) * width;
      if (dayPx >= labelMinPx("day", spanMs) * 0.6) continue;
    }
    const lane = labelLane(level.unit);

    let t = floorTo(a, level.unit, level.step);
    let guard = 0;
    while (t <= b && guard++ < 5000) {
      const isDay = level.unit === "day" && level.step === 1;
      const xTick = timeToX(t);
      const labelT = isDay ? t + 12 * HOUR : t;
      const x = isDay ? timeToX(labelT) : xTick;
      if (xTick >= -80 && xTick <= width + 80) {
        const localPx = Math.abs(timeToX(t + approx) - xTick);
        const room = level.major ? 7 : 3.5;
        if (localPx >= room) {
          const tooCloseMajor =
            !isDay &&
            usedMajorX.some((mx) => Math.abs(mx - xTick) < 6);
          if (!tooCloseMajor) {
            let label: string | undefined;
            let labelWidth = 0;
            const minPx = labelMinPx(level.unit, spanMs);
            const labelOk =
              level.label &&
              localPx >= minPx &&
              x > 8 &&
              x < width - 8;
            if (labelOk) {
              const text = formatTickLabel(isDay ? t : labelT, level.unit, spanMs);
              const w = measure(text);
              const pad = lane === "time" ? 5 : 7;
              const x0 = x - w * 0.5 - pad;
              const x1 = x + w * 0.5 + pad;
              if (!collides(lane, x0, x1)) {
                label = text;
                labelWidth = w;
                usedLabel[lane].push({ x0, x1 });
              }
            }
            if (isDay) {
              ticks.push({
                t,
                x: xTick,
                unit: "day",
                major: true,
                boundary: true,
                drawTick: true,
                labelWidth: 0,
              });
              if (label) {
                ticks.push({
                  t: labelT,
                  x,
                  unit: "day",
                  major: false,
                  drawTick: false,
                  label,
                  labelWidth,
                });
              }
            } else {
              const near = ticks.find((tk) => tk.drawTick !== false && Math.abs(tk.x - xTick) < 4);
              if (near) {
                if (label) {
                  ticks.push({
                    t: labelT,
                    x,
                    unit: level.unit,
                    major: false,
                    drawTick: false,
                    label,
                    labelWidth,
                  });
                }
              } else {
                ticks.push({
                  t,
                  x: xTick,
                  unit: level.unit,
                  major: level.major && localPx >= 16,
                  label,
                  labelWidth,
                  drawTick: true,
                });
                if (level.major) usedMajorX.push(xTick);
              }
            }
          }
        }
      }
      t = addUnit(t, level.unit, level.step);
    }
  }

  ticks.sort((p, q) => p.x - q.x);
  return ticks;
}

/** Time-based grain so empty (coiled) regions pack ticks tighter. */
export function coilUnit(spanMs: number): { unit: TickUnit; step: number } {
  const day = 86_400_000;
  const hour = 3_600_000;
  if (spanMs < 3 * hour) return { unit: "minute", step: 5 };
  if (spanMs < 16 * hour) return { unit: "minute", step: 15 };
  if (spanMs < 3 * day) return { unit: "hour", step: 1 };
  if (spanMs < 16 * day) return { unit: "hour", step: 3 };
  if (spanMs < 50 * day) return { unit: "hour", step: 12 };
  if (spanMs < 200 * day) return { unit: "day", step: 1 };
  if (spanMs < 800 * day) return { unit: "week", step: 1 };
  return { unit: "month", step: 1 };
}
