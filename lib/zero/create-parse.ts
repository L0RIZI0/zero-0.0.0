import type { EntityKind, Schedule } from "./types"

/**
 * CREATE-FIELD PARSER — the "terminal hybrid" grammar for the inline create row.
 *
 * Zero's create field is more than a name box: typing a PAST-TENSE ACTIVITY with a
 * time PARAMETER turns it into an archive entry — an already-`Done` entity spanning
 * (or pointing at) the given time. Examples:
 *
 *   "Slept --2330-0630"              → Moment, Done, 23:30 yesterday → 06:30 today
 *   "Worked on Zero prototype --1100-1730" → Task, Done, 11:00 → 17:30 today
 *   "Woke --0630"                    → Instant, Done, today 06:30
 *   "Dentist --1400"                 → Instant (NOT done — unknown verb ⇒ future point)
 *
 * GRAMMAR (this pass — deliberately small + rule-based, easy to extend):
 *   - PARAMETERS are prefixed with `--`. A param runs to the next whitespace.
 *   - A param is NAMED if it contains `=` (e.g. `--priority=high`); named params are
 *     stripped from the title but otherwise ignored for now (future-proofing).
 *   - The first UNNAMED param that reads as a time drives the schedule:
 *       · contains an inner hyphen between two clock tokens (`2330-0630`) ⇒ a SPAN.
 *       · a single clock token (`1400`)                                  ⇒ a POINT.
 *   - The FIRST WORD is matched (case-insensitive) against curated verb sets:
 *       · ACTIVE (transform/process: worked, wrote, coded…) + span ⇒ Task.
 *       · MOMENT (experience: slept, drove, walked…) or UNKNOWN + span ⇒ Moment.
 *       · any POINT param ⇒ Instant.
 *   - DONE: a recognized verb (active or moment) marks the entity `completed` — it's a
 *     logged PAST activity. An unknown verb leaves it open (so a bare point like
 *     "Dentist --1400" is a future Instant, not a done one).
 *
 * Clock tokens accept `HHMM`/`HMM` compact (`2330`, `930`), `HH:MM`, and am/pm
 * suffixes (`4pm`, `11:30pm`, `9am`), plus a bare hour (`14`, `9`).
 *
 * Pure + synchronous (no store/network); returns `null` when the text isn't a timed
 * create, so the caller falls back to the normal create path unchanged.
 */

/** Transforming / productive verbs (past tense) → a Task was performed. */
const ACTIVE_VERBS = [
  "worked", "wrote", "read", "drew", "organized", "organised", "searched", "cleaned",
  "built", "coded", "programmed", "designed", "edited", "fixed", "debugged", "planned",
  "reviewed", "studied", "researched", "drafted", "painted", "cooked", "baked",
  "practiced", "practised", "trained", "prepared", "analyzed", "analysed", "refactored",
  "tested", "shipped", "sketched", "filmed", "recorded", "taught", "learned", "learnt",
  "solved", "made", "created",
]

/** Non-transforming / experiential verbs (past tense) → a Moment was lived. */
const MOMENT_VERBS = [
  "slept", "woke", "drove", "waited", "walked", "ran", "jogged", "rested", "napped",
  "traveled", "travelled", "commuted", "sat", "watched", "listened", "relaxed",
  "meditated", "showered", "ate", "drank", "played", "exercised", "stretched", "biked",
  "swam", "hiked", "shopped", "called", "chatted", "met", "attended", "browsed", "gamed",
]

const ACTIVE_SET = new Set(ACTIVE_VERBS)
const MOMENT_SET = new Set(MOMENT_VERBS)

type VerbClass = "active" | "moment" | null

/** Classify the sentence's leading word (case-insensitive, punctuation-trimmed). */
function classifyVerb(title: string): VerbClass {
  const first = title.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? ""
  if (ACTIVE_SET.has(first)) return "active"
  if (MOMENT_SET.has(first)) return "moment"
  return null
}

/** A wall-clock time of day. */
interface Clock {
  h: number
  min: number
}

/** Parse a single clock token → {h,min}, or null if it isn't a valid time. */
function parseClock(token: string): Clock | null {
  const raw = token.trim().toLowerCase()
  if (!raw) return null
  const ampm = raw.endsWith("am") ? "am" : raw.endsWith("pm") ? "pm" : null
  const core = ampm ? raw.slice(0, -2).trim() : raw
  if (!/^\d{1,2}(:\d{2})?$|^\d{3,4}$/.test(core)) return null

  let h: number
  let min: number
  if (core.includes(":")) {
    const [hh, mm] = core.split(":")
    h = parseInt(hh, 10)
    min = parseInt(mm, 10)
  } else if (core.length <= 2) {
    h = parseInt(core, 10)
    min = 0
  } else {
    // Compact HMM / HHMM (e.g. "930" → 9:30, "2330" → 23:30, "0630" → 6:30).
    h = parseInt(core.slice(0, core.length - 2), 10)
    min = parseInt(core.slice(-2), 10)
  }
  if (ampm === "pm" && h < 12) h += 12
  if (ampm === "am" && h === 12) h = 0
  if (h > 23 || min > 59) return null
  return { h, min }
}

