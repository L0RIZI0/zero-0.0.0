import type { EntityKind } from "./types"

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
    label: "Event",
    description: "Something that lives in time",
    creatable: true,
    completable: true,
    fillGlyphWhenDone: true,
    checkmarkWhenDone: false,
    terminal: null,
  },
  instant: {
    label: "Instant",
    description: "A precise moment",
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
export function isTerminal(entity: { kind: EntityKind } & Record<string, unknown>): boolean {
  const meta = KIND_META[entity.kind]
  if (!meta.terminal) return false
  if (meta.terminal === "retire") return entity["retiredOn"] != null
  return entity["diedOn"] != null
}
