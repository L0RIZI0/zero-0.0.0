import { z } from "zod"

/**
 * NL → schedule parsing contract (shared by the API route and the client store).
 *
 * The model emits RELATIVE, timezone-free fields only — a time-of-day (`startHour`/
 * `startMinute`), a duration, and a small RRULE-subset `repeat` rule whose end is
 * expressed as "in N days" rather than an absolute date. The CLIENT (which knows the
 * user's real local "today" and timezone) converts these into the absolute epoch-ms
 * `Schedule` Zero stores. This keeps the LLM from hallucinating epoch timestamps or
 * guessing the user's timezone, and matches Zero's existing rule-as-truth model:
 * we persist ONE entity carrying a `repeat` rule, and occurrences stay virtual
 * (expanded on demand by getTimelineOccurrences / dayMatchesRecurrence).
 *
 * Weekday convention matches `Recurrence.byWeekday`: 0 = Sunday … 6 = Saturday.
 *
 * NOTE: every field is required + `.nullable()` (never `.optional()`) because
 * OpenAI structured-output mode requires all keys to be present in the object.
 */
export const recurrenceParseSchema = z.object({
  freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
  /** Every N units of `freq`. null ⇒ 1. */
  interval: z.number().int().min(1).max(366).nullable(),
  /** Weekly rules: weekdays 0(Sun)–6(Sat). "weekdays" ⇒ [1,2,3,4,5], "weekends" ⇒ [0,6]. */
  byWeekday: z.array(z.number().int().min(0).max(6)).nullable(),
  /** End of the series, in days from today (inclusive). null ⇒ indefinite ("forever"). */
  untilInDays: z.number().int().min(1).nullable(),
})

export const scheduleParseSchema = z.object({
  /** False when the text is NOT about timing/scheduling at all (so the caller keeps a plain task). */
  isSchedule: z.boolean(),
  /** The cleaned entity title with all scheduling words stripped (e.g. "Workout", not "Plan 1h Workout every weekday"). */
  title: z.string(),
  /** event ⇒ a timed span; instant ⇒ a single point in time; task ⇒ a to-do with an optional due date. */
  kind: z.enum(["event", "instant", "task"]),
  /** Time of day the (first) occurrence starts, 0–23. null ⇒ the client picks a sensible default. */
  startHour: z.number().int().min(0).max(23).nullable(),
  startMinute: z.number().int().min(0).max(59).nullable(),
  /** Span length in minutes for an `event`. null ⇒ client default (60). Ignored for instant/task. */
  durationMinutes: z.number().int().min(1).max(1440).nullable(),
  /** For a one-off `task`: due in N days from today. null ⇒ no due date. Ignored when `repeat` is set. */
  dueInDays: z.number().int().min(0).max(3650).nullable(),
  /** The recurrence rule, or null for a one-off. */
  repeat: recurrenceParseSchema.nullable(),
  /** One short human-readable sentence summarising what was understood (shown to the user). */
  summary: z.string(),
})

export type ScheduleParse = z.infer<typeof scheduleParseSchema>
export type RecurrenceParse = z.infer<typeof recurrenceParseSchema>

/**
 * Cheap client-side gate: does this text plausibly describe a schedule/recurrence?
 * Used to AVOID an LLM round-trip on every ordinary task title. Deliberately
 * permissive — a false positive just costs one parse that returns isSchedule:false.
 */
const SCHEDULE_HINT =
  /\b(every|each|daily|weekly|monthly|yearly|annually|hourly|weekday|weekdays|weekend|weekends|recurring|repeat|mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|at \d|[0-9](?:am|pm)|o'clock|noon|midnight|indefinitely|until|for the next|starting)\b/i

export function looksLikeSchedule(text: string): boolean {
  return SCHEDULE_HINT.test(text)
}
