import type { EntityKind, Schedule, Recurrence } from "./types"
import { resolveHHMMToLogicalDay } from "./day-window"

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
 * Interpret an unnamed param as a RECURRENCE flag → a `Recurrence` rule (or null).
 * A recurring create pairs one of these with a time param, e.g. "Standup --daily --0900"
 * (a daily 9am instant) or "Workout --weekdays --1800-1900". Kept deliberately small and
 * word-based (matching the compact `--flag` style); the shared timeline engine
 * (`getTimelineOccurrences` / `dayMatchesRecurrence`) expands the rule into ticks, so this
 * is the whole "port recurrence to /0" surface. Weekday convention: 0(Sun)–6(Sat).
 */
function parseRepeatToken(value: string): Recurrence | null {
  switch (value.toLowerCase()) {
    case "daily":
      return { freq: "daily" }
    case "weekly":
      return { freq: "weekly" }
    case "monthly":
      return { freq: "monthly" }
    case "yearly":
    case "annually":
      return { freq: "yearly" }
    case "weekday":
    case "weekdays":
      return { freq: "weekly", byWeekday: [1, 2, 3, 4, 5] }
    case "weekend":
    case "weekends":
      return { freq: "weekly", byWeekday: [0, 6] }
    default:
      return null
  }
}

/** Short human label for a recurrence rule, for the create-field confirmation summary. */
function repeatLabel(r: Recurrence): string {
  if (r.freq === "weekly" && r.byWeekday) {
    const wd = r.byWeekday
    if (wd.length === 5 && wd.every((d) => d >= 1 && d <= 5)) return "weekdays"
    if (wd.length === 2 && wd.includes(0) && wd.includes(6)) return "weekends"
  }
  return r.freq
}

/**
 * Creatable kinds keyed by their ":xxxx" selector = the first 4 letters of the kind
 * name. `individual` ("indi") is TEMPORARILY creatable (dogfooding, Jul 2026); only
 * `soul` stays absent (system-spawned). All four-letter keys are unique, so there's no
 * collision.
 */
const KIND_PREFIX: Record<string, EntityKind> = {
  enti: "entity",
  spac: "space",
  task: "task",
  mome: "moment",
  inst: "instant",
  reso: "resource",
  comm: "community",
  orga: "organism",
  indi: "individual",
}

/**
 * Resolve a typed kind NAME to a creatable {@link EntityKind}, accepting either the full
 * name or (at least) its first 4 letters — the same keys as the `:xxxx` create selector.
 * Case-insensitive. Examples: "space"/"Space"/"spac" → "space", "organism"/"orga" →
 * "organism". Returns null for a non-creatable/unknown name (individual, soul, "xyz"), so
 * the `:kind:` setter can reject it. Drives BOTH the `:kind:` field-setter and reuses the
 * exact prefix table, so the two grammars never drift apart.
 */
