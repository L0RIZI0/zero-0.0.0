// ─────────────────────────────────────────────────────────────────────────────
// FACE MODEL — the pure, presentation-agnostic core of the `Face` primitive.
//
// A Face is one SIDE of an entity: the entity showing ITSELF, at some SIZE (the
// other side is Content — its children). See /excerpts. This module is the single
// source of truth for HOW an entity presents, independent of any rung's layout:
//
//   • getFaceModel(e, now)     → the flags/labels every size reads (glyph fill, done,
//                                cancelled, ongoing, state word, the inline meta echo).
//   • getFaceMetaRows(e, now)  → the exhaustive key/value rows the Full face lists (§0).
//   • the formatters           → moved here verbatim from zero0-canvas so both the
//                                model and the meta rows (and the canvas's own log /
//                                create-notice call sites, which re-import them) share
//                                ONE implementation.
//
// Pure + no JSX, so it is trivially testable and reusable by any surface that renders
// a Face at any resolution. Kept free of React on purpose.
// ─────────────────────────────────────────────────────────────────────────────

import type { Entity, EntityKind, Whenever } from "./types"
import { WHENEVER } from "./types"
  import { KIND_META, isClosed, fillsGlyph, getState, isOngoing, getOngoingSince, concreteStart, effectiveScheduleEnd, ongoingOpenSession, occurrenceAction, isPlannedKind, isMarkable, getMarks, getSessions, getInstantMaxNb, isInstantMaxNbHard, getInstantOccurrenceCount, type EntityState } from "./kinds"
import { isDone, getCreatedAt, getCompletedOn } from "./entity-log"
import { getEntity, getCreator, getOwner, getForwardTags, getBackReferences, getChildren } from "./data"
import { formatLocale } from "./format-locale"
import { webLabel } from "./web-resources"

// ── THE SIZE LADDER ──────────────────────────────────────────────────────────
// XS and Full are the FIXED ends; the middle rungs are pragmatic presets, not
// frozen (see /excerpts). A SIZE is a curated projection — "how much of the entity
// you're looking at" — never a stored property; it's chosen per view.
export type FaceSize = "xs" | "s" | "m" | "l" | "xl" | "full"

// The ladder in ascending order — the single source the Size right-click submenu
// iterates. Order matters (the menu reads top→bottom, small→large).
export const FACE_SIZES: FaceSize[] = ["xs", "s", "m", "l", "xl", "full"]

// A human label for a rung, shown in the Size submenu. The two ends and the default
// carry a hint of their canonical role (`m` is the standard content row, `full` is §0).
export function faceSizeLabel(size: FaceSize): string {
  switch (size) {
    case "xs":
      return "XS · glyph + title"
    case "s":
      return "S · + state"
    case "m":
      return "M · row"
    case "l":
      return "L · essentials"
    case "xl":
      return "XL · detailed"
    case "full":
      return "Full · §0"
  }
}

// Which §0 meta keys the BLOCK rungs surface. `full` shows everything; `l` and `xl`
// are SUBSETS of the very same `getFaceMetaRows` output, so a block rung can never
// drift from §0 — it only ever hides rows, never invents them.
//   • L  = the temporal essentials: done + lifecycle state + schedule + duration/age.
//   • XL = everything EXCEPT raw provenance plumbing (id / creator / owner).
  const L_META_KEYS = new Set(["done", "state", "status", "planned start", "planned end", "at", "due", "scheduled", "planned duration", "duration", "age"])
const XL_OMIT_KEYS = new Set(["id", "creator", "owner"])
export function filterMetaRows(rows: [string, string][], size: "l" | "xl" | "full"): [string, string][] {
  if (size === "full") return rows
  if (size === "xl") return rows.filter(([k]) => !XL_OMIT_KEYS.has(k))
  return rows.filter(([k]) => L_META_KEYS.has(k)) // l
}

// ── THE MAKE AXIS ──────────────────────────────────────────────────────────────
// MAKE is ORTHOGONAL to SIZE. Where SIZE says HOW MUCH of a Face you see, MAKE says
// WHAT IT READS AS — how the same entity is interpreted:
//   • default — the entity showing ITSELF: its own lifecycle glyph + own meta (§0).
//   • starter — the entity as an AGGREGATOR of what it contains: the glyph + title
//               stay, but the meta becomes a ROLLUP of its children (count, open,
//               total time, latest). The ▸ caret still drills into the real Content.
//   • counter/rater/opener — further verb-modes (a tally, a score, a quick-open).
//     NAMED now so the axis reads as complete, but they fall back to the `default`
//     render until their live behaviour lands (render-model first).
// A MAKE, like a SIZE, is a VIEW choice — never a stored property of the entity.
export type FaceMake = "default" | "starter" | "counter" | "rater" | "opener"

// The axis in canonical order — the single source the Make right-click submenu iterates.
export const FACE_MAKES: FaceMake[] = ["default", "starter", "counter", "rater", "opener"]

// A human label for a make, shown in the Make submenu.
export function faceMakeLabel(make: FaceMake): string {
  switch (make) {
    case "default":
      return "Default · itself"
    case "starter":
      return "Starter · aggregate"
    case "counter":
      return "Counter · tally"
    case "rater":
      return "Rater · score"
    case "opener":
      return "Opener · quick-open"
  }
}

// Only these makes have a distinct render this stage; the rest fall back to `default`.
export function makeRendersDistinctly(make: FaceMake): boolean {
  return make === "starter"
}

// The rolled-up read of an entity's CONTENT (its children), computed for the `starter`
// make. Pure: derived from `getChildren` + the same STATE model every Face uses, never
// stored. `total` counts direct children; `open`/`complete` use the state word; `ongoing`
// is the live-moment subset; `duration` sums finite child spans; `latest` is the most
// recent child start/point (for the "last …" echo).
export interface FaceAggregate {
  total: number
  open: number
  complete: number
  ongoing: number
  durationMs: number
  latest: number | null
}
export function getAggregate(entity: Entity, now: number): FaceAggregate {
  const kids = getChildren(entity.id)
  let open = 0
  let complete = 0
  let ongoing = 0
  let durationMs = 0
  let latest: number | null = null
  for (const k of kids) {
    const st = getState(k, now)
    // STATUS axis first: an ongoing child counts as ongoing (not also as open), mirroring the
    // old single-word behavior where "ongoing" preempted "open". STATE axis fills the rest.
    if (isOngoing(k, now)) ongoing++
    else if (st.word === "open") open++
    else if (st.word === "complete") complete++
    // Sum only FINITE spans (a span with both ends, or a point/instant = 0), so an
    // open-ended running moment doesn't inflate the rollup with live-elapsed time.
    const s = k.schedule
    const cs = concreteStart(k)
    if (cs != null && s?.endAt != null) durationMs += Math.max(0, s.endAt - cs)
    // Most-recent anchor: the child's start / point, falling back to when it was created.
    // "whenever" isn't a time, so fall through to the point / creation stamp.
    const point = cs ?? s?.at ?? getCreatedAt(k) ?? null
    if (point != null && (latest == null || point > latest)) latest = point
  }
  return { total: kids.length, open, complete, ongoing, durationMs, latest }
}

