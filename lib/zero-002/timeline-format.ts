import type { Recurrence } from "./types"

// ============================================================================
// Shared presentation helpers for the timeline + dayline, so both surfaces
// render the SAME hover-helper text and the SAME "now" accent.
// ============================================================================

/** The "now" marker accent — a bright, discrete orange shared by the timeline
 *  and the dayline so the live-time indicator reads identically on both. */
export const NOW_COLOR = "oklch(0.705 0.188 45)"

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })

/** Human rule for a recurrence ("Every day", "Every Mon, Wed", "Every 2 weeks", …). */
export function ruleText(r: Recurrence): string {
  const n = Math.max(1, r.interval ?? 1)
  switch (r.freq) {
    case "daily":
      return n === 1 ? "Every day" : `Every ${n} days`
    case "weekly":
      if (r.byWeekday?.length) return `Every ${r.byWeekday.map((d) => WD[d]).join(", ")}`
      return n === 1 ? "Every week" : `Every ${n} weeks`
    case "monthly":
      return n === 1 ? "Every month" : `Every ${n} months`
    case "yearly":
      return n === 1 ? "Every year" : `Every ${n} years`
  }
}

/** A helper's time text: a start–end range, a single instant time, or — for a
 *  recurring item — the rule plus the occurrence time. This is the SPAN-in-time
 *  string shown for every chip/tick helper across the timeline and dayline. */
export function rangeText(start: number, end: number, repeat?: Recurrence): string {
  if (repeat) return `${ruleText(repeat)} · ${fmtTime(start)}`
  if (end > start) return `${fmtTime(start)} – ${fmtTime(end)}`
  return fmtTime(start)
}