export function resolveCreatableKind(raw: string): EntityKind | null {
  const key = raw.trim().toLowerCase().slice(0, 4)
  return KIND_PREFIX[key] ?? null
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

/**
 * Parse a compact ABSOLUTE date/time token for the `:field:` setters. The digit-count
 * selects the shape (all interpreted in LOCAL time):
 *   - 4  "HHMM"        → that time TODAY          ("1718" → 17:18 today)
 *   - 6  "YYMMDD"      → that date at 00:00        ("260709" → 2026-07-09 00:00)
 *   - 10 "YYMMDDHHMM"  → that date & time          ("2607092046" → 2026-07-09 20:46)
 * Year is 2000+YY. Returns epoch ms, or null when the token isn't one of those shapes
 * or is out of range (e.g. "2599" → minute 99, "260732" → day 32, "260230" → Feb 30).
 */
export function parseDateToken(raw: string, now: number = Date.now()): number | null {
  const s = raw.trim()

  // RELATIVE offsets from `now`: "<dur> ago" (past) or "in <dur>" (future), where <dur>
  // uses the full duration grammar (word units + chaining), e.g. "5min ago", "2h ago",
  // "1h30m ago", "in 10m". Resolved first so it never collides with the digit shapes below.
  const lower = s.toLowerCase()
  if (lower.endsWith(" ago")) {
    const mins = parseDurationToMinutes(lower.slice(0, -4))
    return mins == null ? null : now - mins * 60000
  }
  if (lower.startsWith("in ")) {
    const mins = parseDurationToMinutes(lower.slice(3))
    return mins == null ? null : now + mins * 60000
  }

  if (!/^\d+$/.test(s)) return null
  const n = (a: number, b: number) => parseInt(s.slice(a, b), 10)

  if (s.length === 4) {
    const h = n(0, 2)
    const min = n(2, 4)
    if (h > 23 || min > 59) return null
    // A bare HH:MM carries no date, so anchor it to the 5am→5am logical day-window that
    // contains `now` (not the raw calendar date). Typed at 01:30, "2330" is the prior
    // evening — 1.5h ago — because that window is still "today" until the 5am rollover.
    return resolveHHMMToLogicalDay(h, min, now)
  }
  if (s.length === 6 || s.length === 10) {
    const yy = n(0, 2)
    const mm = n(2, 4)
    const dd = n(4, 6)
    const h = s.length === 10 ? n(6, 8) : 0
    const min = s.length === 10 ? n(8, 10) : 0
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || h > 23 || min > 59) return null
    const d = new Date(2000 + yy, mm - 1, dd, h, min, 0, 0)
    // Reject calendar overflow that Date would silently roll over (e.g. Feb 30 → Mar 2).
    if (d.getMonth() !== mm - 1 || d.getDate() !== dd) return null
    return d.getTime()
  }
  return null
}

/**
 * Normalize spelled-out DURATION units + spaces down to the compact single-letter grammar
 * so `parseDurationToMinutes` (and the relative-time parser) accept natural phrasing:
 *   "5 min" / "5min" / "5 minutes" → "5m"; "2 hours" / "2 hrs" → "2h"; "30 sec" → "30s";
 *   "3 days" → "3d"; "1 hour 30 minutes" → "1h30m". Longest words are matched first so
 *   "minutes" isn't clipped by the "min" alternative. Leaves digits/`:` untouched.
 */
function normalizeDurationWords(s: string): string {
  return s
    .toLowerCase()
    .replace(/minutes?|mins?/g, "m")
    .replace(/seconds?|secs?/g, "s")
    .replace(/hours?|hrs?/g, "h")
    .replace(/days?/g, "d")
    .replace(/\s+/g, "")
}

/**
 * Parse a human DURATION token into MINUTES (the unit `Schedule.duration` stores).
 * Independent of any start time — it's a pure length. Accepts, case-insensitively:
 *   - unit tokens, optionally chained + spelled-out: `2d`, `3h`, `30m`, `45s`, `1h30m`,
 *     `2d3h15m`, `5 min`, `2 hours`, `1 hour 30 minutes`
 *     (units: d=days, h=hours, m=minutes, s=seconds; decimals ok, e.g. `1.5h`)
 *   - clock form `H:MM` → hours:minutes (`1:30` → 90)
 *   - a bare number → MINUTES (`90` → 90)
 * Returns minutes (fractional preserved so seconds survive, e.g. `45s` → 0.75), or null
 * when the token is empty / unparseable / not strictly positive.
 */
export function parseDurationToMinutes(raw: string): number | null {
  const s = normalizeDurationWords(raw.trim())
  if (s === "") return null

  // Clock form H:MM (minutes 0–59).
  const clock = s.match(/^(\d+):(\d{1,2})$/)
  if (clock) {
    const min = parseInt(clock[2], 10)
    if (min > 59) return null
    const total = parseInt(clock[1], 10) * 60 + min
    return total > 0 ? total : null
  }

  // Bare number ⇒ minutes.
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const min = parseFloat(s)
    return min > 0 ? min : null
  }

  // Unit-chained form: one or more `<number><d|h|m|s>` tokens, nothing else.
  if (!/^(?:\d+(?:\.\d+)?[dhms])+$/.test(s)) return null
  const UNIT_MIN: Record<string, number> = { d: 1440, h: 60, m: 1, s: 1 / 60 }
  let total = 0
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)([dhms])/g)) {
    total += parseFloat(m[1]) * UNIT_MIN[m[2]]
  }
  return total > 0 ? total : null
}

