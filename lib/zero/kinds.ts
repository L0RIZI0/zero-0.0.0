import type { Entity, EntityKind, Session, Schedule } from "./types"
import { WHENEVER } from "./types"
import {
  isDone,
  getCompletedOn,
  getCloseState,
  isCancelled,
  getExplicitComplete,
  getCompleteOn,
  getCreatedAt,
} from "./entity-log"

/**
 * Per-kind SEMANTICS — the single source of truth for what each entity kind
 * means and how it behaves around the two lifecycle axes. Consumed by the glyph,
 * the root canvas, the entity menu, and the "Zero Entities" doc page.
 *
 * THE MODEL (Jul 2026 — STATE axis). An entity's lifecycle is ONE position on a
 * mutually-exclusive STATE axis, derived by {@link getState}:
 *
 *     open  →  complete  →  closed        (+ cancelled, and terminal dead/retired)
 *   outline    FILLED       FILLED+faded
 *
 *   - OPEN     — live, nothing terminal reached. Glyph outline.
 *   - COMPLETE — the positive terminal is REACHED but not yet filed. INTERIM: the
 *      glyph FILLS (bright, full opacity) but the row does NOT fade — it is still
 *      "live, awaiting overnight filing". Complete NO LONGER closes anything.
 *   - CLOSED   — filed away at the stamped midnight (`entity.closeAt`). Glyph stays
 *      filled and the row FADES. For terminal kinds this reads DEAD / RETIRED (and
 *      the glyph does NOT fill — it just fades, keeping its outline).
 *   - CANCELLED — called off (bar over glyph + strike + fade); its own flag.
 *
 * DONE is a SEPARATE, orthogonal axis (Task only): a soft checkmark meaning "I did
 * this", which for the owner ALSO makes the task complete (see data.ts write path).
 * A task can thus be done-and-complete yet still OPEN-looking until its midnight close.
 *
 * WHOSE MIDNIGHT: the close instant is STAMPED once as an absolute epoch (`closeAt`)
 * in the actor's local day, so every viewer flips Complete→Closed at the same real
 * moment regardless of timezone (see the `closeAt` doc in types.ts).
 *
 * Two STATIC per-kind flags: `hasDoneState` (Task only now) and `fillsWhenClosed`
 * (task/space/resource/moment/instant fill; terminal kinds only fade).
 */
export interface KindMeta {
  /** Display name, e.g. "Task". */
  label: string
  /** One-line description shown on the Zero Entities page. */
  description: string
  /** Whether the user can create one from the new-entity affordances. */
  creatable: boolean
  /** Can hold the soft DONE checkmark (its own axis). Task / Moment / Instant only. */
  hasDoneState: boolean
  /** When CLOSED, the glyph fills its silhouette. False for terminal kinds (they only fade). */
  fillsWhenClosed: boolean
  /**
   * Terminal lifecycle flavor: "retire" (community) or "death" (organism/individual).
   * `null` = a normal fillable close, or system-only (soul).
   */
  terminal: "retire" | "death" | null
}

export const KIND_META: Record<EntityKind, KindMeta> = {
  task: {
    label: "Task",
    description: "A thing to do",
    creatable: true,
    hasDoneState: true,
    fillsWhenClosed: true,
    terminal: null,
  },
  space: {
    label: "Space",
    description: "A context that holds things",
    creatable: true,
    hasDoneState: false,
    fillsWhenClosed: true,
    terminal: null,
  },
  resource: {
    label: "Resource",
    description: "An asset, reference, or tool",
    creatable: true,
    hasDoneState: false,
    fillsWhenClosed: true,
    terminal: null,
  },
  moment: {
    label: "Moment",
    description: "A span in time",
    creatable: true,
    // DONE is a Task-only marker now. A Moment is not "done" — it simply becomes
    // COMPLETE once its end passes, and CLOSES (fills + fades) at the next midnight.
    hasDoneState: false,
    fillsWhenClosed: true,
    terminal: null,
  },
  instant: {
    label: "Instant",
    description: "A point in time",
    creatable: true,
    // Like a Moment: no DONE marker; complete once its point passes, closes at midnight.
    hasDoneState: false,
    fillsWhenClosed: true,
    terminal: null,
  },
  community: {
    label: "Community",
    description: "A place to gather people and discussions",
    creatable: true,
    hasDoneState: false,
    fillsWhenClosed: false,
    terminal: "retire",
  },
  organism: {
    label: "Organism",
    description: "A company, a point of view",
    creatable: true,
    hasDoneState: false,
    fillsWhenClosed: false,
    terminal: "death",
  },
  individual: {
    label: "Individual",
    // TEMPORARILY creatable (Jul 2026) so the user can dogfood people/other Individuals
    // directly; normally an Individual is spawned with a Soul, not created ad hoc.
    description: "A person, animated by a Soul",
    creatable: true,
    hasDoneState: false,
    fillsWhenClosed: false,
    terminal: "death",
  },
  soul: {
    label: "Soul",
    description: "The animating self behind a person",
    creatable: false,
    hasDoneState: false,
    fillsWhenClosed: false,
    terminal: null,
  },
}

