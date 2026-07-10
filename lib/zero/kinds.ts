import type { Entity, EntityKind } from "./types"
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
    description: "A person, animated by a Soul",
    creatable: false,
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

/** The mutually-exclusive lifecycle positions (see {@link getState}). */
export type StateWord = "open" | "complete" | "closed" | "cancelled" | "dead" | "retired"

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
  if (entity.kind === "task") {
    return isDone(entity) ? nextLocalMidnight(getCompletedOn(entity) ?? now) : undefined
  }
  if (entity.kind === "moment") {
    const end = entity.schedule?.endAt ?? entity.schedule?.at
    return end != null ? nextLocalMidnight(end) : undefined
  }
  if (entity.kind === "instant") {
    const at = entity.schedule?.at ?? entity.schedule?.endAt
    return at != null ? nextLocalMidnight(at) : undefined
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
function completeSince(entity: Entity, now: number): number | null {
  if (entity.kind === "task") {
    return isDone(entity) ? getCompletedOn(entity) ?? getCreatedAt(entity) ?? now : null
  }
  if (entity.kind === "moment") {
    const end = entity.schedule?.endAt ?? entity.schedule?.at
    return end != null && now >= end ? end : null
  }
  if (entity.kind === "instant") {
    const at = entity.schedule?.at ?? entity.schedule?.endAt
    return at != null && now >= at ? at : null
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
  const meta = KIND_META[entity.kind]
  if (isCancelled(entity)) return { word: "cancelled", at: entity.cancelledOn }

  const closeState = getCloseState(entity) // "closed" | "reopened" | null
  const manualClosed = closeState === "closed"
  // A reopen override suppresses the stamped time-close (as well as manual close, which
  // Reopen also clears). Otherwise the frozen `closeAt` decides — the SAME instant for
  // every viewer, so timezones can't disagree on open-vs-closed.
  const timeClosed = closeState !== "reopened" && entity.closeAt != null && now >= entity.closeAt
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

  const c = completeSince(entity, now)
  if (c != null) return { word: "complete", at: c, willCloseAt: entity.closeAt }

  return { word: "open" }
}

/**
 * Whether `entity`'s lifecycle has ENDED (its row FADES): closed / dead / retired /
 * cancelled. COMPLETE is deliberately NOT closed — it is the live interim state.
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