// The one-line aggregate ECHO for the small rungs (xs/s/m) of a `starter`, standing in
// for the default per-entity meta echo. E.g. "12 · 3 open · 4h 10m".
export function aggregateEcho(agg: FaceAggregate): string {
  if (agg.total === 0) return "empty"
  const parts: string[] = [String(agg.total)]
  if (agg.ongoing > 0) parts.push(`${agg.ongoing} ongoing`)
  else if (agg.open > 0) parts.push(`${agg.open} open`)
  if (agg.durationMs > 0) parts.push(formatDuration(agg.durationMs))
  return parts.join(" · ")
}

// The aggregate META ROWS for the block rungs (l/xl/full) of a `starter` — the rollup
// as a key/value list, mirroring how the default block lists §0 rows. `full` gets all;
// `l`/`xl` are trimmed the same nested way (l = the essentials).
export function aggregateMetaRows(agg: FaceAggregate, now: number, size: "l" | "xl" | "full"): [string, string][] {
  const rows: [string, string][] = []
  rows.push(["contains", String(agg.total)])
  if (agg.open > 0) rows.push(["open", String(agg.open)])
  if (agg.ongoing > 0) rows.push(["ongoing", String(agg.ongoing)])
  if (agg.complete > 0) rows.push(["complete", String(agg.complete)])
  if (agg.durationMs > 0) rows.push(["duration", formatDuration(agg.durationMs)])
  if (agg.latest != null) rows.push(["latest", fmt(agg.latest)])
  if (size === "l") return rows.filter(([k]) => k === "contains" || k === "open" || k === "ongoing" || k === "duration")
  return rows // xl + full show the whole rollup
}

// ── FORMATTERS (moved verbatim from zero0-canvas) ─────────────────────────────

// Format an epoch (ms) for the meta readout. Only ever called under the `mounted`
// gate, so it's client-only — no SSR/static-export time-freeze hydration trap.
export function fmt(epoch?: number | Whenever): string {
  if (epoch === WHENEVER) return "whenever"
  if (!epoch) return "—"
  return new Date(epoch).toLocaleString(formatLocale())
  }

// A COMPACT when-label for an entity, used to distinguish multiple back-references that
// share a title (e.g. several "Work on Zero" sessions): its span → its point → else the
// date it was created. Under the `mounted` gate like `fmt`.
export function rangeLabel(e: Entity): string {
  const s = e.schedule
  if (s?.startAt != null || s?.endAt != null) return `${fmt(s?.startAt)} → ${fmt(s?.endAt)}`
  if (s?.at != null) return fmt(s.at)
  return fmt(getCreatedAt(e))
}

// OCCURRENCE duration of an entity, in ms — the length of when this thing HAPPENED / will
// happen (TOP rail), DECOUPLED from access/session time (v0.6.18). Never stored — derived:
//   • explicit --duration → that (a deliberately-set occurrence length, any kind)
//   • instant             → 0 (a point has no length)
//   • archived occurrences[] → Σ each finite past span (the happened-history)
//   • current live span    → concreteStart→endAt, or (ongoing, no end) count up to `now`
//   • BEING w/ no span     → its AGE: now − createdAt (an Individual/Organism's createdAt is a
//                            genuine birth, so this reads "3d" / "34y")
//   • otherwise            → null → "—" (a merely-open "whenever" moment/space that was never
//                            started has accrued NO occurrence length; access time lives on its
//                            OWN row now, so this must NOT borrow it)
// `now` drives a live/ongoing value as the canvas re-renders.
export function getOccurrenceDurationMs(e: Entity, now: number): number | null {
  const s = e.schedule
  if (s?.duration != null) return s.duration * 60000
  if (e.kind === "instant") return 0
  let total = 0
  let any = false
  for (const occ of s?.occurrences ?? []) {
    if (occ.endAt != null) {
      total += Math.max(0, occ.endAt - occ.startAt)
      any = true
    }
  }
  const cs = concreteStart(e) // null when "whenever" / unset
  if (cs != null) {
    any = true
    total += s?.endAt != null ? Math.max(0, s.endAt - cs) : Math.max(0, now - cs) // live when ongoing
  } else if (s?.at != null) {
    any = true // a lone point anchor is a zero-length occurrence
  }
  if (any) return total
  // AGE fallback — beings only (death-terminal kinds).
  // v0.6.26: the SPACE-session fallback was REMOVED. A played space/moment's actual time is ACCESS
  // (focus) + PLAYED (play), its own rows — DURATION must NOT borrow session time (that was the
  // v0.6.23 double-duty). Moment/space no longer call this fn at all (they use getPlannedDurationMs).
  if (e.kind === "individual" || e.kind === "organism") {
    const created = getCreatedAt(e)
    if (created != null) return Math.max(0, now - created)
  }
  return null
}

// PLANNED DURATION of a moment/space (v0.6.26) — the width of its PLANNED span, derived PURELY from
// the plan, never from actual/session time:
//   • explicit `schedule.duration` (minutes) if set, else
//   • plannedEnd − plannedStart when BOTH are concrete (a real start epoch + a real end), else
//   • null ⇒ "—". A merely-ongoing or open-ended thing (started, no planned end, no duration) has
//     NO inferable planned duration — we deliberately do NOT fall back to elapsed/session time
//     (that's ACCESS/PLAYED). A lone point anchor (`at`) likewise has no span ⇒ "—".
export function getPlannedDurationMs(e: Entity): number | null {
  const s = e.schedule
  if (s?.duration != null && s.duration > 0) return s.duration * 60000
  const start = concreteStart(e) // planned start epoch, excluding "whenever"/unset
  if (start != null && s?.endAt != null) return Math.max(0, s.endAt - start)
  return null
}

// Accumulated SESSION time of an entity, in ms — Σ each session span with the single OPEN one
// counting LIVE to `now`. `null` when there are no matching sessions. Optionally filtered by
// `via` so the two clocks stay separate (v0.6.26): ACCESS = `focus` (presence / "being there",
// middle rail), PLAYED = `play` (manual stopwatch, bottom rail). Unfiltered = every session.
// The deliberate counterpart to getOccurrenceDurationMs: never merged with planned time.
export function getSessionMs(e: Entity, now: number, via?: "focus" | "play" | "mark"): number | null {
  const sessions = getSessions(e).filter((s) => (via ? s.via === via : true))
  if (sessions.length === 0) return null
  let total = 0
  for (const sess of sessions) total += Math.max(0, (sess.endAt ?? now) - sess.startAt)
  return total
}

/** ACCESS = accumulated PRESENCE (focus sessions). Back-compat name; now focus-only. */
export function getAccessMs(e: Entity, now: number): number | null {
  return getSessionMs(e, now, "focus")
}
// (v0.6.33) getPlayedMs/getPlayedCells removed — the play-time SUM is no longer a §0 row; ongoing
// time lives on DURATION (getOngoingDurationMs/Cells, a union) and OCCURRENCES is now a count+list.