/** Whether a kind can hold the soft DONE checkmark (task/moment/instant). */
export function hasDoneState(kind: EntityKind): boolean {
  return KIND_META[kind].hasDoneState
}

/** Whether a kind's glyph FILLS when it closes (fillable kinds; not terminal ones). */
export function fillsWhenClosed(kind: EntityKind): boolean {
  return KIND_META[kind].fillsWhenClosed
}

/**
 * A "BEING" — the WHO kinds (soul / individual / organism / community), as opposed to the
 * WHAT/WHEN containers (task / space / moment / instant). A being's resting state is its
 * OWN presence (alive / present), never "in progress": it is NEVER made "ongoing" by the
 * containment rollup (a person isn't "ongoing" just because something inside them runs —
 * they're ALIVE). So the ongoing rollup STOPS at the first being ancestor. See getState (3).
 */
export function isBeing(kind: EntityKind): boolean {
  return kind === "soul" || kind === "individual" || kind === "organism" || kind === "community"
}

/**
 * A "PLANNED" kind (v0.6.28) — an actionable/schedulable thing that can carry a PLANNED span
 * (planned start / end / duration): task · moment · space · resource. Generalizes the planning
 * affordance beyond the moment/space span-essence: a Task is just as plannable (start it Monday,
 * due Friday, budget 2h). EXCLUDES beings (they persist → AGE, not a plan) and instants (a POINT +
 * a mark tally, not a span). moment/space still surface the planned rows ALWAYS (a span is their
 * essence); task/resource surface them when actually set.
 */
export function isPlannedKind(kind: EntityKind): boolean {
  return kind === "task" || kind === "moment" || kind === "space" || kind === "resource"
}

/**
 * Whether `entity` is in its TERMINAL end-state (retired / dead). Inert today —
 * nothing sets `retiredOn`/`diedOn` yet — but wires the model so the glyph can
 * render a terminal mark for community/organism/individual.
 */
export function isTerminal(entity: Entity): boolean {
  if (entity.kind === "community") return entity.retiredOn != null
  if (entity.kind === "organism" || entity.kind === "individual") return entity.diedOn != null
  return false
}

/** The first LOCAL midnight strictly AFTER `epoch` (start of the next day). */
export function nextLocalMidnight(epoch: number): number {
  const d = new Date(epoch)
  d.setHours(0, 0, 0, 0) // midnight opening the day of `epoch`
  d.setDate(d.getDate() + 1) // → the next midnight
  return d.getTime()
}

/** Whole years elapsed between two epochs. */
function yearsBetween(from: number, to: number): number {
  const a = new Date(from)
  const b = new Date(to)
  let y = b.getFullYear() - a.getFullYear()
  const m = b.getMonth() - a.getMonth()
  if (m < 0 || (m === 0 && b.getDate() < a.getDate())) y--
  return Math.max(0, y)
}

/** Whole months elapsed between two epochs (calendar-aware, for sub-1-year ages). */
function monthsBetween(from: number, to: number): number {
  const a = new Date(from)
  const b = new Date(to)
  let mo = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  if (b.getDate() < a.getDate()) mo--
  return Math.max(0, mo)
}

/**
 * A human-readable AGE (lifespan) between birth and death, ALWAYS naming its unit so
 * there's no ambiguity — a life can sadly be measured in years, months, weeks, days,
 * hours, or even minutes. Picks the largest unit that yields a whole count ≥ 1; falls
 * back to "0 minutes" for the degenerate same-instant case. Pluralized ("1 year" /
 * "3 years").
 */
export function formatAge(from: number, to: number): string {
  const unit = (n: number, label: string) => `${n} ${label}${n === 1 ? "" : "s"}`
  const ms = Math.max(0, to - from)
  const years = yearsBetween(from, to)
  if (years >= 1) return unit(years, "year")
  const months = monthsBetween(from, to)
  if (months >= 1) return unit(months, "month")
  const days = Math.floor(ms / 86_400_000)
  if (days >= 7) return unit(Math.floor(days / 7), "week")
  if (days >= 1) return unit(days, "day")
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 1) return unit(hours, "hour")
  return unit(Math.floor(ms / 60_000), "minute")
}

