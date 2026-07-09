import type { Entity, EntityKind } from "./types"
import { isDone, getCompletedOn, getCloseState, isCancelled, getExplicitComplete } from "./entity-log"

/**
 * Per-kind SEMANTICS — the single source of truth for what each entity kind
 * means and how it behaves around the two lifecycle axes. Consumed by the glyph,
 * the root canvas, the entity menu, and the "Zero Entities" doc page.
 *
 * THE MODEL (Jul 2026 simplification): there are exactly TWO stored axes —
 *   1. CLOSE (open ⟷ closed): EVERY entity has it. Closing FADES the row. This is
 *      the whole lifecycle; there is no separate "complete" field.
 *   2. DONE (done ⟷ undone): ONLY Task / Moment / Instant. A soft checkmark that
 *      does NOT close on its own.
 * Two STATIC per-kind flags describe how a kind renders those axes:
 *   - `hasDoneState`   — can hold the DONE checkmark (task/moment/instant).
 *   - `fillsWhenClosed` — its glyph FILLS when it closes (task/space/resource/
 *      moment/instant). Terminal kinds (community/organism/individual) do NOT fill:
 *      they just FADE (retire / die), keeping their outline.
 * "Complete" is no longer a field — it is simply the human name for a fillable kind
 * that is done AND closed (checkmark + filled + faded). Fill DERIVES from close.
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
    // Moments behave like tasks: they can be marked done (a checkmark appears in the
    // triangle) and they CLOSE (fill + fade) at the midnight after their done date.
    hasDoneState: true,
    fillsWhenClosed: true,
    terminal: null,
  },
  instant: {
    label: "Instant",
    description: "A point in time",
    creatable: true,
    hasDoneState: true,
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
function nextLocalMidnight(epoch: number): number {
  const d = new Date(epoch)
  d.setHours(0, 0, 0, 0) // midnight opening the day of `epoch`
  d.setDate(d.getDate() + 1) // → the next midnight
  return d.getTime()
}

/**
 * Whether `entity` is CLOSED — its lifecycle has ended, so its row FADES. Closing is
 * the WHOLE lifecycle now (no separate "complete" verdict). Sources, in order:
 *   1. the MANUAL `closed` flag (the "Close" / "Complete" action), persisted;
 *   2. `cancelled` (the "Cancel" action — also bar-over-glyph + strike);
 *   3. an explicit REOPEN (`reopened`) short-circuits the DERIVED + legacy rules
 *      below so a reopened entity genuinely stays open;
 *   4. LEGACY back-compat: a persisted `complete` verdict (from before this model)
 *      still reads as closed, so old data keeps its filled/faded look;
 *   5. DERIVED, not stored:
 *      - a done TASK/MOMENT/INSTANT closes at the first local midnight AFTER it was
 *        done (`completedOn`) — "done today, filed overnight";
 *      - a MOMENT/INSTANT closes once its end time has passed (it occurred), even if
 *        never marked done.
 * `now` is injectable for testing.
 */
export function isClosed(entity: Entity, now: number = Date.now()): boolean {
  const closeState = getCloseState(entity)
  if (closeState === "closed") return true
  if (isCancelled(entity)) return true
  // An explicit reopen overrides the derived + legacy close rules (but not a manual
  // close or cancel, which are cleared via Reopen / Restore in reopenEntity).
  if (closeState === "reopened") return false
  // LEGACY: honor a pre-existing explicit complete verdict as a close.
  if (getExplicitComplete(entity) === true) return true
  // DERIVED: a done task/moment/instant closes at the first local midnight after doneOn.
  const doneOn = getCompletedOn(entity)
  if (KIND_META[entity.kind].hasDoneState && isDone(entity) && doneOn != null && now >= nextLocalMidnight(doneOn)) {
    return true
  }
  // A moment/instant whose scheduled end has passed has occurred ⇒ closed.
  if (entity.kind === "moment" || entity.kind === "instant") {
    const end = entity.schedule?.endAt ?? entity.schedule?.at
    if (end != null && now >= end) return true
  }
  return false
}

/**
 * Whether `entity`'s glyph should render FILLED. Fill DERIVES from close: a closed
 * entity of a fillable kind fills its silhouette — UNLESS it was cancelled, which
 * shows a bar over the glyph instead of a fill. Terminal kinds never fill (they fade).
 */
export function fillsGlyph(entity: Entity, now: number = Date.now()): boolean {
  return KIND_META[entity.kind].fillsWhenClosed && isClosed(entity, now) && !isCancelled(entity)
}
