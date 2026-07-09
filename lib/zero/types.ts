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
 *   - `moment`  — a scheduled span (start→end); also a container at its core.
 *   - `instant` — like a moment, but a single point in time rather than a span.
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
 * timeline onto which all its Moments, Instants, scheduled Tasks, etc. project.
 *
 * AGGREGATE LENSES (views over entities, not kinds): Population = all Individuals;
 * Society = Individuals + Organisms; Culture = Individuals + Organisms + Law + Art.
 *
 * Containment is recursive: any entity can contain any other entity. The shared
 * attributes below are present on every kind; only some are *relevant* per kind
 * (a moment cares about start/end, an instant about `at`, a task about
 * priority/dueDate, a space about description), so renderers show fields
 * conditionally rather than the model splitting into separate shapes.
 */
export type EntityKind =
  | "space"
  | "task"
  | "moment"
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
 * The kind of lifecycle event a single {@link Instant} log entry records. This is
 * ontology Meta **field 1** ("a list of Instants for logs"): every state change an
 * entity can undergo is one typed, timestamped entry, so the entity's CURRENT state
 * is derived by folding the log rather than stored as separate booleans.
 *
 *   - `created`   — birth (creation). The first entry of any log.
 *   - `done` / `undone`      — DONE toggled on / off. A SOFT marker: "done, but not
 *                              yet complete". Does NOT close the entity.
 *   - `completed` / `uncompleted` — the COMPLETE verdict set / cleared. Complete
 *                              implies done and CLOSES the entity (fills the glyph).
 *                              Reversed only by Reopen (which appends `uncompleted`).
 *   - `closed` / `reopened`  — archived / pulled back open (plain close = fade only).
 *   - `cancelled` / `restored` — called off / un-cancelled (also closes: bar + strike).
 *   - `retired` / `died`     — TERMINAL ends (community retires, organism/individual die).
 *   - `accessed`  — an entry/exit "who was here, when" access record.
 *
 * NOTE: this type is ADDITIVE and not yet persisted or written by any code path —
 * see `v0 memory: entity log model`. The `log` field below is optional and every
 * derive helper falls back to today's scalar fields when it is absent.
 */
export type LogType =
  | "created"
  | "done"
  | "undone"
  | "completed"
  | "uncompleted"
  | "closed"
  | "reopened"
  | "cancelled"
  | "restored"
  | "retired"
  | "died"
  | "accessed"

/**
 * ONE lifecycle-log entry — a single timestamped "Instant" in an entity's history.
 * (Distinct from the `instant` entity KIND, which is a point-in-time entity; this is
 * a log record.) A `by`/`where` pair captures provenance for `created`/`accessed`.
 */
export interface Instant {
  /** When this event happened (epoch ms). */
  at: Epoch
  /** What kind of lifecycle event it was. */
  type: LogType
  /** Id of the acting Individual/Organism ("by whom"), when known. */
  by?: string
  /** Place id or label ("where"), when known. */
  where?: string
}

/**
 * Recurrence rule for a repeating schedule. Absent `repeat` = a one-off.
 * Deliberately a small subset of iCal RRULE — enough for "every weekday",
 * "every 2 weeks on Mon/Wed", "monthly", etc.
 */
export interface Recurrence {
  freq: "daily" | "weekly" | "monthly" | "yearly"
  /** Every N units of `freq` (default 1). */
  interval?: number
  /** For weekly rules: weekdays 0(Sun)–6(Sat) the moment lands on. */
  byWeekday?: number[]
  /** Optional end of the series (inclusive), epoch ms. */
  until?: Epoch
}

/**
 * All of an entity's TIMING, grouped in one optional object. Presence of
 * `schedule` is the single "is this entity scheduled?" check. Every field is
 * optional and relevant to different kinds:
 *
 *   - moment  → `startAt` + `endAt` (a contiguous span).
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
  /** Contiguous span start (moments, timed blocks). */
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
 * ENTITY BASE (historically named `SpaceBase`) — the fields EVERY entity shares
 * before it is any particular kind. ENTITY is the essence; SPACE (the container)
 * is just one kind — not every entity is a Space, but every Space is an Entity.
 * A Task, a Moment, an Organism… all extend this base with kind-specific fields.
 * Every entity is nonetheless a recursive container: its own world (do-list,
 * sub-spaces, resources) is reached by opening it, and the subtree rooted at `id`
 * IS "the world of" that entity.
 *
 * IDENTITY: a space is identified by its stable `id`, never its `title`. Titles
 * are mutable display labels and may repeat; all relationships key off `id`
 * (`parentId`, `taggedSpaceIds`, `seriesId`+`recurrenceId`, the `byId` map).
 *
 * Fields here are shared by all kinds; per-kind specifics live on the variant
 * interfaces below, and `Entity` is their discriminated union (on `kind`).
 */