/** The mutually-exclusive lifecycle positions on the STATE axis (a being's *being* — see
 *  {@link getState}). This axis is ORTHOGONAL to the STATUS axis ("ongoing", the action of
 *  running right now — see {@link isOngoing}) and to the Task-only `done` FLAG (see {@link isDone}):
 *  an entity can be `open` AND ongoing, or `complete` AND not, etc. STATE never carries "ongoing"
 *  or "done" — those live on their own axes so a running entity keeps its true lifecycle position.
 *  `scheduled` = a not-yet-terminal INSTANT that carries a concrete `at` anchor (planned, but
 *  its occurrence(s) haven't completed it): open (no schedule) · scheduled · complete · closed
 *  · cancelled are the instant's positions (an instant is a point, so never ongoing). */
export type StateWord = "open" | "scheduled" | "complete" | "closed" | "cancelled" | "dead" | "retired"

/**
 * An entity's current lifecycle STATE — one position on the STATE axis, plus the
 * timestamp that position took effect and (for complete) when it will close.
 */
export interface EntityState {
  word: StateWord
  /** When this state took effect (epoch ms): complete-since, closed-at, cancelled-on… */
  at?: number
  /** For `complete`: the stamped instant it will become `closed`. */
  willCloseAt?: number
  /** For a reopened (`open`) entity: when it was reopened. */
  reopenedAt?: number
  /**
   * For a `dead` Individual/Organism: the lifespan as a human-readable string that
   * always names its unit (e.g. "35 years", "3 months", "5 days", "42 minutes"),
   * computed by {@link formatAge}. Present only when the birth instant is known.
   */
  age?: string
}

// ── "Whenever" sentinel guards ────────────────────────────────────────────────
// A `startAt` may be a concrete epoch, the `"whenever"` sentinel (playable, no fixed
// time), or undefined. EVERY comparison (`now >= startAt`, sorting, arithmetic) must
// go through these so the sentinel is never treated as a number. `isConcreteStart` is
// a type guard that narrows to `number` for the compiler.

/** True (and narrows to `number`) when a startAt value is a concrete epoch. */
export function isConcreteStart(v: number | typeof WHENEVER | undefined): v is number {
  return typeof v === "number"
}

/** True when a startAt value is the `"whenever"` sentinel (a playable, timeless thing). */
export function isWheneverStart(v: number | typeof WHENEVER | undefined): boolean {
  return v === WHENEVER
}

/** An entity's concrete startAt epoch, or null if it is "whenever" / unset. */
export function concreteStart(entity: Entity): number | null {
  const v = entity.schedule?.startAt
  return isConcreteStart(v) ? v : null
}

/**
 * The EFFECTIVE end of a schedule's span: the declared `endAt` if present, ELSE a
 * concrete `startAt` + `duration` (minutes) treated as an IMPLIED end. This is the one
 * place the "start + duration ⇒ end" rule lives, so state transitions, close timing,
 * bounds/sorting, and the dayline paint all agree that a start-plus-duration span ends
 * at `start + duration`. Returns null when there's no way to know an end (no declared
 * end, and no concrete-start+duration pair — e.g. a "whenever" or open-ended thing).
 */
export function effectiveScheduleEnd(s: Schedule | undefined): number | null {
  if (!s) return null
  if (s.endAt != null) return s.endAt
  const start = typeof s.startAt === "number" ? s.startAt : null
  if (start != null && s.duration != null && s.duration > 0) return start + s.duration * 60000
  return null
}

/** Entity-level convenience over {@link effectiveScheduleEnd}. */
export function effectiveEndAt(entity: Entity): number | null {
  return effectiveScheduleEnd(entity.schedule)
}

/**
 * True when the entity is PLAYABLE — a live Moment/Space with NO fixed clock anchor, so its
 * glyph offers Play/Stop to open/close a background session on demand. "No fixed anchor" =
 * `startAt` is the `"whenever"` sentinel OR simply UNSET (v0.6.9: null starts joined whenever —
 * there was never a reason to exclude them; both mean "a real trackable thing with no time").
 * A CONCRETE start is deliberately excluded: a past one is already ongoing by its own span
 * (End it, don't Stop a session on top), and a future one arrives on its own. ENDED entities
 * aren't playable either (their times are historical) — this matches the menu's `!ended` guard.
 */
export function isPlayable(entity: Entity): boolean {
  if (entity.kind !== "moment" && entity.kind !== "space") return false
  if (isClosed(entity)) return false
  const start = entity.schedule?.startAt
  return isWheneverStart(start) || start == null
}