export interface FieldSetterParse {
  /** Self-field name, lowercased, colons stripped (e.g. "start"). */
  field: string
  /** Raw value after the `:field:` token (empty ⇒ the caller may treat as "clear"). */
  value: string
}

/**
 * Detect a leading SELF-FIELD setter — `:field: value` — where a colon-WRAPPED leading
 * token means "in THIS entity, set <field> to <value>". It's distinguished from the
 * `:kind` selector purely by the TRAILING colon: `:start:` SETS a field, `:task` CREATES
 * a child. Examples:
 *   ":start: 260709" → { field: "start", value: "260709" }
 *   ":end:1718"      → { field: "end",   value: "1718" }
 *   ":start:"        → { field: "start", value: "" }
 * Returns null when the first token isn't a `:word:` setter, so the caller falls through
 * to the kind-selector / timed-create / plain-create paths.
 */
export function parseFieldSetter(raw: string): FieldSetterParse | null {
  const m = raw.trimStart().match(/^:([a-z]+):\s*([\s\S]*)$/i)
  if (!m) return null
  return { field: m[1].toLowerCase(), value: m[2].trim() }
}

/**
 * Normalize a user-typed hex color into `#rrggbb`, or null if it isn't one. Accepts an
 * optional leading `#` and either 3- or 6-digit hex ("f00", "#f00", "ff0000", "#FF0000"
 * all → "#ff0000"). Drives the `:color:` setter — geeks type the hex directly instead of
 * clicking the swatch picker.
 */
