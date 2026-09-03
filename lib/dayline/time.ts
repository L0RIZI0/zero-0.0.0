import type { TickUnit } from "./types";

export const TZ = "Europe/Zurich";
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

const WD_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const WD_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};
const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
  weekdayIndex: number;
};

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function zonedParts(ms: number): ZonedParts {
  const p = partsFmt.formatToParts(new Date(ms));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const weekday = get("weekday");
  return {
    year: +get("year"),
    month: +get("month"),
    day: +get("day"),
    hour: +get("hour"),
    minute: +get("minute"),
    weekday,
    weekdayIndex: WD_INDEX[weekday] ?? 0,
  };
}

/** Construct a timestamp whose wall-clock in Zurich is the given Y-M-D H:m. */
export function zonedDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  const utc = Date.UTC(year, month - 1, day, hour, minute);
  const d = new Date(utc);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const da = d.getUTCDate();
  const ho = d.getUTCHours();
  const mi = d.getUTCMinutes();
  const iso = `${y}-${pad(m)}-${pad(da)}T${pad(ho)}:${pad(mi)}:00`;
  const utcGuess = Date.parse(`${iso}Z`);
  const parts = zonedParts(utcGuess);
  const asIf = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  const want = Date.UTC(y, m - 1, da, ho, mi);
  return utcGuess + (want - asIf);
}

export function startOfDay(ms: number): number {
  const p = zonedParts(ms);
  return zonedDate(p.year, p.month, p.day);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addHours(ms: number, n: number): number {
  return ms + n * HOUR;
}

export function addDays(ms: number, n: number): number {
  const p = zonedParts(ms);
  const utc = Date.UTC(p.year, p.month - 1, p.day + n, p.hour, p.minute);
  const d = new Date(utc);
  return zonedDate(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    p.hour,
    p.minute,
  );
}

export function addMonths(ms: number, n: number): number {
  const p = zonedParts(ms);
  let y = p.year;
  let m = p.month + n;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  const d = Math.min(p.day, daysInMonth(y, m));
  return zonedDate(y, m, d, p.hour, p.minute);
}

export function addYears(ms: number, n: number): number {
  const p = zonedParts(ms);
  const d = Math.min(p.day, daysInMonth(p.year + n, p.month));
  return zonedDate(p.year + n, p.month, d, p.hour, p.minute);
}

export function floorTo(ms: number, unit: TickUnit, step = 1): number {
  const p = zonedParts(ms);
  switch (unit) {
    case "year": {
      const y = Math.floor(p.year / step) * step;
      return zonedDate(y, 1, 1);
    }
    case "month":
      return zonedDate(p.year, p.month, 1);
    case "week": {
      const day = zonedDate(p.year, p.month, p.day);
      return day - p.weekdayIndex * DAY;
    }
    case "day":
      return zonedDate(p.year, p.month, p.day);
    case "hour": {
      const h = Math.floor(p.hour / step) * step;
      return zonedDate(p.year, p.month, p.day, h);
    }
    case "minute": {
      const m = Math.floor(p.minute / step) * step;
      return zonedDate(p.year, p.month, p.day, p.hour, m);
    }
  }
}

export function addUnit(ms: number, unit: TickUnit, step = 1): number {
  switch (unit) {
    case "year":
      return addYears(ms, step);
    case "month":
      return addMonths(ms, step);
    case "week":
      return addDays(ms, 7 * step);
    case "day":
      return addDays(ms, step);
    case "hour":
      return addHours(ms, step);
    case "minute":
      return ms + step * MINUTE;
  }
}

export function unitApproxMs(unit: TickUnit, step = 1): number {
  switch (unit) {
    case "year":
      return step * 365.25 * DAY;
    case "month":
      return step * 30.4375 * DAY;
    case "week":
      return step * 7 * DAY;
    case "day":
      return step * DAY;
    case "hour":
      return step * HOUR;
    case "minute":
      return step * MINUTE;
  }
}

export function formatTickLabel(ms: number, unit: TickUnit, spanMs: number): string {
  const p = zonedParts(ms);
  const month = MONTHS[p.month - 1] ?? "";
  const wd = p.weekday.toUpperCase();
  const showYear = spanMs > 40 * DAY;
  switch (unit) {
    case "year":
      return String(p.year);
    case "month":
      return showYear || p.month === 1 ? `${month} ${p.year}` : month;
    case "week":
    case "day":
      if (spanMs > 180 * DAY) return `${month} ${p.day}`;
      if (showYear) return `${wd} ${month} ${pad(p.day)} ${p.year}`;
      return `${wd} ${month} ${pad(p.day)}`;
    case "hour":
      return `${pad(p.hour)}:${pad(p.minute)}`;
    case "minute":
      return `${pad(p.hour)}:${pad(p.minute)}`;
  }
}

export function formatHm(ms: number): string {
  const p = zonedParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatRange(start: number, end: number): string {
  const a = zonedParts(start);
  const b = zonedParts(end);
  const sameDay =
    a.year === b.year && a.month === b.month && a.day === b.day;
  const left = `${WD_SHORT[a.weekdayIndex]} ${pad(a.day)} ${MONTHS[a.month - 1]}  ${pad(a.hour)}:${pad(a.minute)}`;
  if (sameDay) return `${left} – ${pad(b.hour)}:${pad(b.minute)}`;
  return `${left} → ${WD_SHORT[b.weekdayIndex]} ${pad(b.day)} ${MONTHS[b.month - 1]}  ${pad(b.hour)}:${pad(b.minute)}`;
}

export function formatClock(ms: number): string {
  const p = zonedParts(ms);
  return `${WD_SHORT[p.weekdayIndex]} ${pad(p.day)} ${MONTHS[p.month - 1]} ${p.year}   ${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatSpan(ms: number): string {
  const hours = ms / HOUR;
  const days = ms / DAY;
  if (hours < 36) {
    if (hours < 1.5) return `${Math.round(ms / MINUTE)} minutes`;
    const n = hours < 10 ? hours.toFixed(1).replace(/\.0$/, "") : String(Math.round(hours));
    return `${n} hours`;
  }
  if (days < 12) {
    const n = days < 4 ? days.toFixed(1).replace(/\.0$/, "") : String(Math.round(days));
    return `${n} days`;
  }
  if (days < 70) return `${Math.round(days / 7)} weeks`;
  if (days < 500) return `${Math.round(days / 30.4)} months`;
  const years = days / 365.25;
  const n = years < 10 ? years.toFixed(1).replace(/\.0$/, "") : String(Math.round(years));
  return `${n} years`;
}

export function snapTime(ms: number, spanMs: number): number {
  let step = 15 * MINUTE;
  if (spanMs < 6 * HOUR) step = 5 * MINUTE;
  else if (spanMs > 10 * DAY) step = HOUR;
  else if (spanMs > 45 * DAY) step = 3 * HOUR;
  else if (spanMs > 120 * DAY) step = DAY;
  return Math.round(ms / step) * step;
}

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function expDamp(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt);
}