/**
 * True when the entity is MARKABLE — a live INSTANT whose glyph records an OCCURRENCE (a
 * point in time) on each click. An instant is a POINT, not a span, so it never opens a
 * running session; instead each mark is a zero-length session (`endAt === startAt`,
 * via `"mark"`) appended to `schedule.sessions` — a growing tally of timestamps.
 * Ended instants aren't markable (their occurrences are historical).
 */
export function isMarkable(entity: Entity, now: number = Date.now()): boolean {
  if (entity.kind !== "instant") return false
  if (isClosed(entity, now)) return false
  // A HARD maxNb cap stops accepting marks once the required occurrences are reached (complete).
  // A soft cap (default) still lets you mark beyond max — the instant just stays complete.
  if (isInstantMaxNbHard(entity) && getInstantOccurrenceCount(entity, now) >= getInstantMaxNb(entity)) {
    return false
  }
  return true
}

/**
 * The OCCURRENCE affordance a Moment/Space glyph offers right now (v0.6.18). The top-rail
 * lifecycle: `play` → start an occurrence, `stop` → end the running one, `reopen` → archive the
 * finished span and go playable again. `null` for kinds that don't have an occurrence lifecycle
 * (task/resource/beings/instant — instants use marks instead).
 *   • not-started (whenever, or a future-scheduled start) → "play"
 *   • running (concrete start in the past, not yet ended) → "stop"
 *   • complete (a finished/closed occurrence) → "reopen"
 */
export function occurrenceAction(
  entity: Entity,
  now: number = Date.now(),
): "play" | "stop" | "reopen" | null {
  if (entity.kind !== "moment" && entity.kind !== "space") return null
  const st = entity.schedule?.startAt
  const started = isConcreteStart(st) && (st as number) <= now
  if (started) {
    // Running until it has an endAt in the past (or is otherwise closed) → then it's complete.
    return isClosed(entity, now) ? "reopen" : "stop"
  }
  // Not yet started. If it's somehow already closed (e.g. cancelled), offer reopen; else play.
  return isClosed(entity, now) ? "reopen" : "play"
}

/** The OCCURRENCE marks tallied on an instant (zero-length `via:"mark"` sessions), newest
 *  first. [] for any non-instant or an instant with no marks yet. */
export function getMarks(entity: Entity): Session[] {
  if (entity.kind !== "instant") return []
  return getSessions(entity)
    .filter((e) => e.via === "mark")
    .sort((a, b) => b.startAt - a.startAt)
}

/**
 * MAX authorized OCCURRENCES an INSTANT needs before it COMPLETES. Default 1 (a unique
 * occurrence). `--maxnb:3` requires three. Only meaningful for instants.
 */
export function getInstantMaxNb(entity: Entity): number {
  const n = entity.schedule?.maxNb
  return typeof n === "number" && n >= 1 ? Math.floor(n) : 1
}

/** True when `maxNb` is a HARD cap: once complete, NO further marks are accepted (`--maxnbhard`). */
export function isInstantMaxNbHard(entity: Entity): boolean {
  return entity.schedule?.maxNbHard === true
}

/**
 * An instant's OCCURRENCE timestamps, ASCENDING. Each mark is one occurrence, AND a scheduled
 * `at` counts as one automatic occurrence once it has passed (`now >= at`). This is the single
 * definition of "how many times has this happened" that completion, close-timing, and the §0
 * readout all share. [] for non-instants.
 */
export function getInstantOccurrences(entity: Entity, now: number = Date.now()): number[] {
  if (entity.kind !== "instant") return []
  const times = getMarks(entity).map((m) => m.startAt)
  const at = entity.schedule?.at
  if (at != null && now >= at) times.push(at)
  return times.sort((a, b) => a - b)
}

/** How many occurrences an instant has accumulated (marks + a passed scheduled `at`). */
export function getInstantOccurrenceCount(entity: Entity, now: number = Date.now()): number {
  return getInstantOccurrences(entity, now).length
}

// ── Session reads (pure — sessions live ON the entity) ─────────────────────────
// The CANONICAL store of punch-ins/outs is `schedule.sessions` (see types.ts). These
// pure reads let getState derive "ongoing" with zero dependency on the current view,
// which is what makes a Task read ongoing EVERYWHERE it appears. Write helpers
// (openSession/closeSession) live in data.ts.

/** All of an entity's tracked sessions (oldest first); [] if none. */
export function getSessions(entity: Entity): Session[] {
  return entity.schedule?.sessions ?? []
}

/**
 * The OPEN session (lacking `endAt`), or null. With `via` given, the last open session OF THAT
 * VIA; without it, the last open session of ANY via. v0.6.32: presence (`focus`) and ongoing
 * (`play`) can now be open CONCURRENTLY on the same entity, so callers that mean one specific
 * rail must pass `via`. Marks (`endAt === startAt`) are never "open". Scans from the end so the
 * MOST-RECENT matching open session wins.
 */
