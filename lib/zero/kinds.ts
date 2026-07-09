import type { Entity, EntityKind } from "./types"
import { isDone, getCompletedOn, getCloseState, isCancelled, getExplicitComplete } from "./entity-log"

/**
 * Per-kind SEMANTICS — the single source of truth for what each entity kind
 * means and how it behaves around completion / lifecycle. Consumed by:
 *   - the glyph (`entity-node.tsx`): fill-when-done + checkmark-when-done + terminal,
 *   - the do-list (creatable filtering),
 *   - the "Zero Entities" page (label + description + behavior copy).
 *
 * ENTITY is the essence; SPACE (the container) is just one kind — not every entity
 * is a Space, but every Space is an Entity. These flags describe how a given kind
 * resolves its end-of-life:
 *   - COMPLETABLE kinds hold a normal `completed` "done" (task/moment/instant/
 *     space/resource).
 *   - TERMINAL kinds are never "done" — they retire (community) or die
 *     (organism/individual). Soul has no terminal state (system-only).
 */
export interface KindMeta {
  /** Display name, e.g. "Task". */
  label: string
  /** One-line description shown on the Zero Entities page. */
  description: string
  /** Whether the user can create one from the new-entity affordances. */
  creatable: boolean
  /** Can hold a normal "done" (`completed`). */
  completable: boolean
  /** When done/terminal, the glyph fills its silhouette. */
  fillGlyphWhenDone: boolean
  /** When done, overlay a checkmark on the glyph (Task only). */
  checkmarkWhenDone: boolean
  /**
   * Terminal lifecycle instead of completion: "retire" (community) or "death"
   * (organism/individual). `null` = uses normal completion, or is system-only.
   */
  terminal: "retire" | "death" | null
}

export const KIND_META: Record<EntityKind, KindMeta> = {
  task: {
    label: "Task",
    description: "A thing to do",
    creatable: true,
    completable: true,
    fillGlyphWhenDone: true,
    checkmarkWhenDone: true,
    terminal: null,
  },
  space: {
    label: "Space",
    description: "A context that holds things",
    creatable: true,
    completable: true,
    fillGlyphWhenDone: true,
    checkmarkWhenDone: false,
    terminal: null,
  },
  resource: {
    label: "Resource",
    description: "An asset, reference, or tool",
    creatable: true,
    completable: true,
    fillGlyphWhenDone: true,
    checkmarkWhenDone: false,
    terminal: null,
  },
  moment: {
    label: "Moment",
    description: "A span in time",
    creatable: true,
    completable: true,
    fillGlyphWhenDone: true,
    // Moments behave like tasks now: clicking the glyph marks them done (a checkmark
    // appears in the triangle) and they CLOSE at the midnight after their done date.
    checkmarkWhenDone: true,
    terminal: null,
  },
  instant: {
    label: "Instant",
    description: "A point in time",
    creatable: true,
    completable: true,
    fillGlyphWhenDone: true,
    // Same as moments — completable via the glyph, checkmarked when done.
    checkmarkWhenDone: true,
    terminal: null,
  },
  community: {
    label: "Community",
    description: "A place to gather people and discussions",
    creatable: true,
    completable: false,
    fillGlyphWhenDone: false,
    checkmarkWhenDone: false,
    terminal: "retire",
  },
  organism: {
    label: "Organism",
    description: "A company, a point of view",
    creatable: true,
    completable: false,
    fillGlyphWhenDone: false,
    checkmarkWhenDone: false,
    terminal: "death",
  },
  individual: {
    label: "Individual",
    description: "A person, animated by a Soul",
    creatable: false,
    completable: false,
    fillGlyphWhenDone: false,
    checkmarkWhenDone: false,
    terminal: "death",
  },
  soul: {
    label: "Soul",
    description: "The animating self behind a person",
    creatable: false,
    completable: false,
    fillGlyphWhenDone: false,
    checkmarkWhenDone: false,
    terminal: null,
  },
}

/** Whether a kind can hold a normal "done" completion. */
export function isCompletable(kind: EntityKind): boolean {
  return KIND_META[kind].completable
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
 * Whether `entity` is COMPLETE — the success VERDICT, and the ONLY thing that FILLS
 * the glyph. Complete implies done and closes the entity. DISTINCT from "done" (a
 * soft checkmark that does NOT close). Sources, in order:
 *   1. an explicit REOPEN wins — a `reopened` close-state OR an explicit `uncompleted`
 *      complete-entry means "not complete", short-circuiting the derived rule below so
 *      a reopened entity stays open;
 *   2. the explicit COMPLETE verdict ("Mark as Complete" ⇒ `completed` log / scalar);
 *   3. DERIVED, not stored:
 *      - a done TASK/MOMENT/INSTANT auto-completes at the first local midnight AFTER
 *        it was done (`completedOn`);
 *      - a MOMENT/INSTANT auto-completes once its end time has passed (it occurred;
 *        instant end == `at`), even if never marked done.
 * Only completable kinds can be complete. `now` is injectable for testing.
 */
export function isComplete(entity: Entity, now: number = Date.now()): boolean {
  if (!isCompletable(entity.kind)) return false
  // An explicit reopen (either axis) forces "not complete" and overrides derivation.
  if (getCloseState(entity) === "reopened") return false
  const explicit = getExplicitComplete(entity)
  if (explicit === false) return false
  if (explicit === true) return true
  // DERIVED: a done completable completes at the first local midnight after doneOn.
  const doneOn = getCompletedOn(entity)
  if (isDone(entity) && doneOn != null && now >= nextLocalMidnight(doneOn)) return true
  // A moment/instant that has passed its scheduled end has occurred ⇒ complete.
  if (entity.kind === "moment" || entity.kind === "instant") {
    const end = entity.schedule?.endAt ?? entity.schedule?.at
    if (end != null && now >= end) return true
  }
  return false
}

/**
 * Whether `entity` is CLOSED — its lifecycle has ended, so its row FADES. Note that
 * closed no longer means "filled": a PLAIN close only fades; the glyph FILLS only
 * when {@link isComplete}. Sources:
 *   1. the MANUAL `closed` flag (the "Close" action), persisted;
 *   2. `cancelled` (the "Cancel" action — also bar-over-glyph + strike);
 *   3. `complete` (the success verdict, explicit or derived — also fills).
 * An explicit `reopened` overrides the derived complete (but not a manual `closed`
 * or `cancelled`, cleared via Reopen / Restore). `now` is injectable for testing.
 * Terminal kinds (community/organism/individual) retire/die instead of closing here.
 */
export function isClosed(entity: Entity, now: number = Date.now()): boolean {
  const closeState = getCloseState(entity)
  if (closeState === "closed") return true
  if (isCancelled(entity)) return true
  if (isComplete(entity, now)) return true
  return false
}
