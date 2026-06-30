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

/**
 * SPACE BASE — the recursive container that EVERY entity is, before it is any
 * particular kind. "Every entity is a Space": a Task, an Event, an Organism…
 * are all Spaces with extra, kind-specific properties layered on top. A space's
 * own world (its do-list, sub-spaces, resources) is reached by opening it; the
 * subtree rooted at `id` IS "the world of" that space.
 *
 * IDENTITY: a space is identified by its stable `id`, never its `title`. Titles
 * are mutable display labels and may repeat; all relationships key off `id`
 * (`parentId`, `taggedSpaceIds`, `seriesId`+`recurrenceId`, the `byId` map).
 *
 * Fields here are shared by all kinds; per-kind specifics live on the variant
 * interfaces below, and `Entity` is their discriminated union (on `kind`).
 */
export interface SpaceBase {
  id: string
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

  // --- Lifecycle / provenance META (every space has meta) -------------------
  /** When this space was created (epoch ms). */
  createdAt?: Epoch
  /** Id of the creating Individual/Organism ("created by"). */
  createdBy?: string
  /** Place id or label where it was created ("created where"). */
  createdWhere?: string
  /** When `completed` last flipped true (mirrors the completion write). */
  completedOn?: Epoch

  // --- Shared state + display (relevance varies by kind) --------------------
  /**
   * A NORMAL "done" flag. Only meaningful for completable kinds (task/event/
   * instant/space/resource). Community/Organism/Individual/Soul are NOT
   * "completed" — they reach a TERMINAL state (retire/death) instead; see
   * `KIND_META` in `lib/zero/kinds.ts`.
   */
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
  /**
   * All timing for this entity (start/end span, instant point, due date, effort
   * budget, recurrence) — grouped in one optional object. See {@link Schedule}.
   * Presence of `schedule` is the single "is this space planned?" check.
   */
  schedule?: Schedule
  /** Free-text labels. */
  tags?: string[]
}

/**
 * TASK — a unit of work; still a container (it can hold subtasks). The only kind
 * that carries the web-resource binding (the "contextual browser") and a sent/
 * requested flag and a priority.
 */
export interface TaskSpace extends SpaceBase {
  kind: "task"
  /** Task priority. */
  priority?: TaskPriority
  /**
   * A task SENT to someone as a request ("Can you do this?"). State flag only
   * (no recipient/transport modelled yet); it sprouts a tilted "sent" edge off the
   * square glyph's bottom-right corner.
   */
  requested?: boolean
  /**
   * When set, this is a RESOURCE TASK: opening it shows a live web surface instead
   * of a do-list (Zero as a contextual browser). Holds the URL the task opens.
   */
  webUrl?: string
  /**
   * Optional id into the known web-resource catalog (see `web-resources.ts`) for
   * branding + embed behavior. Absent for an arbitrary typed URL.
   */
  webResourceId?: string
}

/** EVENT — a scheduled contiguous span (start→end); a container at its core. */
export interface EventSpace extends SpaceBase {
  kind: "event"
}

/** INSTANT — like an event, but a single point in time rather than a span. */
export interface InstantSpace extends SpaceBase {
  kind: "instant"
}

/** SPACE — a plain area / folder / gathering ("Day Job", "Health"). */
export interface PlainSpace extends SpaceBase {
  kind: "space"
}

/** RESOURCE — a referenced asset/tool/material the work draws on. */
export interface ResourceSpace extends SpaceBase {
  kind: "resource"
}

/**
 * COMMUNITY — a place gathering people and discussions (subreddit-like). NOT
 * completable; its terminal state is RETIREMENT (`retiredOn`).
 */
export interface CommunitySpace extends SpaceBase {
  kind: "community"
  /** When the community was retired (terminal state; epoch ms). */
  retiredOn?: Epoch
}

/**
 * ORGANISM — a living entity at the level of Society (a body, or a company /
 * institution). NOT completable; its terminal state is DEATH (`diedOn`).
 */
export interface OrganismSpace extends SpaceBase {
  kind: "organism"
  /** Whether still alive (open-ended until killed). */
  alive?: boolean
  /** When the organism died (terminal state; epoch ms). */
  diedOn?: Epoch
}

/**
 * INDIVIDUAL — a person as an entity, animated by exactly one Soul. NOT
 * completable; birth/death meta live here.
 */
export interface IndividualSpace extends SpaceBase {
  kind: "individual"
  /** Birth time (epoch ms). */
  bornAt?: Epoch
  /** When the individual died (terminal state; epoch ms). */
  diedOn?: Epoch
}

/**
 * SOUL — the primary animating "it" behind a conscious person; one Soul per
 * person. System-only, never completable, no terminal state.
 */
export interface SoulSpace extends SpaceBase {
  kind: "soul"
}

/**
 * ENTITY — the discriminated union of every particular Space, keyed on `kind`.
 * Narrow on `entity.kind === "task"` etc. to reach a variant's own fields.
 */
export type Entity =
  | TaskSpace
  | EventSpace
  | InstantSpace
  | PlainSpace
  | ResourceSpace
  | CommunitySpace
  | OrganismSpace
  | IndividualSpace
  | SoulSpace

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