export function getOpenSession(entity: Entity, via?: Session["via"]): Session | null {
  const s = getSessions(entity)
  for (let i = s.length - 1; i >= 0; i--) {
    const e = s[i]
    if (e.endAt == null && (via == null || e.via === via)) return e
  }
  return null
}

/**
 * The open session that makes THIS entity read `ongoing` (v0.6.32: PLAY-ONLY). Ongoing is now
 * driven exclusively by an open `play` session — `focus` (presence/viewing) NEVER flips state for
 * ANY kind. This replaces the old per-kind special-casing (moment/instant/being) with a single
 * rule: play spins the glyph, focus only accrues ACCESS. task/resource/space auto-open a `play`
 * on enter (see canvas), so they still spin on enter; beings never do; a moment/space also spins
 * from a concrete in-progress occurrence (handled separately in getStateInner).
 */
export function ongoingOpenSession(entity: Entity): Session | null {
  return getOpenSession(entity, "play")
}

/** Whether the entity has an open session right now (optionally of a specific `via`). */
export function hasOpenSession(entity: Entity, via?: Session["via"]): boolean {
  return getOpenSession(entity, via) != null
}

/**
 * OWN ongoing — is this entity ongoing BY ITSELF (not merely by rollup from a contained
 * descendant)? Mirrors getState sources (1) + (2), deliberately EXCLUDING (3) the rollup:
 *   (1) an open SESSION (Task focus / Whenever play), or
 *   (2) a Moment/Space with a CONCRETE started span still in progress.
 * This is the set the §4 PINS band lists — the entities you can directly END (a container
 * that only spins by rollup can't be ended here; you'd end its running child instead).
 */
export function isOwnOngoing(entity: Entity, now: number = Date.now()): boolean {
  // A TERMINAL / complete entity, or a Done task, is NEVER ongoing (isOngoing already applies
  // that guard + all three sources). Presence (focus) is lifecycle-independent (a done task can
  // hold a LIVE focus session so ACCESS keeps counting while you view it), so we must NOT let
  // that session make the done task read own-ongoing / endable in the PINS band. If it isn't
  // ongoing at all, bail; if it IS, the own-checks below tell whether that's by its OWN
  // session/span (true) or merely a contained descendant's rollup (false).
  if (!isOngoing(entity, now)) return false
  // State-relevant open session (a focus/viewing session on a moment/instant does NOT count).
  if (ongoingOpenSession(entity) != null) return true
  if (entity.kind === "moment" || entity.kind === "space") {
    const start = concreteStart(entity)
    if (start != null && now >= start) {
      const end = effectiveScheduleEnd(entity.schedule)
      if (end == null || now < end) return true
    }
  }
  return false
}

// ── Child-gated Task completion (resolver injection) ───────────────────────────
// A Task marked Done isn't COMPLETE until every child of `kind === "task"` is complete
// (non-task children never gate). `completeSince` needs the child list, but kinds.ts is
// a LOWER module than data.ts (data imports kinds), so we can't import getChildren here.
// data.ts injects it once at init via `setChildrenResolver`. If unset (shouldn't happen
// at runtime), completion is NOT gated — the pre-existing "Done ⇒ complete" behavior.

type ChildrenResolver = (id: string) => Entity[]
let _childrenResolver: ChildrenResolver | null = null

/** Wire the child lookup used by child-gated Task completion (called by data.ts init). */
export function setChildrenResolver(fn: ChildrenResolver): void {
  _childrenResolver = fn
}

// CONTAINMENT-only children (parentId links ONLY, NEVER taggedContextIds). Used by the
// ongoing ROLLUP, which must follow CONTAINMENT and never tag references — otherwise a
// tagged-in ongoing entity would wrongly light up the entity it's tagged into. This is a
// SEPARATE resolver from `_childrenResolver` (which is `getChildren`, mixing parent + tags).
let _containedResolver: ChildrenResolver | null = null

/** Wire the containment-only child lookup used by the ongoing rollup (called by data.ts init). */
export function setContainedResolver(fn: ChildrenResolver): void {
  _containedResolver = fn
}

/**
 * ONGOING ROLLUP — is any CONTAINED descendant of `entity` ongoing? Follows `parentId`
 * containment only (never tags). Recurses through the subtree, short-circuiting on the
 * first ongoing descendant; `seen` guards against cycles. Returns the ongoing descendant's
 * start instant (for the `at`) or null if none.
 */
