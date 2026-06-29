import { generateObject } from "ai"
import { scheduleParseSchema } from "@/lib/zero/schedule-parse"

// NL → schedule parser. Takes a free-text phrase ("Plan 1h Workout sessions for every
// weekday except weekends indefinitely") and returns the normalized, timezone-free
// ScheduleParse the client store turns into a Zero entity + Recurrence rule.
//
// Uses the Vercel AI Gateway (default global provider) — a bare model string, authed by
// the project's AI Gateway key. No provider package required.

export const runtime = "nodejs"
export const maxDuration = 30

const SYSTEM = `You convert a single short natural-language phrase into a structured scheduling plan for a personal timeline app.

Rules:
- Set isSchedule=false ONLY if the text has nothing to do with time, dates, or repetition (then still fill title with the text and leave time fields null). Otherwise isSchedule=true.
- title: the bare subject with ALL scheduling words removed. "Plan 1h Workout every weekday" -> "Workout". "Call mom every Sunday at 6pm" -> "Call mom".
- kind: "event" for a discrete appointment with a duration or clear time block (workout, meeting, focus block). "instant" for a momentary reminder/ping with no duration. "task" for a to-do that is not really time-blocked. "space" for an ongoing AREA OF WORK that recurs as one or more daily time blocks (e.g. "Day Job", "Studio time").
- blocks: use this for MULTI-BLOCK days — two or more separate spans on the SAME day, e.g. "Day Job every weekday 8:00–11:30 and 13:30–18:00" -> blocks=[{startHour:8,startMinute:0,endHour:11,endMinute:30},{startHour:13,startMinute:30,endHour:18,endMinute:0}], kind="space". For a single span leave blocks=null and use startHour/durationMinutes. When you fill blocks, you may leave startHour/startMinute/durationMinutes null.
- Weekdays use 0=Sunday,1=Monday,2=Tuesday,3=Wednesday,4=Thursday,5=Friday,6=Saturday. "weekdays" -> [1,2,3,4,5]. "weekends" -> [0,6]. "every day" -> daily freq (NOT weekly with all 7).
- repeat: fill it whenever the phrase repeats ("every", "daily", "each Monday", "weekly"...). freq is daily/weekly/monthly/yearly. Use byWeekday only for weekly rules. "indefinitely"/"forever"/no end -> untilInDays=null. "for the next 30 days" -> untilInDays=30. "for a year" -> untilInDays=365.
- A one-off (no repetition) -> repeat=null. A one-off task with a deadline -> set dueInDays.
- durationMinutes: parse "1h"->60, "30 min"->30, "an hour and a half"->90. null if no duration is implied.
- startHour/startMinute: parse "6pm"->18:0, "9:30am"->9:30, "noon"->12:0. null if no time of day is given.
- summary: ONE short sentence describing exactly what you understood, e.g. "Workout, 1h every weekday, indefinitely.".
Be literal; do not invent times or durations that were not stated (leave them null).`

export async function POST(req: Request) {
  let text = ""
  try {
    const body = (await req.json()) as { text?: unknown }
    text = typeof body.text === "string" ? body.text.trim() : ""
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!text) return Response.json({ error: "Missing `text`" }, { status: 400 })
  if (text.length > 500) text = text.slice(0, 500)

  try {
    const { object } = await generateObject({
      model: "openai/gpt-5.4-mini",
      schema: scheduleParseSchema,
      system: SYSTEM,
      prompt: text,
    })
    return Response.json(object)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.log("[v0] parse-schedule failed:", message)
    // The AI Gateway gates requests behind account setup (e.g. "requires a valid credit
    // card on file"). Surface that as a distinct, actionable status so the UI can tell a
    // setup problem apart from a genuine parse failure (and so it isn't mistaken for a code bug).
    const isSetup = /credit card|payment|quota|billing|unlock your free credits/i.test(message)
    return Response.json(
      { error: isSetup ? "AI Gateway not set up for this project yet." : "Could not parse schedule", detail: message },
      { status: isSetup ? 402 : 502 },
    )
  }
}