// Human-readable duration: up to THREE adjacent units, from the largest non-zero unit
// down — "00s", "45s", "5m 12s", "1h 30m 05s", "2d 3h 40m", "35y 1mo 24d". Scales to years
// so an Individual's age reads cleanly. Uses average month/year lengths (30.44d / 365.25d)
// — display-only, not for exact arithmetic. Trailing zero units are dropped, but a zero
// BETWEEN two shown units is kept (e.g. "1y 0mo 5d") so the tiers stay positionally clear.
const MIN = 60000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const MONTH = 30.44 * DAY
const YEAR = 365.25 * DAY
export function formatDuration(ms: number): string {
  if (ms < 1000) return "00s"
  let rem = ms
  const y = Math.floor(rem / YEAR)
  rem -= y * YEAR
  const mo = Math.floor(rem / MONTH)
  rem -= mo * MONTH
  const d = Math.floor(rem / DAY)
  rem -= d * DAY
  const h = Math.floor(rem / HOUR)
  rem -= h * HOUR
  const m = Math.floor(rem / MIN)
  rem -= m * MIN
  const s = Math.floor(rem / 1000)
  const parts: [number, string][] = [
    [y, "y"],
    [mo, "mo"],
    [d, "d"],
    [h, "h"],
    [m, "m"],
    [s, "s"],
  ]
  const first = parts.findIndex(([v]) => v > 0)
  if (first === -1) return "00s"
  const shown = parts.slice(first, first + 3)
  while (shown.length > 1 && shown[shown.length - 1][0] === 0) shown.pop()
  // Always render seconds two-digit ("06s", not "6s") so a session list doesn't jitter
  // horizontally as a value crosses 10; other units render at their natural width.
  return shown.map(([v, u]) => `${u === "s" ? String(v).padStart(2, "0") : v}${u}`).join(" ")
}

// Schedule `set` entries carry an epoch NUMBER as their value; render it as a date rather
// than a raw millisecond count in the life-log history. Everything else prints as-is.
export const TIME_LOG_FIELDS = new Set(["startAt", "endAt", "at", "dueAt"])
export function fmtLogValue(field: string, value: string | number | boolean): string {
  if (TIME_LOG_FIELDS.has(field) && typeof value === "number") return fmt(value)
  if (field === "sex" && typeof value === "string") return sexSymbol(value)
  return String(value)
}

// Render an Individual's sex as the Unicode gender GLYPH. "man"/"woman" stay the stored
// model values; ♂/♀ is purely the display form (falls back to the raw word if unknown).
export function sexSymbol(sex: string): string {
  return sex === "man" ? "♂" : sex === "woman" ? "♀" : sex
}

// Render an {@link EntityState} as one stable STATE-row string. `open` shows no date
// (CREATED already carries "since when"); every other position carries its own instant,
// which lives nowhere else. `complete` also shows WHEN it will auto-close at midnight.
// `isLiving` (a death-terminal kind — an Individual/Organism) reads its `open` state as
// "alive" (lowercase, like every other state word), the natural antonym of `dead`.
export function formatState(state: EntityState, format: (e?: number) => string, isLiving = false): string {
  switch (state.word) {
    case "open":
      if (isLiving) return state.reopenedAt ? `alive · reopened ${format(state.reopenedAt)}` : "alive"
      return state.reopenedAt ? `open · reopened ${format(state.reopenedAt)}` : "open"
    case "scheduled":
      // A planned instant awaiting its occurrence — `at` is the scheduled anchor.
      return state.at != null ? `scheduled · ${format(state.at)}` : "scheduled"
    case "complete":
      return state.willCloseAt ? `complete · closes ${format(state.willCloseAt)} (auto)` : "complete"
    case "dead":
      // Age already carries its unit (e.g. "35 years"), so no ambiguity in the lifespan.
      return state.age != null ? `dead · ${format(state.at)} (${state.age})` : `dead · ${format(state.at)}`
    case "retired":
      return `retired · ${format(state.at)}`
    case "cancelled":
      return `cancelled · ${format(state.at)}`
    case "closed":
    default:
      return `closed · ${format(state.at)}`
  }
}

// A COMPACT when-label for inline ROW meta: time-of-day only when the instant falls on the
// same calendar day as `now` (rows are mostly today-scoped), else a short "MMM D, h:mm AM"
// so an off-day anchor (e.g. a task due next week) never reads misleadingly as today.
export function fmtShort(epoch: number, now: number): string {
  const d = new Date(epoch)
  const sameDay = d.toDateString() === new Date(now).toDateString()
  return d.toLocaleString(
    formatLocale(),
    sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  )
}

// The kind-relevant METAFIELD summary shown inline on each ENTITY CONTENT row — a condensed
// echo of the Full face's meta, surfacing only the field(s) that define the kind:
//   • moment    → its span "start–end · dur", or "since start · dur" while ongoing (live), or
//                 a lone point "at"; nothing when unscheduled.
//   • space     → same span echo as a moment (a Space is span-bearing: "whenever" when
//                 playable, a concrete span, or ongoing "since …"); nothing when unscheduled.
//   • instant   → its point time.
//   • task      → its due time; OR a scheduled span "start–end · dur" / ongoing "since start ·
//                 dur" / lone "at" (a task can carry start/end/duration too, not just a due).
//                 Due takes precedence when both are set.
//   • individual→ sex glyph · age (elapsed since birth/createdAt).
// Everything else (community/organism/resource/soul) stays quiet — the row's kind +
// title + state already say it all. `now` drives the live ongoing count-up.
export function metaEcho(e: Entity, now: number): string {
  const s = e.schedule
  // A start/end/at span shared by moments AND scheduled tasks. "whenever" has no clock
  // time, so it reads as the word (its live time, if any, comes from an open session).
  const span = (): string => {
    const cs = concreteStart(e)
    if (s?.startAt === WHENEVER) return "whenever"
    if (cs != null && s?.endAt != null)
      return `${fmtShort(cs, now)}–${fmtShort(s.endAt, now)} · ${formatDuration(Math.max(0, s.endAt - cs))}`
    if (cs != null) return `since ${fmtShort(cs, now)} · ${formatDuration(Math.max(0, now - cs))}`
    if (s?.at != null) return fmtShort(s.at, now)
    return ""
  }
  switch (e.kind) {
    case "moment":
    case "space":
      return span()
    case "instant": {
      // An instant is a TALLY of occurrences (marks), not a span. Echo the count + latest
      // mark; fall back to a lone scheduled `at` (a pre-placed instant with no marks yet).
      const marks = getMarks(e)
      if (marks.length > 0) {
        const n = marks.length
        return `${n} occurrence${n === 1 ? "" : "s"} · ${fmtShort(marks[0].startAt, now)}`
      }
      return s?.at != null ? fmtShort(s.at, now) : ""
    }
    case "task": {
      if (s?.dueAt != null) return `due ${fmtShort(s.dueAt, now)}`
      return span() // start/end/duration when no due is set
    }
    case "individual": {
      const created = getCreatedAt(e)
      const age = created != null ? formatDuration(Math.max(0, now - created)) : ""
      return e.sex ? (age ? `${sexSymbol(e.sex)} · ${age}` : sexSymbol(e.sex)) : age
    }
    default:
      return ""
  }
}

