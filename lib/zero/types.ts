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
 *   - `resource`  — a referenced asset/tool/material the work draws on.
 *   - `community` — a place gathering people and discussions (subreddit-like).
 *
 * The IDENTITY TRIAD describes who a Zero user *is* — Souls animate Individuals,
 * and Individuals occupy/own Organisms (their body, and any they create):
 *
 *   - `soul`       — the primary animating "it" behind a conscious person; one
 *       Soul per person (glyph: a dot). Mostly implicit in the UI; it is the root
 *       of an active user account. System-only; the irreducible self.
 *   - `individual` — a person as an entity (glyph: a "Z" rotated 45° anticlockwise;
 *       a future "conscious" variant adds a dot above). Animated by exactly one
 *       Soul. Birth/death dates live here. An Individual ALWAYS lives in a
 *       geographic place (its body is somewhere), can "birth" new Individuals, and
 *       can create separate Organisms. System-only.
 *   - `organism`   — a living entity at the level of Society (glyph: a circle): the
 *       hidden body of a person, OR a separate organism such as a company,
 *       institution, etc. Tracks its Creator(s); has a lifespan (a body-Organism
 *       matches its Individual's birth–death, a separate one is open-ended until
 *       "killed"). Lives as its own node in Society, even when created by an
 *       Individual. `entity0` (the root "All Life" home in its opened-state form)
 *       is an Organism, and a way of seeing the world — a point of view expressing
 *       a reading of what matters in its environment. A company is one such reading.
 *
 * The active-account path is: Soul (dot) → Individual (z) → Organism (body).
 *
 * LIFELINE: every Individual and Organism owns one Lifeline — the canonical master
 * timeline onto which all its Events, Instants, scheduled Tasks, etc. project.
 *
 * AGGREGATE LENSES (views over entities, not kinds): Population = all Individuals;
 * Society = Individuals + Organisms; Culture = Individuals + Organisms + Law + Art.
 *
 * Containment is recursive: any entity can contain any other entity. The shared
 * attributes below are present on every kind; only some are *relevant* per kind
 * (an event cares about start/end, an instant about `at`, a task about
 * priority/dueDate, a space about description), so renderers show fields
 * conditionally rather than the model splitting into separate shapes.
 */
export type EntityKind =
  | "space"
  | "task"
  | "event"
  | "instant"
  | "resource"
  | "community"
  | "organism"
  | "individual"
  | "soul"

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
  /**
   * MULTI-BLOCK days (D4): more than one within-day span, e.g. Day Job 8:00–11:30
   * AND 13:30–18:00. Stored as absolute times on the ANCHOR day; for a recurring
   * schedule the expander shifts each block's time-of-day onto every matching day.
   * Absent = single span (the `startAt`/`endAt` path, unchanged). When present,
   * `startAt`/`endAt` mirror the FIRST/LAST block so existing single-span readers
   * (duration, sorting, bounds) keep working without knowing about blocks.
   */
  blocks?: { startAt: Epoch; endAt: Epoch }[]
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
  /**
   * RECURRENCE OVERRIDE link (materialize-on-touch, D1). When set, this entity is
   * NOT a normal do-list item — it is a single materialized OCCURRENCE of a
   * recurring "mother" series, created the moment the user touched that day
   * (completed / personalized / cancelled / rescheduled it). `seriesId` points at
   * the mother. Deliberately SEPARATE from `parentId`: overrides must never appear
   * in the mother's `getChildren`/open-task counts/descendants — they live on the
   * timeline, not in the tree. The mother keeps its `schedule.repeat` rule as the
   * source of truth; untouched days stay virtual.
   */
  seriesId?: string
  /**
   * The original occurrence `dayStart` (local-midnight epoch) this override stands
   * in for. `(seriesId, recurrenceId)` uniquely identifies one occurrence, so the
   * expander can swap the virtual occurrence for this real one on that exact day.
   * An override may carry `cancelled` (skip the day) and/or its own `schedule`
   * (reschedule just this day) and/or cloned subtasks (per-day personalization).
   */
  recurrenceId?: Epoch

  // --- Shared attributes (relevance varies by kind) -------------------------
  /** Any entity may be marked complete. */
  completed?: boolean
  /**
   * An event (or instant) that was called off but kept on the timeline for
   * reference. Cancelled items render dimmed with a struck-through title.
   */
  cancelled?: boolean
  /**
   * A task that has been SENT to someone as a request ("Can you do this?").
   * Purely a state flag for now (no recipient/transport modelled yet); its only
   * effect is on the glyph, which sprouts a tilted "sent" edge off the square's
   * bottom-right corner. Mainly tasks.
   */
  requested?: boolean
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
