// ============================================================================
// Logical "day window" — the day runs 5am → 5am, not midnight → midnight.
//
// A normal day, together with its late-evening activity, lands inside ONE window
// instead of being split at midnight. So an entry made at 01:30 still belongs to
// the PREVIOUS calendar date's window: as long as the user hasn't started a fresh
// morning, the same day is still considered "going". This mirrors what the dayline
// bands and the data layer already assume elsewhere; this module is the single
// source of truth for the boundary + the bare-time resolution that depends on it.
// ============================================================================

const DAY_MS = 86_400_000

/** The hour (local) at which one logical day rolls over into the next. */
export const DAY_START_HOUR = 5

/**
 * The start instant (local) of the logical day-window that CONTAINS `now`. For any time
 * from 05:00 today up to 04:59:59 tomorrow, this is today 05:00; for 00:00–04:59 it is
 * YESTERDAY 05:00 (still the same window). Milliseconds/seconds are zeroed.
 */
export function logicalWindowStart(now: number = Date.now()): number {
  const d = new Date(now)
  d.setHours(DAY_START_HOUR, 0, 0, 0) // today @ 05:00
  if (d.getTime() > now) d.setTime(d.getTime() - DAY_MS) // before 05:00 ⇒ prior window
  return d.getTime()
}

/**
 * Place a bare wall-clock `h:min` onto the logical day-window that contains `now`, and
 * return its absolute epoch. The window spans `[winStart 05:00, winStart + 24h)`, so:
 *   - a PM / late-evening time (h ≥ 5) lands on the window's opening calendar date;
 *   - an early-morning time (h < 5) lands on the NEXT calendar date, i.e. the small hours
 *     that still belong to the same window.
 * Example — typed at Sun 01:30 (window opened Sat 05:00): "2330" → Sat 23:30 (1.5h ago,
 * as intended), and "0300" → Sun 03:00 (still this window). Absolute date tokens do NOT
 * use this — only a bare HH:MM, which has no date of its own, is anchored here.
 */
export function resolveHHMMToLogicalDay(h: number, min: number, now: number = Date.now()): number {
  const winStart = logicalWindowStart(now)
  const d = new Date(winStart)
  // winStart is at 05:00; adding a day first lets an early-morning (h < 5) time land on the
  // window's SECOND calendar date, while h ≥ 5 stays on the first.
  if (h < DAY_START_HOUR) d.setTime(d.getTime() + DAY_MS)
  d.setHours(h, min, 0, 0)
  return d.getTime()
}