/** Today's local midnight, epoch ms — the anchor for all create-field times. */
function todayMidnight(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const clockToEpoch = (base: number, c: Clock) => base + c.h * 3_600_000 + c.min * 60_000
const pad = (n: number) => n.toString().padStart(2, "0")
const fmt = (c: Clock) => `${pad(c.h)}:${pad(c.min)}`

/** Parsed unnamed time param: a span (start→end) or a single point. */
type TimeParam =
  | { kind: "range"; start: Clock; end: Clock }
  | { kind: "point"; at: Clock }

/** Interpret an unnamed param value as a time range or point (or null). */
function parseTimeParam(value: string): TimeParam | null {
  // A range is two clock tokens separated by a hyphen. Compact/colon/am-pm clock
  // tokens never contain a hyphen themselves, so splitting on "-" is safe.
  if (value.includes("-")) {
    const parts = value.split("-")
    if (parts.length !== 2) return null
    const start = parseClock(parts[0])
    const end = parseClock(parts[1])
    if (!start || !end) return null
    return { kind: "range", start, end }
  }
  const at = parseClock(value)
  return at ? { kind: "point", at } : null
}

/**
 * Creatable kinds keyed by their ":xxxx" selector = the first 4 letters of the kind
 * name. Non-creatable kinds (individual, soul) are intentionally absent. All four-letter
 * keys are unique, so there's no collision.
 */
const KIND_PREFIX: Record<string, EntityKind> = {
  spac: "space",
  task: "task",
  mome: "moment",
  inst: "instant",
  reso: "resource",
  comm: "community",
  orga: "organism",
}

export interface KindPrefixParse {
  kind: EntityKind
  /** The remaining title after the ":xxxx" selector token is stripped. */
  rest: string
}

/**
 * Detect a leading ":xxxx" KIND SELECTOR as the first whitespace-delimited token —
 * ":" followed by (at least) the first 4 letters of a creatable kind name. Examples:
 *   ":spac Day Job"   → { kind: "space",     rest: "Day Job" }
 *   ":comm Friends"   → { kind: "community", rest: "Friends" }
 *   ":mome Slept --2330-0630" → { kind: "moment", rest: "Slept --2330-0630" }
 * Case-insensitive; a longer token is truncated to 4 (so ":space" and ":spac" both
 * work). Returns null when the first token isn't a recognized selector, so the caller
 * falls back to the default create path.
 */
export function parseKindPrefix(raw: string): KindPrefixParse | null {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith(":")) return null
  const spaceIdx = trimmed.search(/\s/)
  const token = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).slice(1).toLowerCase()
  const kind = KIND_PREFIX[token.slice(0, 4)]
  if (!kind) return null
  const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim()
  return { kind, rest }
}

export interface CreateFieldParse {
  /** Title with all `--params` stripped (verb kept, e.g. "Slept"). */
  title: string
  kind: EntityKind
  /** Logged past activity ⇒ true; a bare future point ⇒ false. */
  completed: boolean
  schedule: Schedule
  /** Short human confirmation, e.g. "Moment logged · 23:30–06:30". */
  summary: string
}

/**
 * Parse a create-field string into a timed-entity intent, or null if it has no
 * usable time param (⇒ caller uses the normal create path). The FIRST unnamed
 * time-like param wins; all `--params` are stripped from the resulting title.
 */
export function parseCreateField(raw: string): CreateFieldParse | null {
  // Pull every "--token" (a param runs to the next whitespace).
  const tokens = [...raw.matchAll(/--(\S+)/g)]
  if (tokens.length === 0) return null

  // First UNNAMED (no "=") param that reads as a time drives the schedule.
  let time: TimeParam | null = null
  for (const m of tokens) {
    const value = m[1]
    if (value.includes("=")) continue // named param — ignore for now
    const parsed = parseTimeParam(value)
    if (parsed) {
      time = parsed
      break
    }
  }
  if (!time) return null

  // Title = raw minus all params, whitespace collapsed.
  const title = raw.replace(/\s*--\S+/g, "").replace(/\s+/g, " ").trim()
  if (!title) return null

  const verb = classifyVerb(title)
  const completed = verb !== null // recognized past-tense verb ⇒ logged as Done
  const base = todayMidnight()

  if (time.kind === "point") {
    // A point in time is an Instant, whatever the verb.
    const at = clockToEpoch(base, time.at)
    return {
      title,
      kind: "instant",
      completed,
      schedule: { at },
      summary: `${completed ? "Instant logged" : "Instant"} · ${fmt(time.at)}`,
    }
  }

  // Range → a span. If the end is at/before the start, the span crossed midnight,
  // so anchor the START to the previous day (e.g. 23:30 yesterday → 06:30 today).
  let startAt = clockToEpoch(base, time.start)
  const endAt = clockToEpoch(base, time.end)
  if (endAt <= startAt) startAt -= 86_400_000

  // Active/transforming verb ⇒ Task; experiential or unknown ⇒ Moment.
  const kind: EntityKind = verb === "active" ? "task" : "moment"
  const label = kind === "task" ? "Task" : "Moment"
  return {
    title,
    kind,
    completed,
    schedule: { startAt, endAt },
    summary: `${label}${completed ? " logged" : ""} · ${fmt(time.start)}–${fmt(time.end)}`,
  }
}