export function parseHexColor(raw: string): string | null {
  const s = raw.trim().replace(/^#/, "").toLowerCase()
  if (/^[0-9a-f]{3}$/.test(s)) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`
  return null
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

  // First UNNAMED (no "=") param that reads as a time drives the schedule; a separate
  // pass picks up a RECURRENCE flag (`--daily`, `--weekdays`, …). A repeat word never
  // parses as a time, so the two never collide.
  let time: TimeParam | null = null
  let repeat: Recurrence | null = null
  for (const m of tokens) {
    const value = m[1]
    if (value.includes("=")) continue // named param — ignore for now
    if (!time) {
      const parsed = parseTimeParam(value)
      if (parsed) {
        time = parsed
        continue
      }
    }
    if (!repeat) repeat = parseRepeatToken(value)
  }
  if (!time) return null

  // Title = raw minus all params, whitespace collapsed.
  const title = raw.replace(/\s*--\S+/g, "").replace(/\s+/g, " ").trim()
  if (!title) return null

  const verb = classifyVerb(title)
  // A RECURRING create is a forward-looking PLAN, never a one-time "logged done" — even
  // with a past-tense verb. Only a one-off past activity is auto-completed.
  const completed = repeat === null && verb !== null
  const base = todayMidnight()
  const recurSuffix = repeat ? ` · ${repeatLabel(repeat)}` : ""

  if (time.kind === "point") {
    // A point in time is an Instant, whatever the verb.
    const at = clockToEpoch(base, time.at)
    return {
      title,
      kind: "instant",
      completed,
      schedule: { at, ...(repeat ? { repeat } : {}) },
      summary: `${completed ? "Instant logged" : "Instant"} · ${fmt(time.at)}${recurSuffix}`,
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
    schedule: { startDate: startAt, endDate: endAt, ...(repeat ? { repeat } : {}) },
    summary: `${label}${completed ? " logged" : ""} · ${fmt(time.start)}–${fmt(time.end)}${recurSuffix}`,
  }
}

// ────────────────────────────────────────────────────────────────────────────────────
// TWO-SIGIL ENTRY GRAMMAR (v0.3.34) — the universal create-bar language.
//
// One line parses into: an optional KIND, zero+ ACTIONS, zero+ ATTRIBUTES, and a TITLE.
// Two sigils, learnable in a sentence:
//   • `:word`        — a standalone DIRECTIVE. Either a KIND ("this is a …": `:mome`,
//                      `:task`, 4-letter kind prefix) or an ACTION ("do this to it":
//                      `:done`, `:undone`, `:close`, `:cancel`, `:reopen`, `:request`,
//                      `:unrequest`, `:delete`).
//   • `--field:value`— an ATTRIBUTE ("this has …"): `--start:2330`, `--end:0630`,
//                      `--at:0630`, `--due:260709`, `--color:ff0000`, `--sex:man`,
//                      `--title:new name`. First colon splits name/value; `--s`/`--e`
//                      alias start/end. `--title:` captures the REST of the line (free
//                      multi-word text). (`--repeat` is not wired yet — no mutator.)
// The remaining words are the TITLE. TARGET RULE (applied by the caller): a title ⇒ act
// on a NEW child; no title ⇒ act on the CURRENTLY OPEN entity (the bar is a command
// line). A NAKED time with no `--field` is just title text — the field name is mandatory,
// which is what removes all point-vs-start guessing.
// ────────────────────────────────────────────────────────────────────────────────────

/** Lifecycle/relationship actions expressible as a bare `:word` flag. Ids match {@link
 *  applyEntityMenuAction}, so the create bar and the right-click menu do the exact same thing. */
export type EntryActionId =
  | "done" | "undone" | "close" | "cancel" | "reopen" | "request" | "unrequest" | "delete"

const ACTION_IDS: Record<string, EntryActionId> = {
  done: "done", undone: "undone", close: "close", cancel: "cancel",
  reopen: "reopen", request: "request", unrequest: "unrequest", delete: "delete",
}

/** Short field aliases → canonical field name. */
const FIELD_ALIASES: Record<string, string> = { s: "start", e: "end" }

export interface EntryAttr {
  /** Canonical field name (aliases resolved): start | end | at | due | repeat | color | sex | title. */
  field: string
  /** Raw value after the first colon (empty ⇒ the caller clears the slot). */
  value: string
}

export interface EntryParse {
  /** Explicit `:kind` directive, or null (caller infers via {@link inferKind}). */
  kind: EntityKind | null
  /** `:action` flags, in typed order. */
  actions: EntryActionId[]
  /** `--field:value` attributes, in typed order. */
  attrs: EntryAttr[]
  /** Unrecognized `:directives` (neither kind nor action) — the caller reports them. */
  unknown: string[]
  /** Remaining free text = the title (params/directives stripped, whitespace collapsed). */
  title: string
}

/**
 * A SPAN END that is DATE-ONLY (6 digits, YYMMDD @ 00:00) should cover the WHOLE final
 * day, so append `2359` → a 10-digit YYMMDDHHMM at 23:59. 4/10-digit ends already carry a
 * time and pass through unchanged. (Start needs no such bump — a date-only start at 00:00
 * is the natural "from the beginning of that day".)
 */
function endOfDayIfDateOnly(tok: string): string {
  return tok.length === 6 ? tok + "2359" : tok
}

/**
 * Parse a create-bar line into the {@link EntryParse} structure. Pure + synchronous.
 * Order of extraction: `--title:` (rest-of-line) → `--<digits>-<digits>` span shortcut →
 * other `--field:value` → `:directives` → whatever's left is the title.
 */
export function parseEntry(raw: string): EntryParse {
  let s = raw
  const attrs: EntryAttr[] = []

  // 1) `--title:REST` captures everything after it (free multi-word text). Handled first
  //    so its spaces aren't split like the single-token params below. Only the first wins.
  const titleAttr = s.match(/--title:(.*)$/i)
  if (titleAttr && titleAttr.index != null) {
    attrs.push({ field: "title", value: titleAttr[1].trim() })
    s = s.slice(0, titleAttr.index)
  }

  // 1.5) `--<digits>-<digits>` SPAN shortcut — sugar for `--start:X --end:Y`. Always a
  //      SPAN (never a point), so it reintroduces NO point-vs-start ambiguity (the reason
  //      the bare `--2330-0630` form was retired in v0.3.34 — this one keeps the `--`).
  //      Each side is 4 (HHMM today) / 6 (YYMMDD) / 10 (YYMMDDHHMM) digits, matching
  //      parseDateToken. A DATE-ONLY end (6 digits) is bumped to 23:59 so the range covers
  //      the whole final day. Runs before step 2 (that regex only matches `--[a-zA-Z]`, so
  //      the digit tokens are invisible to it — no collision). Cross-midnight end-bump is
  //      applied later in the canvas create flow, not here.
  s = s.replace(/--(\d+)-(\d+)/g, (m, a: string, b: string) => {
    const ok = (t: string) => t.length === 4 || t.length === 6 || t.length === 10
    if (!ok(a) || !ok(b)) return m // not a valid span token — leave the text untouched
    attrs.push({ field: "start", value: a })
    attrs.push({ field: "end", value: endOfDayIfDateOnly(b) })
    return " "
  })

  // 1.6) RELATIVE-TIME phrases on SCHEDULING fields (start/end/at/due + s/e aliases).
  //      Unlike the single-token step 2 below, these allow SPACES so natural phrasing like
  //      "--end: 5min ago" / "--start: in 2h" is captured WHOLE (otherwise the value would
  //      truncate at the first space, dropping "ago"/the units into the title). The <dur>
  //      body is limited to duration-ish chars (digits, dot, letters, spaces) and matched
  //      lazily so it can't swallow a following "--" param or arbitrary title text.
  //      parseDateToken resolves "<dur> ago" / "in <dur>" against `now` at apply time.
  const relFields = "(sessionstart|sessionend|start|end|at|due|s|e)"
  s = s.replace(new RegExp(`--${relFields}\\s*:\\s*([\\d.]+[\\d.a-z ]*?)\\s+ago\\b`, "gi"), (_m, f: string, dur: string) => {
    attrs.push({ field: FIELD_ALIASES[f.toLowerCase()] ?? f.toLowerCase(), value: `${dur.trim()} ago` })
    return " "
  })
  s = s.replace(new RegExp(`--${relFields}\\s*:\\s*in\\s+([\\d.]+[\\d.a-z ]*?)(?=\\s*(?:--|$))`, "gi"), (_m, f: string, dur: string) => {
    attrs.push({ field: FIELD_ALIASES[f.toLowerCase()] ?? f.toLowerCase(), value: `in ${dur.trim()}` })
    return " "
  })

  // 2) `--field:value` / `--field` — single-token value up to the next whitespace.
  s = s.replace(/--([a-zA-Z]+)(?::(\S*))?/g, (_m, f: string, v?: string) => {
    const field = FIELD_ALIASES[f.toLowerCase()] ?? f.toLowerCase()
    attrs.push({ field, value: (v ?? "").trim() })
    return " "
  })

  // 3) `:word` directives — a standalone token that is a KIND prefix or an ACTION.
  let kind: EntityKind | null = null
  const actions: EntryActionId[] = []
  const unknown: string[] = []
  s = s.replace(/(?:^|\s):([a-zA-Z]+)(?=\s|$)/g, (_m, w: string) => {
    const word = w.toLowerCase()
    const k = KIND_PREFIX[word.slice(0, 4)]
    if (k) {
      kind = k
      return " "
    }
    if (ACTION_IDS[word]) {
      actions.push(ACTION_IDS[word])
      return " "
    }
    unknown.push(word)
    return " "
  })

  const title = s.replace(/\s+/g, " ").trim()
  return { kind, actions, attrs, unknown, title }
}

/**
 * The creatable {@link EntityKind} for a NEW entity that carried no explicit `:kind` directive.
 * ALWAYS **task** (Jul 2026, by request). FIELD-based kind inference was DROPPED: scheduling
 * flags NO LONGER flip the kind, because ANY kind can be planned — a Task with `--start/--end`
 * is a planned task, not a Moment; `--at` sets the task's `startAt`; `--due` its `dueDate`. The
 * flags just populate the schedule of whatever you're making (default Task); to make another
 * kind, state it explicitly (`:mome`, `:inst`, …). Verb-based inference was already dropped
 * (titles kept verbatim). `attrs` is now unused but kept for signature stability / callers.
 */
export function inferKind(_title: string, _attrs: EntryAttr[]): EntityKind {
  return "task"
}
