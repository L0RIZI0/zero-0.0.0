import type { Entity, EntityKind } from "./types"

/**
 * Per-kind SEMANTICS — the single source of truth for what each particular Space
 * kind means and how it behaves around completion / lifecycle. Consumed by:
 *   - the glyph (`entity-node.tsx`): fill-when-done + checkmark-when-done + terminal,
 *   - the do-list (creatable filtering),
 *   - the "Zero Entities" page (label + description + behavior copy).
 *
 * "Every entity is a Space"; these flags describe how a given kind of Space
 * resolves its end-of-life:
 *   - COMPLETABLE kinds hold a normal `completed` "done" (task/event/instant/
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
  event: {
    label: "Moment",
    description: "A span in time",
    creatable: true,
    completable: true,
    fillGlyphWhenDone: true,
    checkmarkWhenDone: false,
    terminal: null,
  },
  instant: {
    label: "Instant",
    description: "A point in time",
    creatable: true,
    completable: true,
    fillGlyphWhenDone: true,
    checkmarkWhenDone: false,
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
 * Whether `entity` is CLOSED — i.e. its glyph should render FILLED. "Closed" is
 * the archived / lifecycle-ended state, DISTINCT from a task's "done" (checkmark,
 * no fill). Sources, in order:
 *   1. the MANUAL `closed` flag (the "Close" menu action), persisted;
 *   2. `cancelled` (the "Cancel" action — also strikes through + fades);
 *   3. DERIVED, not stored:
 *      - a done TASK auto-closes at the first local midnight AFTER `completedOn`;
 *      - an EVENT/INSTANT closes once its end time has passed (instant end == `at`).
 * `now` is injectable for testing; defaults to the current time. Terminal kinds
 * (community/organism/individual) never "close" here — they retire/die instead.
 */
export function isClosed(entity: Entity, now: number = Date.now()): boolean {
  if (entity.closed) return true
  if (entity.cancelled) return true
  if (entity.kind === "task") {
    return (
      !!entity.completed &&
      entity.completedOn != null &&
      now >= nextLocalMidnight(entity.completedOn)
    )
  }
  if (entity.kind === "event" || entity.kind === "instant") {
    const end = entity.schedule?.endAt ?? entity.schedule?.at
    return end != null && now >= end
  }
  return false
}