/**
 * ONE entry in an entity's TITLE HISTORY — the title it carried, and WHEN that name
 * took effect (epoch ms). The entity's CURRENT title stays the canonical `title: string`
 * below; this log lets a historical view ask "what was this called at time T?" so the
 * activity tracker can label a past segment with the name it had *then*, not today's.
 * (Same "faithful to its moment" principle as always-showing a Moment's empty slots.)
 */
export interface TitleEntry {
  /** The title as of `at`. */
  title: string
  /** When this title took effect (epoch ms). */
  at: Epoch
}

export interface EntityBase {
  id: string
  title: string
  /**
   * Append-only TITLE HISTORY (additive; absent on entities never renamed). Each entry
   * is a {@link TitleEntry} `{title, at}`, oldest→newest. On the FIRST rename the prior
   * title is backfilled at `createdAt` so the history is complete from birth. `title`
   * above remains the current value; fold with `titleAt(entity, epoch)` for a past name.
   */
  titleLog?: TitleEntry[]

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
  /**
   * The append-only lifecycle LOG — ontology Meta field 1. One {@link Instant}
   * per state change (created / done / closed / cancelled / accessed / …), from
   * which the current state is DERIVED by folding (see `lib/zero/entity-log.ts`).
   *
   * ADDITIVE + not yet written: no code path populates this today, and every
   * derive helper falls back to the scalar fields below when `log` is absent, so
   * persisted data is untouched. This is the target shape that the scalars
   * (`createdAt`, `completed`, `closed`, …) will eventually fold into.
   */
  log?: Instant[]
  /** When this space was created (epoch ms). */
  createdAt?: Epoch
  /** Id of the creating Individual/Organism ("created by"). */
  createdBy?: string
  /** Place id or label where it was created ("created where"). */
  createdWhere?: string
  /** When `completed` (the DONE marker) last flipped true (mirrors the done write). */
  completedOn?: Epoch
  /**
   * COMPLETE = the success VERDICT (its own axis, distinct from the soft `completed`
   * "done" marker despite the near-identical name — `completed` here means DONE, this
   * means COMPLETE). Complete implies done and CLOSES the entity; it is the ONLY thing
   * that FILLS the glyph. Set by "Mark as Complete", and DERIVED (not stored) when a
   * done task passes its next local midnight or a moment/instant passes its end. Only
   * the explicit flag is persisted; derivation lives in {@link isComplete}. Reversed by
   * Reopen. Completable kinds only (task/space/resource/moment/instant).
   */
  complete?: boolean
  /** When the explicit `complete` verdict last flipped true (epoch ms). */
  completeOn?: Epoch
  /**
   * CLOSED = lifecycle ended / archived. A PLAIN close (this manual flag, the "Close"
   * action) only FADES the row — it does NOT fill the glyph (fill is reserved for
   * `complete`). An entity is closed when:
   *   - this MANUAL flag is set (plain "Close"), or
   *   - it is `complete` (the success verdict — also fills), or
   *   - it is `cancelled` (the "Cancel" action — also bar-over-glyph + strike), or
   *   - (DERIVED via `complete`) a done task past its next local midnight, or a
   *     moment/instant past its end.
   * Only the manual flag is persisted; the rest are computed by {@link isClosed}.
   */
  closed?: boolean
  /** When the manual `closed` flag last flipped true (epoch ms). */
  closedOn?: Epoch
  /**
   * The STAMPED absolute close instant (epoch ms) — the "closes at midnight" rule made
   * TIMEZONE-STABLE. Instead of every viewer deriving close against THEIR own local
   * midnight (which would make a shared entity look open for one person and closed for
   * another at the same real time), the close instant is computed ONCE in the ACTOR's
   * local day and frozen here as an absolute epoch — the standard "floating time resolved
   * to an absolute instant" approach (cf. iCal/RFC 5545). Everyone everywhere then flips
   * Complete → Closed at the SAME real moment. Stamped by the write paths:
   *   - a TASK marked Done → next local midnight after the done time;
   *   - a MOMENT/INSTANT with an end → next local midnight after that end.
   * Cleared on Undone / Reopen. Absent = no time-close scheduled (open, or manual-close only).
   *
   * MULTI-USER NOTE (future, not implemented): when a task is REQUESTED from another
   * Individual, only the OWNER may mark it Complete; the recipient can mark it Done, and it
   * still time-closes at this stamped instant unless the owner changes the setting. Today
   * (single-user) marking Done also completes + stamps this in one step.
   */
  closeAt?: Epoch
  /**
   * Explicit user REOPEN that overrides a DERIVED close. Set by the "Reopen" menu
   * action so an entity that closed only because time passed (a moment past its end,
   * a done task past its midnight) can be pulled back open and STAY open until it is
   * closed again. `isClosed` treats this as false for the derived cases only — a
   * manual `closed` or `cancelled` still wins (use Reopen / Restore to clear those).
   */
  reopened?: boolean
  /** When `reopened` last flipped true (epoch ms). */
  reopenedOn?: Epoch