function containedOngoingSince(entity: Entity, now: number, seen: Set<string>): number | null {
  if (!_containedResolver) return null
  if (seen.has(entity.id)) return null
  seen.add(entity.id)
  for (const child of _containedResolver(entity.id)) {
    const at = ongoingSince(child, now, seen)
    if (at != null) return at
  }
  return null
}

/**
 * Whether every `kind === "task"` descendant that gates completion is itself complete
 * (or closed/cancelled — i.e. no longer pending). Recurses so a whole subtree must be
 * done; `seen` guards `taggedContextIds` cycles. Non-task children are ignored.
 */
function allTaskChildrenComplete(entity: Entity, now: number, seen = new Set<string>()): boolean {
  if (!_childrenResolver) return true
  if (seen.has(entity.id)) return true
  seen.add(entity.id)
  for (const child of _childrenResolver(entity.id)) {
    if (child.kind !== "task") continue
    const w = stateWordFor(child, now, seen)
    // Pending (still to do) → blocks the parent. Complete/closed/cancelled → doesn't.
    if (w !== "complete" && w !== "closed" && w !== "cancelled" && w !== "dead" && w !== "retired") {
      return false
    }
  }
  return true
}

/**
 * The state word of `child`, threading the cycle-guard `seen` set so nested child-gated
 * completion checks can't infinitely recurse. Thin wrapper over getState used only by
 * allTaskChildrenComplete (getState itself stays the public, seed-set-free entry point).
 */
function stateWordFor(child: Entity, now: number, seen: Set<string>): StateWord {
  return getStateInner(child, now, seen).word
}

/**
 * The stamped ABSOLUTE close instant an entity SHOULD carry given its current terminal
 * event — computed once, in the caller's local day, and frozen by the write paths onto
 * `entity.closeAt` (see types.ts). Pure; callers persist the result.
 *   - TASK: the next local midnight after it was marked done (else none).
 *   - MOMENT/INSTANT: the next local midnight after its end/point (else none).
 *   - everything else: none (they close only manually).
 * `now` backfills a done task that somehow lacks a `completedOn`.
 */
export function computeCloseAt(entity: Entity, now: number = Date.now()): number | undefined {
  // A manual close policy opts OUT of any stamped time-close (belt-and-braces alongside
  // the getState guard) — such entities close only by an explicit hand action.
  if (entity.closePolicy === "manual") return undefined
  if (entity.kind === "task") {
    return isDone(entity) ? nextLocalMidnight(getCompletedOn(entity) ?? now) : undefined
  }
  if (entity.kind === "moment") {
    // END only — a Moment is a SPAN, and only its END closes it. A lone point anchor
    // (`schedule.at`) is NO LONGER treated as an end: a started-but-unended moment stays
    // ONGOING (see getState) until an end is set. (Instants keep their point semantics.)
    // A start+duration counts as an implied end (effectiveScheduleEnd).
    const end = effectiveScheduleEnd(entity.schedule)
    return end != null ? nextLocalMidnight(end) : undefined
  }
  if (entity.kind === "instant") {
    // Like a Moment, an instant FILES at the next local midnight — anchored on its LATEST
    // occurrence (its most recent mark, or a scheduled `at`), so a marked-today instant closes
    // tonight. No occurrence and no scheduled anchor ⇒ nothing to close on (stays open).
    const occ = getInstantOccurrences(entity, now)
    const anchor = occ.length ? occ[occ.length - 1] : entity.schedule?.at ?? entity.schedule?.endAt
    return anchor != null ? nextLocalMidnight(anchor) : undefined
  }
  return undefined
}

/**
 * When (if ever) `entity` reached its positive terminal — i.e. became COMPLETE —
 * IGNORING whether it has since closed. Returns that instant, or null if not complete.
 *   - TASK: complete the moment it is Done (single-user: done ⇒ complete). `completedOn`.
 *   - MOMENT/INSTANT: complete once its end/point is in the past. That end epoch.
 *   - LEGACY: a persisted explicit `complete` verdict from old data.
 */
function completeSince(entity: Entity, now: number, seen?: Set<string>): number | null {
  if (entity.kind === "task") {
    // Done is necessary but NOT sufficient: a Done task with any still-pending
    // `kind === "task"` child reads "done but open" (returns null here → not complete)
    // and AUTOCOMPLETES once every task child is complete. Non-task children never gate.
    if (!isDone(entity)) return null
    if (!allTaskChildrenComplete(entity, now, seen ?? new Set<string>())) return null
    return getCompletedOn(entity) ?? getCreatedAt(entity) ?? now
  }
  if (entity.kind === "moment") {
    // END only (see computeCloseAt): a moment completes when its span ENDS. With no end
    // set, it never auto-completes — a past start makes it ONGOING, not complete. A
    // start+duration counts as an implied end (effectiveScheduleEnd).
    const end = effectiveScheduleEnd(entity.schedule)
    return end != null && now >= end ? end : null
  }
  if (entity.kind === "instant") {
    // COMPLETE once the instant has accumulated its MAX authorized occurrences (marks + a
    // passed scheduled `at`). Default maxNb 1 ⇒ a unique occurrence: completes the moment its
    // scheduled `at` passes, or on its first mark. complete-at = the time the Nth occurrence
    // landed (the instant the requirement was met).
    const times = getInstantOccurrences(entity, now)
    const need = getInstantMaxNb(entity)
    return times.length >= need ? times[need - 1] : null
  }
  if (getExplicitComplete(entity) === true) return getCompleteOn(entity) ?? getCreatedAt(entity) ?? now
  return null
}