// ── THE PRESENTATION MODEL ────────────────────────────────────────────────────
// Everything a Face needs to render, at ANY size, derived once from the entity +
// `now`. This collapses the derivation that used to be duplicated between §0 and
// each content row — glyph fill, the done checkmark, cancel bar, ongoing rotation,
// the state word, and the inline meta echo now have a SINGLE definition.
export interface FaceModel {
  /** The entity/projection KIND — drives the glyph shape (so a Face can render its
      glyph from the model alone, without an Entity in hand). */
  kind: EntityKind
  title: string
  /** WEB RESOURCE only: a two-line hover string (full title + full URL) for a native `title`
   *  attribute — since `title` above may be cropped to {@link WEB_TITLE_MAX_LEN}. undefined for
   *  non-web entities (their button keeps the "Open" hint). */
  titleTooltip?: string
  /** UPPERCASE kind label (e.g. "TASK", "MOMENT"). */
  kindLabel: string
  /** This kind carries the soft DONE axis (Task only today). */
  hasDoneState: boolean
  /** Glyph fills solid — complete OR closed, for fillable kinds. */
  filled: boolean
  /** The soft "I did this" marker is set (Task). */
  done: boolean
  /** Show the overlaid checkmark — done AND the kind has a done axis. */
  showCheck: boolean
  /** Struck-through + barred glyph. */
  cancelled: boolean
  /** Task marked as sent to someone else — the "requested" flap. */
  requested: boolean
  /** A live span in progress — the glyph rotates. */
  ongoing: boolean
  /** PLAYABLE — a moment/space whose glyph drives its OCCURRENCE lifecycle (top rail). True for
      any of play/stop/reopen; see `occAction` for which one. Mutually exclusive with hasDoneState. */
  playable: boolean
  /** The specific occurrence affordance the glyph performs on click: "play" (start), "stop" (end
      the running one), or "reopen" (archive the finished span → playable again). null when the
      glyph isn't an occurrence control. */
  occAction: "play" | "stop" | "reopen" | null
  /** MARKABLE — a live INSTANT whose glyph records an OCCURRENCE (a timestamp) on each click.
      A point, never a running span, so it never reads ongoing (mutually exclusive with playable). */
  markable: boolean
  /** ENDED (closed / dead / retired / cancelled) ⇒ the row/section fades. */
  closed: boolean
  /** The single lifecycle word straight off the STATE axis. */
  lifeLabel: string
  /** A compact composite for tooltips/aria: "done, complete, requested". */
  stateLabel: string
  /** Kind-relevant schedule/identity echo, or "" when there's nothing to show. */
  metaEcho: string
  /** This entity's own explicitly-set accent (inherited colors are not surfaced). */
  accent?: string
  /** WEB RESOURCE: the fronted URL, when this entity fronts a web surface. Its presence tells
      a renderer to show the site FAVICON before the title and that `title` is the DISPLAYED
      title (webpage title / hostname), not the raw URL (which stays the entity's stored title). */
  webUrl?: string
  /** Optional catalog id for the fronted resource (branding/favicon domain). */
  webResourceId?: string
}

// Derive the presentation model for an entity. Pure; call per render (cheap).
export function getFaceModel(e: Entity, now: number): FaceModel {
  const km = KIND_META[e.kind]
  const state = getState(e) // the lifecycle position (STATE axis — what it IS)
  const ongoingNow = isOngoing(e, now) // STATUS axis — what it's DOING (running), orthogonal to STATE
  const done = isDone(e) // soft DONE marker (Task only), orthogonal to STATE
  const requested = e.kind === "task" && !!e.requested
  const lifeLabel = state.word
  const occAction = occurrenceAction(e, now) // moment/space glyph: play / stop / reopen / null
  // WEB RESOURCE display title: when this entity fronts a web surface, the label is the fetched
  // page title (only for URLs long enough to be worth it) else the URL, cropped to a max width
  // with the full title+URL in a hover tooltip. Curated human names stay full. Non-web entities
  // keep their title verbatim.
  const web = e.webUrl
    ? webLabel({ webUrl: e.webUrl, webResourceId: e.webResourceId, webTitle: e.webTitle, title: e.title })
    : null
  const title = web ? web.display : e.title
  return {
    kind: e.kind,
    title,
    titleTooltip: web?.tooltip,
    webUrl: e.webUrl,
    webResourceId: e.webResourceId,
    kindLabel: km.label,
    hasDoneState: km.hasDoneState,
    filled: fillsGlyph(e), // fill on complete AND closed (fillable kinds)
    done,
    showCheck: done && km.hasDoneState,
    // Unified: derive cancellation from the STATE axis (getState already folds
    // isCancelled), so §0 and rows agree — previously §0 read isCancelled() directly.
    cancelled: state.word === "cancelled",
    requested,
    ongoing: ongoingNow, // running now (STATUS axis) ⇒ glyph rotates
    playable: occAction != null, // moment/space glyph drives its occurrence lifecycle
    occAction, // which one: play / stop / reopen
    markable: isMarkable(e), // live instant ⇒ glyph records an occurrence on click
    closed: isClosed(e), // ENDED ⇒ fade — NOT complete
    lifeLabel,
    // Compact summary folding the two axes + the done flag for display (they stay computed
    // separately): e.g. "done, ongoing, open" / "complete" / "ongoing, open, requested".
    stateLabel: `${done ? "done, " : ""}${ongoingNow ? "ongoing, " : ""}${lifeLabel}${requested ? ", requested" : ""}`,
    metaEcho: metaEcho(e, now),
    accent: e.accent,
  }
}

// ── FACES OF NON-ENTITIES (projections) ───────────────────────────────────────
// Not everything a Face shows is a live Entity. A STARTERS group aggregates many
// instances under one title; an ACTIVITY rollup/segment is PRESENCE (time in a place),
// and may even point at a since-deleted entity. These are PROJECTIONS — they have no
// lifecycle of their own, so they present only their kind (glyph shape) + a title (+ an
// optional aggregate echo the caller computes: "3 sessions", "1h 20m"). By resolving a
// projection into the SAME FaceModel an entity produces, a projection becomes a first-
// class Face — which is exactly what lets STARTERS/ACTIVITY render through <Zero0Face>.
//
// The caller is responsible for resolving the messy bits into a clean FaceLike: the
// AS-OF title (the name a place had back then, via titleAt), the deleted-entity/ROOT
// fallbacks, etc. The model layer stays pure and unaware of those concerns.
export interface FaceLike {
  /** Drives the glyph shape (defaults handled by the caller, e.g. a deleted place ⇒ space). */
  kind: EntityKind
  /** The title to show — already resolved by the caller (as-of, fallback, etc.). */
  title: string
  /** Optional own-accent (a projection rarely sets this; the glyph stays neutral if absent). */
  accent?: string
  /** Optional aggregate echo the caller computes (e.g. "3 sessions", "1h 20m tracked"). */
  metaEcho?: string
}

