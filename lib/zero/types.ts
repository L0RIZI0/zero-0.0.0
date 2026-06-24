// Core domain types for Zero — a contextual browser-shell.

export type ResourceKind =
  | "webapp"
  | "file"
  | "note"
  | "service"
  | "ai"
  | "communication"
  | "document"
  | "browser"
  | "storage"
  | "design"
  | "planning"

export type TaskPriority = "low" | "medium" | "high"

export type AssetType =
  | "document"
  | "deck"
  | "image"
  | "link"
  | "note"
  | "sheet"
  | "subscription"

export interface User {
  id: string
  name: string
  handle: string
  avatarUrl?: string
}

/**
 * Every node Zero manages is an `Entity`. The three kinds are not separate
 * domain types — they are the SAME recursive "container" with a different
 * `kind` discriminator (and glyph):
 *
 *   - `space`   — an area / folder / gathering ("Day Job", "Health").
 *   - `task`    — a unit of work; still a container (it can hold subtasks).
 *   - `event`   — a scheduled span (start→end); also a container at its core.
 *   - `instant` — like an event, but a single point in time rather than a span.
 *
 * Containment is recursive: any entity can contain any other entity. The shared
 * attributes below are present on every kind; only some are *relevant* per kind
 * (an event cares about start/end, an instant about `at`, a task about
 * priority/dueDate, a space about description), so renderers show fields
 * conditionally rather than the model splitting into separate shapes.
 */
export type EntityKind = "space" | "task" | "event" | "instant"

/** Absolute time, in epoch milliseconds (the `Date.now()` value). Replaces the
 *  old "minutes from midnight" representation so spans can cross days/weeks/years
 *  and recurrence is expressible. */
export type Epoch = number

/**
 * Recurrence rule for a repeating schedule. Absent `repeat` = a one-off.
 * Deliberately a small subset of iCal RRULE — enough for "every weekday",
 * "every 2 weeks on Mon/Wed", "monthly", etc.
 */
export interface Recurrence {
  freq: "daily" | "weekly" | "monthly" | "yearly"
  /** Every N units of `freq` (default 1). */
  interval?: number
  /** For weekly rules: weekdays 0(Sun)–6(Sat) the event lands on. */
  byWeekday?: number[]
  /** Optional end of the series (inclusive), epoch ms. */
  until?: Epoch
}

/**
 * All of an entity's TIMING, grouped in one optional object. Presence of
 * `schedule` is the single "is this entity scheduled?" check. Every field is
 * optional and relevant to different kinds:
 *
 *   - event   → `startAt` + `endAt` (a contiguous span).
 *   - instant → `at` (a single point in time).
 *   - task    → `dueAt` (a deadline) and/or `timebox` (effort budget).
 *
 * `duration` vs `timebox` are intentionally distinct:
 *   - `duration` is the length of a CONTIGUOUS block (usually `endAt - startAt`).
 *   - `timebox` is a planned EFFORT BUDGET in minutes that may be spread across
 *     many separate sessions (e.g. "spend 5h on this over the week"), so it is
 *     independent of any single start/end.
 */
export interface Schedule {
  /** Contiguous span start (events, timed blocks). */
  startAt?: Epoch
  /** Contiguous span end. */
  endAt?: Epoch
  /** A single point in time (instants). */
  at?: Epoch
  /** Deadline (tasks). Was the free-text `dueDate`; now machine-readable. */
  dueAt?: Epoch
  /** Length of a contiguous block, in MINUTES. */
  duration?: number
  /** Effort budget in MINUTES, independent of when it happens (may span sessions). */
  timebox?: number
  /** Recurrence; absent = one-off. */
  repeat?: Recurrence
}

export interface Entity {
  id: string
  kind: EntityKind
  title: string

  // --- Relationships --------------------------------------------------------
  /** The single ORIGIN parent ("created-from"). Root (Space 0) has `null`. */
  parentId: string | null
  /**
   * Secondary multi-parent links ("also shows up in"). The same entity — e.g.
   * "Schedule dentist", born in Personal — surfaces in each tagged space (e.g.
   * Health) in addition to its origin parent.
   */
  taggedSpaceIds: string[]

  // --- Shared attributes (relevance varies by kind) -------------------------
  /** Any entity may be marked complete. */
  completed?: boolean
  /**
   * An event (or instant) that was called off but kept on the timeline for
   * reference. Cancelled items render dimmed with a struck-through title.
   */
  cancelled?: boolean
  /** Mainly spaces. */
  description?: string
  /** Contextual tint, mainly spaces. */
  accent?: string
  /** Resources assigned to this entity (mainly spaces). */
  assignedResourceIds?: string[]
  /** Mainly tasks. */
  priority?: TaskPriority
  /**
   * All timing for this entity (start/end span, instant point, due date, effort
   * budget, recurrence) — grouped in one optional object. Replaces the former
   * flat `start`/`end`/`at`/`seconds` (minutes-from-midnight) and the free-text
   * `dueDate`. See {@link Schedule}. Sub-second/`seconds` precision is now free,
   * since `at` is an absolute timestamp.
   */
  schedule?: Schedule
  /** Free-text labels. */
  tags?: string[]

  // --- Web resource binding (the "contextual browser") ----------------------
  /**
   * When set, this entity is a RESOURCE TASK: opening it shows a live web surface
   * (or an illustrative stand-in) instead of a do-list. This is how Zero behaves
   * as a contextual browser — a Figma/Photopea/etc. tab that lives inside a Task
   * and whose outputs can later wire into the Task's Outputs. Holds the URL the
   * task opens. Present on `kind: "task"` entities created from a URL or resource.
   */
  webUrl?: string
  /**
   * Optional id into the known web-resource catalog (see `web-resources.ts`) for
   * branding + embed behavior. Absent for an arbitrary typed URL (which falls back
   * to generic embed + hostname branding).
   */
  webResourceId?: string
}

export interface Resource {
  id: string
  name: string
  kind: ResourceKind
  /** Short glyph / monogram used in the resource chip. */
  icon: string
  description: string
  spaceIds: string[]
  /** Optional brand-ish tint, pulled from the resource not the shell. */
  tint?: string
}

export interface Asset {
  id: string
  title: string
  type: AssetType
  linkedResourceId: string | null
  spaceId: string
  preview: string
}