  // --- Shared state + display (relevance varies by kind) --------------------
  /**
   * The soft "DONE" marker (badly named `completed` for legacy reasons — this is
   * DONE, not the COMPLETE verdict which lives in `complete`). Done shows a checkmark
   * and does NOT close/fill; it means "done but maybe not yet filed". Only meaningful
   * for completable kinds (task/space/resource/moment/instant). Community/Organism/
   * Individual/Soul are NOT done — they reach a TERMINAL state instead; see `KIND_META`.
   */
  completed?: boolean
  /**
   * A moment (or instant) that was called off but kept on the timeline for
   * reference. Cancelled items render dimmed with a struck-through title.
   */
  cancelled?: boolean
  /**
   * When the cancel/restore state last changed (epoch ms) — added in log-model
   * Phase 2b so `cancelled` can fold into the lifecycle log as a timestamped
   * Instant. Absent on entities cancelled before this existed (the migration
   * approximates their time as `createdAt`).
   */
  cancelledOn?: Epoch
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

  /**
   * WEB SURFACE binding (Zero as a contextual browser). When set, opening this
   * entity shows a live web surface (external site, or one of Zero's own internal
   * pages via a root-relative path like "/vision") instead of a do-list. This is
   * the defining trait of the `resource` kind produced by typing a URL, but it
   * lives on EntityBase so the binding is kind-agnostic (any space could, in
   * principle, front a web surface). `webResourceId` optionally points into the
   * known web-resource catalog (see `web-resources.ts`) for branding/embed
   * behavior; absent for an arbitrary typed URL.
   */
  webUrl?: string
  webResourceId?: string
}

/**
 * TASK — a unit of work; still a container (it can hold subtasks). Carries a
 * sent/requested flag and a priority. (The web-surface binding now lives on
 * EntityBase and defines the `resource` kind — see below.)
 */
export interface TaskEntity extends EntityBase {
  kind: "task"
  /** Task priority. */
  priority?: TaskPriority
  /**
   * A task SENT to someone as a request ("Can you do this?"). State flag only
   * (no recipient/transport modelled yet); it sprouts a tilted "sent" edge off the
   * square glyph's bottom-right corner.
   */
  requested?: boolean
}

/** MOMENT — a scheduled contiguous span (start→end); a container at its core. */
export interface MomentEntity extends EntityBase {
  kind: "moment"
}

/** INSTANT — like a moment, but a single point in time rather than a span. */
export interface InstantEntity extends EntityBase {
  kind: "instant"
}

/** SPACE — a plain area / folder / gathering ("Day Job", "Health"). */
export interface SpaceEntity extends EntityBase {
  kind: "space"
}

/**
 * RESOURCE — a referenced asset/tool/material the work draws on. When Zero
 * recognizes typed text as a URL (external, or an internal "/…" route) it creates
 * a resource whose `webUrl` fronts a live web surface (the contextual browser),
 * shown with the diamond glyph. `webUrl`/`webResourceId` live on EntityBase.
 */
export interface ResourceEntity extends EntityBase {
  kind: "resource"
}

/**
 * COMMUNITY — a place gathering people and discussions (subreddit-like). NOT
 * completable; its terminal state is RETIREMENT (`retiredOn`).
 */
export interface CommunityEntity extends EntityBase {
  kind: "community"
  /** When the community was retired (terminal state; epoch ms). */
  retiredOn?: Epoch
}

/**
 * ORGANISM — a living entity at the level of Society (a body, or a company /
 * institution). NOT completable; its terminal state is DEATH (`diedOn`).
 */
export interface OrganismEntity extends EntityBase {
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
export interface IndividualEntity extends EntityBase {
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
export interface SoulEntity extends EntityBase {
  kind: "soul"
}

/**
 * ENTITY — the discriminated union of every particular Space, keyed on `kind`.
 * Narrow on `entity.kind === "task"` etc. to reach a variant's own fields.
 */
export type Entity =
  | TaskEntity
  | MomentEntity
  | InstantEntity
  | SpaceEntity
  | ResourceEntity
  | CommunityEntity
  | OrganismEntity
  | IndividualEntity
  | SoulEntity

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