// Resolve a projection into a FaceModel. A projection has NO lifecycle, so every state
// flag is inert (no fill, no done, no cancel, no ongoing) — it presents just its kind +
// title (+ optional aggregate echo). `stateLabel` falls back to the title so tooltips/
// aria still read sensibly.
export function faceModelFromLike(like: FaceLike): FaceModel {
  const km = KIND_META[like.kind]
  return {
    kind: like.kind,
    title: like.title,
    kindLabel: km?.label ?? like.kind.toUpperCase(),
    hasDoneState: false,
    filled: false,
    done: false,
    showCheck: false,
    cancelled: false,
    requested: false,
    ongoing: false,
    playable: false, // a projection is inert — never a live playable entity
    occAction: null, // inert projection — no occurrence control
    markable: false, // a projection is inert — never a live markable instant
    closed: false,
    lifeLabel: "",
    stateLabel: like.title,
    metaEcho: like.metaEcho ?? "",
    accent: like.accent,
  }
}

// ── THE FULL FACE'S META ROWS (§0) ──────────────────���──────────────────────────
// The exhaustive key/value list shown at the `full` rung — raw lifecycle data,
// kind-aware. Moved verbatim from the canvas so the §0 dl has a single source.
// `now` drives the live DURATION/AGE count-up.
/** One segment of a rich START/END row: `text` is the padded display token (nbsp-padded so
 *  the monospace columns align between the two rows), `full` is the seconds-precision timestamp
 *  for a per-cell hover tooltip, `faint` dims a cell (the CLOSED tracked-session cells; the
 *  scheduled prefix and BOTH cells of the live OPEN session are NOT faint), and `pulse` marks BOTH
 *  cells of the single OPEN session (its start timestamp + its `ongoing` end, full-opacity +
 *  breathing together). */
export type ScheduleCell = { text: string; full?: string; faint?: boolean; pulse?: boolean }

/** Structured START/END rows for a span-bearing entity (moment/space), or `null` for others.
 *  OCCURRENCE-ONLY (v0.6.18) — the TOP-rail lifecycle, fully decoupled from access/session
 *  time (which now lives on the ACCESS row). Cell 0 is the CURRENT occurrence: the scheduled
 *  `startAt`/`endAt` (planned intent, not faint), with the END reading a pulsing `ongoing` when
 *  the occurrence is started-but-not-ended. The rest are ARCHIVED past occurrences (newest→oldest,
 *  faint), padded per-column so the Nth start sits directly above the Nth end. `getFaceMetaRows`
 *  flattens the same cells to a plain string for every other consumer. */
export function getScheduleCells(e: Entity, now: number): { start: ScheduleCell[]; end: ScheduleCell[] } | null {
  // v0.6.28: PLANNED span cells for any planned kind (task/moment/space/resource), not just spans.
  if (!isPlannedKind(e.kind)) return null
  const NB = "\u00A0"
  const s = e.schedule
  const cs = concreteStart(e) // concrete started moment, else null ("whenever"/unset)
  const liveOngoing = cs != null && s?.endAt == null // started, not yet ended → END pulses "ongoing"
  const startText0 = s?.startAt ? fmt(s.startAt) : "— (none scheduled)"
  const endText0 = liveOngoing ? "ongoing" : s?.endAt ? fmt(s.endAt) : "— (none scheduled)"
  // Pad the scheduled prefix so the FIRST archived column starts at the same x in both rows.
  const schedW = Math.max(startText0.length, endText0.length)
  const start: ScheduleCell[] = [
    { text: startText0.padEnd(schedW, NB), full: s?.startAt ? fmt(s.startAt) : undefined, pulse: liveOngoing },
  ]
  const end: ScheduleCell[] = [
    { text: endText0.padEnd(schedW, NB), full: !liveOngoing && s?.endAt ? fmt(s.endAt) : undefined, pulse: liveOngoing },
  ]
  // ARCHIVED occurrences — fixed past ticks (faint), newest first. These are the happened-history
  // accumulated by Reopen; they never pulse (they're done) and never merge with access sessions.
  const occs = [...(s?.occurrences ?? [])].sort((a, b) => b.startAt - a.startAt)
  for (const occ of occs) {
    const sTxt = fmtShort(occ.startAt, now)
    const eTxt = occ.endAt != null ? fmtShort(occ.endAt, now) : "—"
    const w = Math.max(sTxt.length, eTxt.length)
    start.push({ text: sTxt.padStart(w, NB), full: fmt(occ.startAt), faint: true })
    end.push({ text: eTxt.padStart(w, NB), full: occ.endAt != null ? fmt(occ.endAt) : undefined, faint: true })
  }
  return { start, end }
}

/**
 * Structured SESSION row — accumulated tracking time broken down per session. Returns the grand
 * `total` (Σ matching sessions, live-counting the open one) plus one segment PER session — each
 * reads `<duration> (<when>)` (e.g. `1h 04m (7:00 PM)`) with a `full` hover of the whole
 * `start – end`. `null` when there are NO matching sessions. Newest first. Filtered by `via`
 * (v0.6.26) so the two clocks render separately: ACCESS = `focus` (presence), PLAYED = `play`.
 */
export function getSessionCells(
  e: Entity,
  now: number,
  via?: "focus" | "play" | "mark",
): { total: string; segments: ScheduleCell[] } | null {
  const engs = getSessions(e)
    .filter((s) => (via ? s.via === via : true))
    .sort((a, b) => b.startAt - a.startAt)
  if (engs.length === 0) return null
  const totalMs = getSessionMs(e, now, via)
  const total = totalMs == null ? "—" : formatDuration(totalMs)
  const segments: ScheduleCell[] = engs.map((se) => {
    const open = se.endAt == null
    const ms = Math.max(0, (se.endAt ?? now) - se.startAt)
    const when = fmtShort(se.startAt, now)
    return {
      text: `${formatDuration(ms)} (${when})`,
      full: `${fmt(se.startAt)} – ${open ? "ongoing" : fmt(se.endAt as number)}`,
      pulse: open, // the live session's segment breathes
    }
  })
  return { total, segments }
}

/** ACCESS = per-session PRESENCE breakdown (focus sessions, middle rail). */
export function getAccessCells(e: Entity, now: number) {
  return getSessionCells(e, now, "focus")
}