/**
 * The SINGLE source of truth for an entity's lifecycle position. Everything else
 * (glyph fill, row fade, the meta STATE row, the menu wording) derives from this.
 * Priority: cancelled > closed (manual or stamped-midnight) > reopened-open > complete
 * (interim) > open. `now` is injectable for testing.
 */
export function getState(entity: Entity, now: number = Date.now()): EntityState {
  return getStateInner(entity, now, new Set<string>())
}

/**
 * The real getState body, threading a `seen` set so the child-gated Task-completion
 * check (see allTaskChildrenComplete) can't infinitely recurse through
 * `taggedContextIds` cycles. Public callers use {@link getState}.
 */
function getStateInner(entity: Entity, now: number, seen: Set<string>): EntityState {
  const meta = KIND_META[entity.kind]
  if (isCancelled(entity)) return { word: "cancelled", at: entity.cancelledOn }

  const closeState = getCloseState(entity) // "closed" | "reopened" | null
  const manualClosed = closeState === "closed"
  // A reopen override suppresses the stamped time-close (as well as manual close, which
  // Reopen also clears). A `manual` close policy ALSO suppresses it — such an entity never
  // auto-closes; it rests at Complete/Ongoing until someone Closes or Cancels it by hand.
  // Otherwise the frozen `closeAt` decides — the SAME instant for every viewer, so
  // timezones can't disagree on open-vs-closed.
  const timeClosed =
    entity.closePolicy !== "manual" &&
    closeState !== "reopened" &&
    entity.closeAt != null &&
    now >= entity.closeAt
  if (manualClosed || timeClosed) {
    const at = manualClosed ? entity.closedOn ?? entity.closeAt : entity.closeAt
    if (meta.terminal === "death") {
      const born = getCreatedAt(entity)
      const age = born != null && at != null ? formatAge(born, at) : undefined
      return { word: "dead", at, age }
    }
    if (meta.terminal === "retire") return { word: "retired", at }
    return { word: "closed", at }
  }

  if (closeState === "reopened") return { word: "open", reopenedAt: entity.reopenedOn }

  const c = completeSince(entity, now, seen)
  if (c != null) return { word: "complete", at: c, willCloseAt: entity.closeAt }

  // NOTE: `ongoing` (the ACTION of running right now) and the Task `done` FLAG are NO LONGER
  // STATE positions — they live on their own orthogonal axes (see {@link isOngoing} and
  // {@link isDone}). An entity that is running keeps its true lifecycle STATE here (usually
  // `open`), and its ongoing-ness is reported separately. This is the STATE / STATUS split:
  // STATE = what it IS (this function), STATUS = what it's DOING (isOngoing / ongoingSince).
  // A done-but-not-yet-complete Task therefore reads STATE `open` with the `done` flag set,
  // rather than a dedicated "done" word.

  // SCHEDULED — a not-yet-terminal INSTANT that carries a concrete `at` anchor reads
  // "scheduled" rather than a bare "open": it's planned, its occurrence(s) just haven't
  // completed it yet. Instant-scoped (moments keep their open→ongoing→complete arc).
  if (entity.kind === "instant" && entity.schedule?.at != null) {
    return { word: "scheduled", at: entity.schedule.at }
  }

  return { word: "open" }
}

