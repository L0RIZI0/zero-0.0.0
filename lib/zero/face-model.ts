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

import type { Entity, EntityKind } from "./types"
import { KIND_META, isClosed, fillsGlyph, getState, type EntityState } from "./kinds"
import { isDone, getCreatedAt, getCompletedOn } from "./entity-log"
import { getEntity, getCreator, getOwner, getForwardTags, getBackReferences } from "./data"
import { formatLocale } from "./format-locale"

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
const L_META_KEYS = new Set(["done", "state", "start", "end", "at", "due", "scheduled", "duration", "age"])
const XL_OMIT_KEYS = new Set(["id", "creator", "owner"])
export function filterMetaRows(rows: [string, string][], size: "l" | "xl" | "full"): [string, string][] {
  if (size === "full") return rows
  if (size === "xl") return rows.filter(([k]) => !XL_OMIT_KEYS.has(k))
  return rows.filter(([k]) => L_META_KEYS.has(k)) // l
}

// ── FORMATTERS (moved verbatim from zero0-canvas) ─────────────────────────────

// Format an epoch (ms) for the meta readout. Only ever called under the `mounted`
// gate, so it's client-only — no SSR/static-export time-freeze hydration trap.
export function fmt(epoch?: number): string {
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

// DERIVED duration of an entity, in ms, from its schedule (never stored):
//   • instant            → 0 (a point has no length)
//   • span start+end     → end − start
//   • ONGOING start-only → elapsed so far (now − start), so a running moment shows live
//   • else, has a start  → its AGE: now − createdAt (an Individual/Space has a beginning
//                          even with no schedule, so this reads as "3d" / "34y", never a dash)
//   • otherwise          → null (nothing to show)
// `now` is passed so a live/ongoing value updates as the canvas re-renders.
export function getDurationMs(e: Entity, now: number): number | null {
  const s = e.schedule
  if (e.kind === "instant") return 0
  if (s?.startAt != null && s?.endAt != null) return Math.max(0, s.endAt - s.startAt)
  if (s?.at != null) return 0
  if (s?.startAt != null) return Math.max(0, now - s.startAt) // ongoing (explicit start)
  const created = getCreatedAt(e)
  if (created != null) return Math.max(0, now - created) // age from creation
  return null
}

// Human-readable duration: up to THREE adjacent units, from the largest non-zero unit
// down — "0s", "45s", "5m 12s", "1h 30m 5s", "2d 3h 40m", "35y 1mo 24d". Scales to years
// so an Individual's age reads cleanly. Uses average month/year lengths (30.44d / 365.25d)
// — display-only, not for exact arithmetic. Trailing zero units are dropped, but a zero
// BETWEEN two shown units is kept (e.g. "1y 0mo 5d") so the tiers stay positionally clear.
const MIN = 60000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const MONTH = 30.44 * DAY
const YEAR = 365.25 * DAY
export function formatDuration(ms: number): string {
  if (ms < 1000) return "0s"
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
  if (first === -1) return "0s"
  const shown = parts.slice(first, first + 3)
  while (shown.length > 1 && shown[shown.length - 1][0] === 0) shown.pop()
  return shown.map(([v, u]) => `${v}${u}`).join(" ")
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
    case "ongoing":
      // A live span in progress — `at` is when it STARTED. No auto-close yet (no end set).
      return `ongoing · since ${format(state.at)}`
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
//   • instant   → its point time.
//   • task      → its due time; OR a scheduled span "start–end · dur" / ongoing "since start ·
//                 dur" / lone "at" (a task can carry start/end/duration too, not just a due).
//                 Due takes precedence when both are set.
//   • individual→ sex glyph · age (elapsed since birth/createdAt).
// Everything else (space/community/organism/resource/soul) stays quiet — the row's kind +
// title + state already say it all. `now` drives the live ongoing count-up.
export function metaEcho(e: Entity, now: number): string {
  const s = e.schedule
  // A start/end/at span shared by moments AND scheduled tasks.
  const span = (): string => {
    if (s?.startAt != null && s?.endAt != null)
      return `${fmtShort(s.startAt, now)}–${fmtShort(s.endAt, now)} · ${formatDuration(Math.max(0, s.endAt - s.startAt))}`
    if (s?.startAt != null) return `since ${fmtShort(s.startAt, now)} · ${formatDuration(Math.max(0, now - s.startAt))}`
    if (s?.at != null) return fmtShort(s.at, now)
    return ""
  }
  switch (e.kind) {
    case "moment":
      return span()
    case "instant":
      return s?.at != null ? fmtShort(s.at, now) : ""
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
}

// Derive the presentation model for an entity. Pure; call per render (cheap).
export function getFaceModel(e: Entity, now: number): FaceModel {
  const km = KIND_META[e.kind]
  const state = getState(e) // the single lifecycle position (STATE axis)
  const done = isDone(e) // soft DONE marker (Task only), orthogonal to STATE
  const requested = e.kind === "task" && !!e.requested
  const lifeLabel = state.word
  return {
    kind: e.kind,
    title: e.title,
    kindLabel: km.label,
    hasDoneState: km.hasDoneState,
    filled: fillsGlyph(e), // fill on complete AND closed (fillable kinds)
    done,
    showCheck: done && km.hasDoneState,
    // Unified: derive cancellation from the STATE axis (getState already folds
    // isCancelled), so §0 and rows agree — previously §0 read isCancelled() directly.
    cancelled: state.word === "cancelled",
    requested,
    ongoing: state.word === "ongoing", // live span ⇒ glyph rotates
    closed: isClosed(e), // ENDED ⇒ fade — NOT complete
    lifeLabel,
    stateLabel: `${done ? "done, " : ""}${lifeLabel}${requested ? ", requested" : ""}`,
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
    closed: false,
    lifeLabel: "",
    stateLabel: like.title,
    metaEcho: like.metaEcho ?? "",
    accent: like.accent,
  }
}

// ── THE FULL FACE'S META ROWS (§0) ─────────────────────────────────────────────
// The exhaustive key/value list shown at the `full` rung — raw lifecycle data,
// kind-aware. Moved verbatim from the canvas so the §0 dl has a single source.
// `now` drives the live DURATION/AGE count-up.
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
  // the full chain oldest→newest with the time each name took effect, so the raw-data
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
  // CLOSE POLICY — only when MANUAL (auto is the silent default). Signals this entity
  // won't roll to closed at midnight; it waits for a hand Close/Cancel.
  if (e.closePolicy === "manual") rows.push(["close", "manual"])
  if (e.kind === "task" && e.requested) rows.push(["requested", "yes"])
  // TEMPORAL slots — a kind's defining time dimension is ALWAYS shown (as "—" when
  // unset), the same way DONE/CLOSED always render. A Moment IS a span, an Instant
  // IS a point, so hiding those rows when empty would hide the kind's essence.
  const s = e.schedule
  if (e.kind === "moment") {
    rows.push(["start", s?.startAt ? fmt(s.startAt) : "—"])
    rows.push(["end", s?.endAt ? fmt(s.endAt) : "—"])
    // A Moment is conceptually a SPAN (start→end), but it can carry a lone POINT anchor
    // (`schedule.at`) — e.g. when a `:mome` prefix is combined with a single-time token,
    // or an Instant is later changed INTO a moment. The lifecycle machine reads that point
    // (`getState` → `completeSince` uses `endAt ?? at`), so a past `at` silently drives the
    // moment to COMPLETE + stamps its auto-close. Surface it here (was hidden, which made
    // such a moment read as unscheduled — START —, END — — yet mysteriously "complete").
    if (s?.at != null) rows.push(["at", fmt(s.at)])
  } else if (e.kind === "instant") {
    rows.push(["at", s?.at ? fmt(s.at) : "—"])
  } else if (s?.dueAt) {
    // Tasks (and other kinds) only surface a schedule row when one is actually set.
    rows.push(["due", fmt(s.dueAt)])
  } else if (s && (s.startAt || s.endAt || s.at)) {
    rows.push(["scheduled", s.at ? fmt(s.at) : `${fmt(s.startAt)} → ${fmt(s.endAt)}`])
  }
  // DURATION / AGE — DERIVED length, shown for every entity: an instant is always 0s; a
  // start+end span is its width; a start-only (ONGOING) entity counts up live from `now`;
  // with no schedule start it falls back to the age since `createdAt`. For an Individual
  // (whose createdAt IS a birth) the label reads AGE — the elapsed-since-birth framing —
  // rather than DURATION. Never stored — always computed.
  const durMs = getDurationMs(e, now)
  const durLabel = e.kind === "individual" ? "age" : "duration"
  rows.push([durLabel, durMs == null ? "—" : formatDuration(durMs)])
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