// ─── DURATION = ongoing time (v0.6.33) ─────────────────────────────────────────
// The "how long the glyph was SPINNING" clock — the UNION of every interval during which the
// entity read `ongoing`. That is: each `play` session `[start, end||now]` PLUS, for moment/space,
// the concrete in-progress occurrence span (a moment happening spins even without a play session).
// UNION (merge overlapping intervals), not a naive sum, so a concurrent focus+play — or a play that
// overlaps its occurrence — is counted ONCE. Distinct from ACCESS (presence/focus, which can tick
// while NOT ongoing — a done task you're viewing) and from the OCCURRENCES count. OWN-ongoing only
// (a container's spinning-by-child rollup is deferred — see the plan's "Deferred").

/** Collect the raw ongoing intervals `[start, end]` (end clamped to `now` when live). */
function ongoingIntervals(e: Entity, now: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const se of getSessions(e)) {
    if (se.via !== "play") continue // ongoing is play-driven (v0.6.32)
    out.push([se.startAt, se.endAt ?? now])
  }
  // A moment/space that is concretely started-and-not-ended is ongoing FROM its occurrence, even
  // with no play session (mirrors getStateInner's concrete-start ⇒ ongoing rule).
  if (e.kind === "moment" || e.kind === "space") {
    const cs = concreteStart(e)
    if (cs != null) {
      const end = effectiveScheduleEnd(e.schedule)
      out.push([cs, end != null ? Math.min(end, now) : now])
    }
  }
  return out.filter(([lo, hi]) => hi > lo)
}

/** Merge overlapping/touching intervals; returns total covered ms + the merged spans (sorted). */
function mergeIntervals(intervals: Array<[number, number]>): { totalMs: number; merged: Array<[number, number]> } {
  if (intervals.length === 0) return { totalMs: 0, merged: [] }
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    const last = merged[merged.length - 1]
    if (cur[0] <= last[1]) last[1] = Math.max(last[1], cur[1]) // overlap/touch → extend
    else merged.push(cur)
  }
  const totalMs = merged.reduce((sum, [lo, hi]) => sum + (hi - lo), 0)
  return { totalMs, merged }
}

/** DURATION total = union of ongoing intervals, live-counting an open play. `null` when never ongoing. */
export function getOngoingDurationMs(e: Entity, now: number): number | null {
  const iv = ongoingIntervals(e, now)
  if (iv.length === 0) return null
  return mergeIntervals(iv).totalMs
}

/**
 * Structured DURATION row (parallels getSessionCells): grand `total` = union ms, plus one segment
 * per MERGED ongoing span reading `<duration> (<when>)`, newest first, the live span pulsing.
 * `null` when the entity has never been ongoing.
 */
export function getOngoingDurationCells(
  e: Entity,
  now: number,
): { total: string; segments: ScheduleCell[] } | null {
  const iv = ongoingIntervals(e, now)
  if (iv.length === 0) return null
  const { totalMs, merged } = mergeIntervals(iv)
  // The merged span that reaches `now` is the LIVE one (it was extended by an open play / in-progress
  // occurrence). Only that top span pulses + reads "ongoing".
  const liveHi = Math.max(...merged.map(([, hi]) => hi))
  const isOngoing = ongoingOpenSession(e) != null || ((e.kind === "moment" || e.kind === "space") && concreteStart(e) != null)
  const segments: ScheduleCell[] = [...merged]
    .sort((a, b) => b[0] - a[0]) // newest first
    .map(([lo, hi]) => {
      const live = isOngoing && hi === liveHi
      return {
        text: `${formatDuration(hi - lo)} (${fmtShort(lo, now)})`,
        full: `${fmt(lo)} – ${live ? "ongoing" : fmt(hi)}`,
        pulse: live,
      }
    })
  return { total: formatDuration(totalMs), segments }
}

// ─── PLANNED OCCURRENCES model (v0.6.30, Stage B slice 2) ──────────────────────
// A PLANNED occurrence = one intended span of "this should happen". Sources, unified:
//   • the PRIMARY scalar span (`schedule.startAt`/`endAt`) — the main planned occurrence, and
//   • each entry in `schedule.occurrences[]` — ADDITIONAL planned spans ("also Friday").
// Its STATUS is derived (never stored, except `cancelled`) so it can't rot: see occurrenceStatus.

export type OccurrenceStatus = "cancelled" | "fulfilled" | "missed" | "upcoming"

export interface PlannedOccurrence {
  startAt?: number // concrete epoch, or undefined ("whenever"/open)
  endAt?: number
  whenever?: boolean // startAt is the WHENEVER sentinel (playable, no fixed time)
  cancelled?: boolean
  primary?: boolean // the scalar span (vs an occurrences[] entry)
}

/** Does a session span overlap a planned occurrence's window? Open-ended occ ⇒ [start, ∞). */
function sessionOverlapsOccurrence(
  se: { startAt: number; endAt?: number },
  occStart: number | undefined,
  occEnd: number | undefined,
  now: number,
): boolean {
  if (occStart == null && occEnd == null) return false // nothing to overlap
  const seEnd = se.endAt ?? now // an open session counts live to now
  const lo = occStart ?? -Infinity
  const hi = occEnd ?? Infinity
  return se.startAt < hi && seEnd > lo
}

/**
 * PURE status of a planned occurrence — ORDER-INDEPENDENT (the `!fulfilled` guard on `missed` is
 * explicit, so re-ordering the cases can't change the result):
 *   • cancelled — the stored intent (the user struck it out).
 *   • fulfilled — ∃ a session (focus OR play) overlapping its window (it was honored — being
 *                 present during the planned time counts, not just a manual Play).
 *   • missed    — fully elapsed (`now > end`) AND not fulfilled (nothing happened in the window).
 *   • upcoming  — everything else (future, whenever/playable, or in-progress with no session yet).
 * An occurrence with no end can never be "missed" (we can't say the window has passed).
 */
export function occurrenceStatus(
  occ: PlannedOccurrence,
  sessions: { startAt: number; endAt?: number }[],
  now: number,
): OccurrenceStatus {
  if (occ.cancelled) return "cancelled"
  const fulfilled = sessions.some((se) => sessionOverlapsOccurrence(se, occ.startAt, occ.endAt, now))
  if (fulfilled) return "fulfilled"
  const missed = occ.endAt != null && now > occ.endAt && !fulfilled
  if (missed) return "missed"
  return "upcoming"
}

/** The unified list of planned occurrences (primary scalar span first, then occurrences[]). */
export function getPlannedOccurrences(e: Entity): PlannedOccurrence[] {
  const s = e.schedule
  const list: PlannedOccurrence[] = []
  const cs = concreteStart(e) // concrete epoch, else null ("whenever"/unset)
  const isWhenever = s?.startAt === WHENEVER
  if (cs != null || s?.endAt != null || isWhenever) {
    list.push({ startAt: cs ?? undefined, endAt: s?.endAt, whenever: isWhenever, primary: true })
  }
  for (const occ of s?.occurrences ?? []) {
    list.push({ startAt: occ.startAt, endAt: occ.endAt, cancelled: occ.cancelled })
  }
  return list
}