// ── STATUS axis — "ongoing" (the ACTION of running now), ORTHOGONAL to STATE ──────
// Whether `entity` is ONGOING right now, and since when. STATUS layers ON TOP of the STATE
// axis (getState): an `open` (or `scheduled`) entity can be ongoing; a terminal / complete
// entity, or a Task marked `done`, never is. Three sources, in priority:
//  (1) an OPEN SESSION — a Task/Space/being worked on (focus punch-in) OR any entity with a
//      running Play stopwatch. A mere FOCUS (viewing) session on a Moment/Instant does NOT
//      count (its ongoing means the occurrence is actually happening — see ongoingOpenSession).
//  (2) a MOMENT or SPACE with a CONCRETE started span still in progress (started, not ended).
//      "whenever" is not concrete, so a playable-but-idle entity is not ongoing.
//  (3) ROLLUP — any CONTAINED descendant is ongoing (containment only, never tags). A Space
//      spins while anything inside it runs; the rollup STOPS AT THE FIRST BEING (a person is
//      ALIVE, not "in progress" — see isBeing), keeping the root Individual "alive" while its
//      Spaces spin. Returns the start instant (for a "since …" readout) or null.
function ongoingSince(entity: Entity, now: number, seen: Set<string>): number | null {
  // Only a LIVE state can be ongoing. Computed with a FRESH cycle-guard so the STATE check
  // can't pollute the rollup's `seen` set (the two recursions are independent concerns).
  const w = getStateInner(entity, now, new Set<string>()).word
  if (w !== "open" && w !== "scheduled") return null
  // A Done task is "done", not "in progress" — even if a stray session lingered.
  if (entity.kind === "task" && isDone(entity)) return null
  // (1) open (state-relevant) session
  const open = ongoingOpenSession(entity)
  if (open) return open.startAt
  // (2) moment/space concrete started span still in progress (start+duration implies an end)
  if (entity.kind === "moment" || entity.kind === "space") {
    const start = concreteStart(entity)
    if (start != null && now >= start) {
      const end = effectiveScheduleEnd(entity.schedule)
      if (end == null || now < end) return start
    }
  }
  // (3) rollup over CONTAINED descendants (stops at the first being)
  if (!isBeing(entity.kind)) {
    const rolled = containedOngoingSince(entity, now, seen)
    if (rolled != null) return rolled
  }
  return null
}

/** Whether `entity` is ONGOING right now (the STATUS axis — running), by ANY source: its own
 *  session/span OR a contained descendant's rollup. Orthogonal to {@link getState} (STATE). */
export function isOngoing(entity: Entity, now: number = Date.now()): boolean {
  return ongoingSince(entity, now, new Set<string>()) != null
}

/** When `entity`'s current ongoing-ness STARTED (for a "since …" readout), or null when it
 *  isn't ongoing. The STATUS-axis companion to {@link isOngoing}. */
export function getOngoingSince(entity: Entity, now: number = Date.now()): number | null {
  return ongoingSince(entity, now, new Set<string>())
}

/**
 * Whether `entity`'s lifecycle has ENDED (its row FADES): closed / dead / retired /
 * cancelled. COMPLETE is deliberately NOT closed ��� it is the live interim state.
 * Thin wrapper over {@link getState} kept for the many existing call sites.
 */
export function isClosed(entity: Entity, now: number = Date.now()): boolean {
  const w = getState(entity, now).word
  return w === "closed" || w === "dead" || w === "retired" || w === "cancelled"
}

/** Whether `entity` is in the COMPLETE interim (positive terminal reached, not yet filed). */
export function isComplete(entity: Entity, now: number = Date.now()): boolean {
  return getState(entity, now).word === "complete"
}

/**
 * Whether `entity`'s glyph should render FILLED. Fill marks a POSITIVELY-FINALIZED
 * state:
 *   • CLOSED (filed) — always fills, or
 *   • COMPLETE — fills, EXCEPT for a Task, which fills on complete ONLY when it was
 *     EXPLICITLY marked complete (`getExplicitComplete`), not merely Done.
 * The Task carve-out exists because a task's complete is DERIVED from its Done checkmark,
 * and a done-but-not-explicitly-completed task should read as OUTLINE (the checkmark
 * conveys it) until it CLOSES at midnight. A Moment/Instant's complete is TIME-driven
 * (its end/point has elapsed), which IS the positive signal, so it fills right away.
 * Cancelled shows a bar; terminal kinds never fill.
 */
export function fillsGlyph(entity: Entity, now: number = Date.now()): boolean {
  // A WEBSITE resource (a resource with a webUrl) ALWAYS reads as filled — a live reachable page
  // is a "present, complete" thing, not an open to-do. (Ideal future refinement: only when the
  // site is actually live / not a 404 — deferred for now.) Independent of lifecycle state.
  if (entity.kind === "resource" && !!entity.webUrl) return true
  if (!KIND_META[entity.kind].fillsWhenClosed) return false
  const w = getState(entity, now).word
  if (w === "closed") return true
  if (w === "complete") {
    // Task (the only fillable kind with a Done axis) needs an explicit complete;
    // time-driven kinds (Moment/Instant) fill as soon as they are complete.
    if (KIND_META[entity.kind].hasDoneState) return getExplicitComplete(entity) === true
    return true
  }
  return false
}