/**
 * DISPLAY word for an occurrence status (v0.6.31) — deliberately NOT "done"/"fulfilled":
 *   • matched — a session (presence OR play) coincided with the planned window. Chosen over
 *     "done" (which collides with a Task's DONE checkmark) and "fulfilled": the question this row
 *     answers is "did REALITY (a session) MATCH the PLAN (this scheduled span)?" — matched / missed
 *     is the natural pair for that.
 *   • missed — the window fully elapsed with no session in it.
 *   • upcoming / cancelled — self-explanatory.
 */
export function occurrenceStatusWord(status: OccurrenceStatus): string {
  return status === "fulfilled" ? "matched" : status // missed | upcoming | cancelled
}

/** One planned occurrence rendered as `<when>[–<end>] (<matched|missed|…>)`; sentinel/open handled. */
function formatPlannedOccurrence(occ: PlannedOccurrence, status: OccurrenceStatus, now: number): string {
  const when = occ.whenever
    ? "whenever"
    : occ.startAt != null
      ? fmtShort(occ.startAt, now)
      : occ.endAt != null
        ? `by ${fmtShort(occ.endAt, now)}`
        : "—"
  const span = occ.startAt != null && occ.endAt != null ? `${when}–${fmtShort(occ.endAt, now)}` : when
  return `${span} (${occurrenceStatusWord(status)})`
}

/**
 * The PLANNED OCCURRENCES §0 value (v0.6.31) — the tagged list itself, occurrence-led (NO leading
 * count summary): `Mon 1:00 PM–2:00 PM (matched) · Fri (upcoming) · Sat (missed)`. Reads left-to-
 * right as "each thing I planned, and whether reality matched it".
 *
 * `null` when the row adds nothing over PLANNED START/END — i.e. a single PRIMARY span that is
 * merely `matched` or `upcoming` (v0.6.31: a freshly-created+opened task auto-gets a session that
 * trivially "matches" its primary window, which made the old `1 done` prefix always-on noise). The
 * row earns its place only for MULTIPLE occurrences, or a `missed`/`cancelled` — the genuinely
 * informative cases. Fulfilment counts a focus OR play session (being present during the planned
 * window honours the plan); the separate OCCURRENCES row is the actual play-time clock.
 */
export function getPlannedOccurrenceRow(e: Entity, now: number): string | null {
  const planned = getPlannedOccurrences(e)
  if (planned.length === 0) return null
  const sessions = getSessions(e) // focus OR play both match a planned occurrence
  const tagged = planned.map((o) => [o, occurrenceStatus(o, sessions, now)] as const)
  const worth = tagged.length > 1 || tagged.some(([, st]) => st === "missed" || st === "cancelled")
  if (!worth) return null
  return tagged.map(([o, st]) => formatPlannedOccurrence(o, st, now)).join(" · ")
}

export function getFaceMetaRows(e: Entity, now: number): [string, string][] {
  const meta = KIND_META[e.kind]
  const rows: [string, string][] = []
  if (!meta) return rows
  rows.push(["id", e.id])
  rows.push(["kind", e.kind])
  rows.push(["created", fmt(getCreatedAt(e))])
  // PROVENANCE — who made it, who governs its lifecycle. Single-user: both resolve to
  // "Loris". Ids resolve to titles; an unknown id shows raw (e.g. a future remote actor).
  const nameOf = (uid: string) => getEntity(uid)?.title ?? uid
  rows.push(["creator", nameOf(getCreator(e))])
  rows.push(["owner", nameOf(getOwner(e))])
  // TITLE HISTORY — only when the entity has actually been renamed (>1 entry). Shows
  // the full chain oldest���newest with the time each name took effect, so the raw-data
  // view exposes what `titleAt(entity, t)` folds for the activity tracker.
  if (e.titleLog && e.titleLog.length > 1) {
    rows.push(["titles", e.titleLog.map((t) => `${t.title} (${fmt(t.at)})`).join("  →  ")])
  }
  // DONE — its own orthogonal row, TASKS only (the soft "I did this" marker).
  if (meta.hasDoneState) {
    const done = isDone(e)
    rows.push(["done", done ? `yes · ${fmt(getCompletedOn(e))}` : "no"])
  }
  // STATE — the single mutually-exclusive lifecycle row (open / complete / closed /
  // cancelled / dead / retired), replacing the old CLOSED + CANCELLED booleans. `open`
  // carries no date (CREATED above already says since when); other states carry theirs.
  if (meta.fillsWhenClosed || meta.terminal) {
    rows.push(["state", formatState(getState(e), fmt, meta.terminal === "death")])
  }
  // STATUS — the ORTHOGONAL action axis (running now), its own row so STATE keeps its true
  // lifecycle word. ALWAYS shown alongside STATE (like DONE/CLOSED): "ongoing · since …" while
  // running, else "idle" — the axis persists so stopping a run doesn't make the row vanish.
  if (meta.fillsWhenClosed || meta.terminal) {
    const since = getOngoingSince(e, now)
    rows.push(["status", since != null ? `ongoing · since ${fmt(since)}` : "idle"])
  }
  // CLOSE POLICY — only when MANUAL (auto is the silent default). Signals this entity
  // won't roll to closed at midnight; it waits for a hand Close/Cancel.
  if (e.closePolicy === "manual") rows.push(["close", "manual"])
  if (e.kind === "task" && e.requested) rows.push(["requested", "yes"])
  // TEMPORAL slots — a kind's defining time dimension is ALWAYS shown (as "—" when
  // unset), the same way DONE/CLOSED always render. A Moment IS a span, an Instant
  // IS a point, so hiding those rows when empty would hide the kind's essence.
  const s = e.schedule
  // PLANNED span rows (v0.6.28; ALWAYS-shown v0.6.31) — every PLANNED kind (task/moment/space/
  // resource) can carry a planned start/end, and the slots are now ALWAYS surfaced (— when unset),
  // exactly like DONE/STATE/PLANNED DURATION. Rationale (Loris, v0.6.31): the plan fields are a
  // MINIMUM affordance — once §0 is directly editable, an empty "planned start —" is the tap target
  // to plan on the current entity; hiding it until a `--field:value` was typed made planning
  // undiscoverable. These scalars are PURE PLANNING (user-set, never written by Play/punch —
  // v0.6.26); actual time lives on ACCESS/OCCURRENCES.
  if (isPlannedKind(e.kind)) {
    {
      // Plain-string fallback (block-rung subsets / `title` / non-rich consumers). The FULL §0 face
      // renders these RICHLY from the same `getScheduleCells`, so they never diverge.
      const cells = getScheduleCells(e, now)!
      rows.push(["planned start", cells.start.map((c) => c.text).join(" · ")])
      rows.push(["planned end", cells.end.map((c) => c.text).join(" · ")])
    }
    // A lone POINT anchor (`schedule.at`) — e.g. a `:mome` + single-time token, or an Instant
    // changed INTO a moment. The lifecycle reads it (`completeSince` uses `endAt ?? at`), so a past
    // `at` silently drives COMPLETE; surface it so such an entity doesn't read as unscheduled.
    if (s?.at != null) rows.push(["at", fmt(s.at)])
    // DUE — a task/resource deadline (distinct from a planned END: a due date is "must be done BY",
    // not "the span stops at"). Shown when set.
    if (s?.dueAt != null) rows.push(["due", fmt(s.dueAt)])
  } else if (e.kind === "instant") {
    // An instant is a TALLY of occurrences (marks + a passed scheduled `at`), not a span. The
    // OCCURRENCES row reads "<count> / <maxNb>" (the progress toward completion; maxNb omitted
    // when it's the default 1) followed by the individual mark timestamps newest-first.
    const count = getInstantOccurrenceCount(e, now)
    const max = getInstantMaxNb(e)
    const marks = getMarks(e)
    const tally = max > 1 ? `${count} / ${max}` : `${count}`
    const stamps = marks.length > 0 ? ` · ${marks.map((m) => fmt(m.startAt)).join(" · ")}` : ""
    rows.push(["occurrences", `${tally}${stamps}${isInstantMaxNbHard(e) ? " · hard cap" : ""}`])
    rows.push(["at", s?.at ? fmt(s.at) : "—"])
  } else if (s?.dueAt) {
    // Tasks (and other kinds) only surface a schedule row when one is actually set.
    rows.push(["due", fmt(s.dueAt)])
  } else if (s && (s.startAt || s.endAt || s.at)) {
    rows.push(["scheduled", s.at ? fmt(s.at) : `${fmt(s.startAt)} → ${fmt(s.endAt)}`])
  }
  // DURATION / AGE — the OCCURRENCE length (TOP rail): a start+end span's width, a live ongoing
  // occurrence counting up from `now`, the sum of archived occurrences[], or a being's age since
  // birth. DECOUPLED from access time (v0.6.18) — a merely-open "whenever" moment reads "—" here
  // even if you've spent time ON it (that shows on ACCESS below). SKIPPED for an INSTANT (a
  // zero-length point; its OCCURRENCES row is what matters).
  if (e.kind !== "instant") {
    // v0.6.26: three honest sources by kind, never crossing plan/actual —
    //   • moment/space → PLANNED DURATION: the plan span width ONLY (getPlannedDurationMs); "—"
    //     when nothing's planned (NOT the elapsed/session time — the bug this fixes).
    //   • beings        → AGE: now − birth.
    //   • everything else → DURATION: its occurrence length (getOccurrenceDurationMs).
    const isBeingKind = e.kind === "individual" || e.kind === "organism"
    const isPlanned = isPlannedKind(e.kind)
    const durLabel = isBeingKind ? "age" : isPlanned ? "planned duration" : "duration"
    const durMs = isPlanned ? getPlannedDurationMs(e) : getOccurrenceDurationMs(e, now)
    rows.push([durLabel, durMs == null ? "—" : formatDuration(durMs)])
  }
  // DURATION (v0.6.33) — the ACTUAL "how long the glyph was SPINNING" clock: the UNION of ongoing
  // intervals (play sessions + a moment/space's in-progress occurrence), live-counting an open play.
  // Distinct from PLANNED DURATION (the plan-span above), from ACCESS (presence — can tick while NOT
  // ongoing, e.g. a done task you're viewing), and from the OCCURRENCES count below. Shown for any
  // planned kind that has ever been ongoing; the FULL §0 face renders the segments richly (see
  // getOngoingDurationCells), the live span pulsing. Beings never spin (AGE covers them).
  if (isPlannedKind(e.kind)) {
    const dur = getOngoingDurationCells(e, now)
    if (dur) rows.push(["duration", [dur.total, ...dur.segments.map((c) => c.text)].join(" · ")])
  }
  // ACCESS — accumulated PRESENCE time (middle rail = "how long I've been on / looking at this"),
  // its own row for ANY kind that's been engaged, DECOUPLED from the durations above and from
  // ongoing (v0.6.32: presence ≠ ongoing — a done task you view still accrues ACCESS). Plain string
  // reads "<total> · <dur1> (<when1>) · …"; the FULL §0 face renders the segments richly.
  const access = getAccessCells(e, now)
  if (access) rows.push(["access", [access.total, ...access.segments.map((c) => c.text)].join(" · ")])
  // OCCURRENCES (v0.6.33) — now the COUNT + PLANNED-LIST row ("how many / which"), NOT a time sum
  // (the ongoing-time clock moved to DURATION above). It reads: `<N> times` (count of actual play
  // sessions = times it happened) then the planned-occurrence list with matched/missed status
  // (getPlannedOccurrenceRow — the old standalone "planned occurrences" row, now MERGED in here).
  // Shown when either side has something. SKIPPED for instant (its mark-tally occurrences row above).
  // v0.2.150: also HIDDEN for space / task / resource — for these the count is noise (a Space's
  // "N times" duplicates its session activity, a Task is a one-shot, a Resource isn't "occurred"),
  // so OCCURRENCES is reserved for the kinds where a recurrence count is meaningful (moment, etc.).
  const OCCURRENCES_HIDDEN_KINDS = new Set(["instant", "space", "task", "resource"])
  if (!OCCURRENCES_HIDDEN_KINDS.has(e.kind)) {
    // v0.6.34: count DELIBERATE plays only — an AUTO play (ongoing-on-enter) is presence, not a
    // deliberate occurrence ("I entered it" ≠ "it happened N times").
    const playCount = getSessions(e).filter((s) => s.via === "play" && !s.auto && s.endAt !== s.startAt).length
    const plannedList = isPlannedKind(e.kind) ? getPlannedOccurrenceRow(e, now) : null
    const parts: string[] = []
    if (playCount > 0) parts.push(`${playCount} ${playCount === 1 ? "time" : "times"}`)
    if (plannedList) parts.push(plannedList)
    if (parts.length > 0) rows.push(["occurrences", parts.join(" — ")])
  }
  // ACCENT — only when set (via `:color:`). The value is the raw hex; the dt cell
  // paints a matching swatch so the raw-data view still shows the color itself.
  if (e.accent) rows.push(["color", e.accent])
  // SEX — an Individual's defining identity field, always shown (— when unset), the
  // same way a Moment always shows its span. Individual-only.
  if (e.kind === "individual") rows.push(["sex", e.sex ? sexSymbol(e.sex) : "—"])
  // TAG LINKS — the recursive "also shows up in" web, both directions:
  //   • tags      = this entity's own outbound links (the contexts it plugs into).
  //   • tagged by = the DERIVED reverse — entities that name/reference THIS one, each with a
  //     when-label so multiple same-titled sessions ("Work on Zero") stay distinguishable.
  // Only shown when non-empty (a leaf with no links stays quiet).
  const forwardTags = getForwardTags(e)
  if (forwardTags.length > 0) {
    rows.push(["tags", forwardTags.map((t) => t.title).join(", ")])
  }
  const backRefs = getBackReferences(e.id)
  if (backRefs.length > 0) {
    rows.push(["tagged by", backRefs.map((b) => `${b.title} (${rangeLabel(b)})`).join(", ")])
  }
  return rows
}
