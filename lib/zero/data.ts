import type { Asset, Entity, EntityKind, IndividualEntity, Instant, LogType, OccurrenceRecord, Recurrence, Schedule, SeriesRule, Resource, EntityBase, Session, Sex, TaskPriority, TitleEntry, User } from "./types"
  import { hasDoneFlag, isClosed, computeCloseAt, getState, isOngoing, fillsGlyph, hasOpenSession, getOpenSession, setChildrenResolver, setContainedResolver, isPlannedStart, plannedStart, isOwnOngoing, effectiveScheduleEnd, getMarks, isMarkable, getSessions, canDeleteEntity, ONGOING_ON_ENTER } from "./kinds"
import {
  isDone,
  isCancelled,
  buildLogFromScalars,
  makeInstant,
  makeSet,
  appendInstant,
  ensureLogIds,
  auditLogScalarConsistency,
  deriveSessionsFromLog,
  } from "./entity-log"
import type { LogScalarMismatch } from "./entity-log"
import { readUserItems, writeUserItems } from "./persistence"
import type { UserItems } from "./persistence"
import { getLastKnownAlive } from "./activity-log"
import type { ScheduleParse } from "./schedule-parse"
import { fmtTime } from "./timeline-format"

/**
 * The loose shape accepted by {@link makeEntity}: an EntityBase plus a (possibly
 * dynamic) `kind` and any kind-specific optional fields. The discriminated `Entity`
 * union can't be built from a literal whose `kind` is only known at runtime (TS
 * can't pick a variant), so this is the SINGLE place we cross that boundary with a
 * cast. Seed literals with a static `kind` build `Entity` directly and bypass this.
 */
type LooseEntity = EntityBase & {
  kind: EntityKind
  // task-only
  priority?: TaskPriority
  requested?: boolean
  webUrl?: string
  webResourceId?: string
  // terminal / lifecycle meta (organism/individual/community)
  alive?: boolean
  bornAt?: number
  diedOn?: number
  retiredOn?: number
}

/** The one construction boundary for entities whose `kind` is dynamic. */
function makeEntity(props: LooseEntity): Entity {
  return props as Entity
}

/**
 * A MUTABLE loose view of a stored entity, for the imperative setters that change
 * `kind` and/or per-kind fields IN PLACE (changeEntityKind, applyParsedSchedule,
 * setEntityRequested, setTaskDone). The returned object is the SAME reference
 * held by `byId`/`entities`, so writes persist; the cast only lets TS allow assigning
 * the discriminant and cross-kind fields. Runtime behavior is identical to before the
 * Space-union refactor (these functions already mutated the object in place).
 */
function mutable(e: Entity): LooseEntity {
  return e as unknown as LooseEntity
}

/**
 * Ensure `entity` has a lifecycle log, seeding one from its scalar fields if absent
 * (see {@link buildLogFromScalars}), and return it. Used by the write paths so that
 * appending a new {@link Instant} always lands on a coherent log — even for entities
 * created before the log existed, or seeded entities that never persisted one. Sets
 * `entity.log` in place on the SAME reference held by `byId`/`entities`, so the seed
 * persists alongside the appended entry. Idempotent: a non-empty log is left as is.
 */
  function ensureEntityLog(entity: Entity): Instant[] {
  if (!entity.log || entity.log.length === 0) {
  entity.log = buildLogFromScalars(entity)
  }
  return entity.log
  }

  /**
   * Append a generic FIELD-SET entry to `entity`'s unified lifecycle log — the single
   * primitive every value-bearing setter (color / schedule / kind / requested / sex /
   * title) calls so an entity's whole life is retraceable from one list. `value` is the
   * new value, or `null` to record a clear. Seeds a log from scalars first if absent.
   *
   * NOTE (seeded entities): like the close/cancel dual-writes, a `set` entry on a SEEDED
   * entity lives only for the session — `buildLogFromScalars` rebuilds the log from scalars
   * on reload and does not replay field sets. The seeded-override patch carries the VALUE
   * forward (so the field itself persists); only its in-log history is session-scoped. For
   * USER entities the whole entity — log included — is persisted, so history is durable.
   */
  function logSet(entity: Entity, field: string, value: string | number | boolean | null, at = Date.now()): void {
  const log = ensureEntityLog(entity)
  entity.log = appendInstant(log, makeSet(field, value, at))
  }

/** Concise span text for an occurrence log line: "6:00 PM–1:30 AM" (or just the start when a point). */
function fmtOccSpan(start: number, end?: number): string {
  return end != null ? `${fmtTime(start)}–${fmtTime(end)}` : fmtTime(start)
}

/** Concise day text for a RULE-instance log line (recurrenceId = the local-midnight day-key): "Aug 7". */
function fmtOccDay(dayKey: number): string {
  return new Date(dayKey).toLocaleDateString([], { month: "short", day: "numeric" })
}

/**
 * Append an OCCURRENCE-level log entry (v0.2.254) recording a planned-occurrence mutation
 * (add / edit / cancel / restore / delete). Stored as a `set` entry with field `"occurrence"` and a
 * human `phrase` value like `"added · 6:00 PM–1:30 AM"`, so {@link describeLogEntry} renders it as
 * "occurrence added · 6:00 PM–1:30 AM". Using a `set` entry (not a new lifecycle {@link LogType}) means
 * every state/session fold ignores it (they only read typed lifecycle entries), and `fieldHistory
 * ("occurrence")` yields a free occurrence-history view.
 *
 * DELIBERATELY SEPARATE from the resyncPrimary scalar mirror: the occurrence writers used to `logSet
 * (entity, "startDate", …)` after resync, which spammed the log with automatic startDate/endDate churn
 * (Loris' point 5). Those mirror-logging calls are removed in favor of this explicit, meaningful verb.
 */
function logOccurrence(entity: Entity, phrase: string, at = Date.now()): void {
  const log = ensureEntityLog(entity)
  entity.log = appendInstant(log, makeSet("occurrence", phrase, at))
}

export const currentUser: User = {
  id: "u_self",
  name: "Loris",
  handle: "loris",
  avatarUrl: "/loris-avatar.png",
}

/**
 * The id of the ROOT node — the user's own Individual, the zero-point the whole
 * app is named for and the node every context descends from. It is literally `"0"`:
 * the origin of the tree, the individual's point of view on their world. This is the
 * SINGLE source of truth for that id (formerly the space-era `ROOT_ID`, renamed
 * Jul 2026); every module imports it rather than hard-coding the string, and a
 * one-time hydrate migration reattaches any data persisted under the old id.
 */
export const ROOT_ID = "0"

/**
 * The Individual acting right now. Single-user today, so this IS the root Individual
 * ("Loris" = {@link ROOT_ID}); it's the default `createdBy`/`ownerId` for everything
 * created, and the identity that owner-only actions (Complete, set close policy) check
 * against. Named separately from ROOT_ID so the multi-user future has one clear seam.
 */
export const CURRENT_ACTOR_ID = ROOT_ID

// ----------------------------------------------------------------------------
// Resources — apps, services, documents, tools available as contextual inputs
// ----------------------------------------------------------------------------

export const resources: Resource[] = [
  {
    id: "r_gmail",
    name: "Gmail",
    kind: "communication",
    icon: "Gm",
    description: "Inbox and threads",
    contextIds: [ROOT_ID, "s_dayjob", "s_admin", "s_team"],
    tint: "#C9685E",
  },
  {
    id: "r_slack",
    name: "Slack",
    kind: "communication",
    icon: "Sl",
    description: "Team channels",
    contextIds: ["s_dayjob", "s_team", "s_zero", "s_product"],
    tint: "#7B6CA6",
  },
  {
    id: "r_drive",
    name: "Drive",
    kind: "storage",
    icon: "Dr",
    description: "Cloud files",
    contextIds: [ROOT_ID, "s_dayjob", "s_zero", "s_admin"],
    tint: "#6E9C84",
  },
  {
    id: "r_figma",
    name: "Figma",
    kind: "design",
    icon: "Fg",
    description: "Design canvas",
    contextIds: ["s_zero", "s_product", "s_deck"],
    tint: "#C97A5A",
  },
  {
    id: "r_notion",
    name: "Notion",
    kind: "document",
    icon: "No",
    description: "Docs and wikis",
    contextIds: [ROOT_ID, "s_dayjob", "s_zero", "s_strategy", "s_research"],
    tint: "#9A9A93",
  },
  {
    id: "r_browser",
    name: "Browser Research",
    kind: "browser",
    icon: "Br",
    description: "Open research tabs",
    contextIds: ["s_research", "s_strategy", "s_zero"],
    tint: "#8A8F99",
  },
  {
    id: "r_journal",
    name: "Journal",
    kind: "note",
    icon: "Jr",
    description: "Daily entries",
    contextIds: ["s_personal", "s_journal", ROOT_ID],
    tint: "#A88C6A",
  },
  {
    id: "r_notes",
    name: "Notes",
    kind: "note",
    icon: "Nt",
    description: "Quick captures",
    contextIds: [ROOT_ID, "s_personal", "s_zero", "s_product"],
    tint: "#9A9488",
  },
  {
    id: "r_deck",
    name: "Investor Deck",
    kind: "document",
    icon: "Dk",
    description: "4FTER narrative",
    contextIds: ["s_zero", "s_deck", "s_strategy"],
    tint: "#B5895E",
  },
  {
    id: "r_contacts",
    name: "Contacts",
    kind: "service",
    icon: "Co",
    description: "People & relations",
    contextIds: [ROOT_ID, "s_dayjob", "s_personal", "s_family"],
    tint: "#7F9AA3",
  },
  {
    id: "r_files",
    name: "Files",
    kind: "file",
    icon: "Fl",
    description: "Local resources",
    contextIds: [ROOT_ID, "s_admin", "s_home"],
    tint: "#969089",
  },
  {
    id: "r_ai",
    name: "AI Assistant",
    kind: "ai",
    icon: "Ze",
    description: "Zero agent",
    contextIds: [
      ROOT_ID,
      "s_dayjob",
      "s_zero",
      "s_strategy",
      "s_research",
      "s_product",
      "s_health",
    ],
    tint: "#5E5E5E",
  },
  {
    id: "r_docs",
    name: "Docs",
    kind: "document",
    icon: "Do",
    description: "Shared documents",
    contextIds: ["s_dayjob", "s_team", "s_strategy", "s_admin"],
    tint: "#8C8C84",
  },
  {
    id: "r_sheet",
    name: "Spreadsheet",
    kind: "document",
    icon: "Sh",
    description: "Models & budgets",
    contextIds: ["s_admin", "s_strategy", "s_nutrition"],
    tint: "#6E9C84",
  },
  {
    id: "r_whiteboard",
    name: "Whiteboard",
    kind: "planning",
    icon: "Wb",
    description: "Spatial planning",
    contextIds: ["s_product", "s_strategy", "s_zero"],
    tint: "#9189A6",
  },
  {
    id: "r_health",
    name: "Health",
    kind: "service",
    icon: "Hl",
    description: "Vitals & activity",
    contextIds: ["s_health", "s_training", "s_sleep", "s_nutrition"],
    tint: "#6E9C84",
  },
]

// ----------------------------------------------------------------------------
// Entities — the single recursive model. Spaces, tasks, and events are all
// `Entity` records differing only by `kind`. Every entity has one origin
// `parentId` (the "created-from" container; the root `s_root` has null) plus an
// optional `taggedContextIds[]` for multi-parent links ("also shows up in").
//
// Containment for a context's task list is DIRECT children only:
//   parentId === contextId  OR  taggedContextIds includes contextId.
// The structural origin tree (parentId only) still drives timeline focus and
// subtree dimming via collectDescendants / isInSubtree.
// ----------------------------------------------------------------------------

// --- Demo time anchor -------------------------------------------------------
// Time is absolute epoch ms now (see Schedule). Seed data is anchored to the
// REAL current date at module load, so the demo always looks "live" — today's
// blocks sit on today, the now-marker is real. (Non-deterministic across days,
// which is the intended trade-off.)
export const DAY_MS = 86_400_000

/** Midnight (epoch ms) of the calendar day that the CURRENT 5am���5am "human day"
 *  window started on — computed once at module load. This is the seed's day origin.
 *
 *  Zero's day boundary is 5am, not midnight (the Dayline shows [5am → next 5am]). So
 *  in the wee hours (00:00–05:00) you are still inside YESTERDAY's human-day. If the
 *  demo anchored to plain calendar-midnight-today, a `t(9)` (9am) block would land in
 *  the NEXT window and the live surfaces (Dayline, now-centered timeline) would look
 *  empty until 5am. Anchoring to the active window's start day instead keeps the demo
 *  "live" within whatever human-day you're actually in. */
const START_OF_TODAY = (() => {
  const now = Date.now()
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  // Before today's 5am → the active 5am-window opened on yesterday's calendar day.
  const beforeRollover = now < midnight.getTime() + 5 * 3_600_000
  return beforeRollover ? midnight.getTime() - DAY_MS : midnight.getTime()
})()

/** Epoch ms for the day-origin at h:m(:s) local. Keeps seed rows readable: `t(9, 30)`. */
const t = (h: number, m = 0, s = 0) => START_OF_TODAY + h * 3_600_000 + m * 60_000 + s * 1000

/** Epoch ms for a day-offset from the origin at h:m local. `dayT(1, 9)` = next day 9am. */
const dayT = (dayOffset: number, h = 0, m = 0) => t(h, m) + dayOffset * DAY_MS

/** Next occurrence (origin day or future) of weekday `wd` (0=Sun..6=Sat) at `h:00`. */
const nextWeekday = (wd: number, h = 17) => {
  const today = new Date(START_OF_TODAY).getDay()
  const delta = (wd - today + 7) % 7
  return dayT(delta, h)
}

const ACCENT = {
  dayjob: "#2F6FED",
  zero: "#D6209A",
  personal: "#E8810C",
  health: "#15A36B",
} as const

export const entities: Entity[] = [
  // --- Identity triad -------------------------------------------------------
  // The SOUL (glyph: a dot) is the ROOT behind every person — the irreducible core
  // self that animates a body. It has no parent (it is the outermost entity) and is
  // system-only + hidden from listings (see getChildren). A Soul possesses/contains
  // an Individual: it is the parent of `s_root` below.
  {
    id: "soul_self",
    kind: "soul",
    title: "Soul",
    parentId: null,
    taggedContextIds: [],
    description: "The irreducible core self.",
  },
  // entity0 is the INDIVIDUAL (glyph: a Z rotated 45° anticlockwise) — the person the
  // Soul animates, whose space IS the homeview (the door to their life). Its id is
  // `ROOT_ID` ("0" — the zero-point of the tree, formerly the space-era `s_root`);
  // its `kind` is individual, its `title` is the user's name, and it nests inside the
  // Soul (`soul_self`). The former separate "i_self" node is gone — `"0"` is that person.
  {
    id: ROOT_ID,
    kind: "individual",
    title: currentUser.name,
    parentId: "soul_self",
    taggedContextIds: [],
    description: "A person, animated by a Soul.",
    // CREATED — when the Zero ENTITY for Loris was created (DISTINCT from birth): 22 Jun 2026,
    // 12:46:08 local. There's deliberately no `--created` sugar (creationDate is stamped only at
    // creation), so CREATED and BORN read as two different dates. Built from local-time
    // components (month is 0-based, so 5 = June) so it round-trips through `toLocaleString()`.
  creationDate: new Date(2026, 5, 22, 12, 46, 8, 0).getTime(),
  // The confirmed `bornAt` BIRTHDAY — the SOURCE OF TRUTH for the `alive` state (a past value ⇒
  // alive/live) and the AGE row. 19 May 1991, 13:33 local (month 0-based, 4 = May). Being born
  // (a past bornAt) also makes root NOT deletable (an empty individual with no bornAt reads
  // `open` = deletable).
  bornAt: new Date(1991, 4, 19, 13, 33, 0, 0).getTime(),
  // Loris is a man.
  sex: "man",
  // Root canvas starts as a FRESH tree: the Individual owns no inputs yet, and
  // has no space/task children. Everything below is grown by the user at runtime.
  inputs: [],
  },
  // --- WEB-PREVIEW SAMPLE SET ----------------------------------------------
  // A minimal, legible sample under the Individual: ONE of each core kind so the web
  // preview has something to interact with, plus a second Space "Edan" (a plain live Space —
  // playable by kind, its glyph offers Play/Stop; no schedule needed). Accents per Loris's spec:
  // blue space · purple moment · pink instant · green resource · amber Edan; the Task is
  // left uncoloured. The green Resource points at the internal `/matrix-interactions`
  // doc viewer, so it doubles as the one-click matrix link the preview used to carry.
  //
  // These are demo fixtures (they never persist — only user mutations hit localStorage)
  // and are EXCLUDED from the packaged DESKTOP export via NEXT_PUBLIC_ZERO_ELECTRON, so
  // dogfooding on the Surface app still starts from a clean tree.
  ...(process.env.NEXT_PUBLIC_ZERO_ELECTRON !== "1"
    ? ([
        { id: "seed_space", kind: "space", title: "Space", parentId: ROOT_ID, taggedContextIds: [], color: "#4A90E2" },
        { id: "seed_task", kind: "task", title: "Task", parentId: ROOT_ID, taggedContextIds: [], done: false },
        { id: "seed_moment", kind: "moment", title: "Moment", parentId: ROOT_ID, taggedContextIds: [], color: "#A855F7" },
        { id: "seed_instant", kind: "instant", title: "Instant", parentId: ROOT_ID, taggedContextIds: [], color: "#EC4899" },
        {
          id: "seed_edan",
          kind: "space",
          title: "Edan",
          parentId: ROOT_ID,
          taggedContextIds: [],
          color: "#F5A623",
        },
        {
          id: "r_matrix",
          kind: "resource",
          title: "Interaction Matrix",
          parentId: ROOT_ID,
          taggedContextIds: [],
          color: "#2ECC71",
          done: false,
          tags: [],
          webUrl: "/matrix-interactions",
        },
        // --- ZERO — the docs Space -------------------------------------------
        // A magenta Space under the Individual whose children are the in-app doc
        // pages, each a Resource pointing at its route (webUrl). This is the
        // dogfooding HOME for Zero's own documentation: drill into "Zero" and every
        // doc reads as a normal entity you can open, pin, or right-click.
        { id: "s_zero", kind: "space", title: "Zero", parentId: ROOT_ID, taggedContextIds: [], color: ACCENT.zero },
        ...(
          [
            ["Features", "/features"],
            ["Sugars", "/sugars"],
            ["Excerpts", "/excerpts"],
            ["Vision", "/vision"],
            ["Zero Laws", "/zero-laws"],
            ["Zero Entities", "/zero-entities"],
            ["Entity Kinds", "/entity-kinds"],
            ["Interaction Matrix", "/matrix-interactions"],
            ["Future Chromium Strategy", "/future-chromium-zero-strategy"],
          ] as const
        ).map(
          ([title, url]) =>
            ({
              id: `r_doc_${url.slice(1)}`,
              kind: "resource",
              title,
              parentId: "s_zero",
              taggedContextIds: [],
              color: ACCENT.zero,
              done: false,
              tags: [],
              webUrl: url,
            }) as Entity,
        ),
      ] as Entity[])
    : []),
  ]

// ----------------------------------------------------------------------------
// Assets — unified resource/asset model (kept as a separate concern)
// ----------------------------------------------------------------------------

export const assets: Asset[] = [
  {
    id: "a1",
    title: "4FTER — Investor Deck v7",
    type: "deck",
    linkedResourceId: "r_deck",
    contextId: "s_deck",
    preview: "18 slides · edited 2h ago",
  },
  {
    id: "a2",
    title: "Zero — Interaction Spec",
    type: "document",
    linkedResourceId: "r_notion",
    contextId: "s_product",
    preview: "Living doc · 12 sections",
  },
  {
    id: "a3",
    title: "Nested Space Studies",
    type: "image",
    linkedResourceId: "r_figma",
    contextId: "s_product",
    preview: "Frame set · 6 boards",
  },
  {
    id: "a4",
    title: "Strategy Memo — H2",
    type: "note",
    linkedResourceId: "r_notes",
    contextId: "s_strategy",
    preview: "Note · 4 min read",
  },
  {
    id: "a5",
    title: "Financial Model",
    type: "sheet",
    linkedResourceId: "r_sheet",
    contextId: "s_admin",
    preview: "Sheet · 9 tabs",
  },
  {
    id: "a6",
    title: "Notion Plus",
    type: "subscription",
    linkedResourceId: "r_notion",
    contextId: ROOT_ID,
    preview: "Subscription · renews Apr 2",
  },
  {
    id: "a7",
    title: "Research — Contextual UIs",
    type: "link",
    linkedResourceId: "r_browser",
    contextId: "s_research",
    preview: "14 saved links",
  },
  {
    id: "a8",
    title: "Daily Journal",
    type: "note",
    linkedResourceId: "r_journal",
    contextId: "s_journal",
    preview: "Note · 142 entries",
  },
  {
    id: "a9",
    title: "Figma Organization",
    type: "subscription",
    linkedResourceId: "r_figma",
    contextId: ROOT_ID,
    preview: "Subscription · seat active",
  },
  {
    id: "a10",
    title: "Family Calendar",
    type: "link",
    linkedResourceId: "r_contacts",
    contextId: "s_family",
    preview: "Shared · 4 people",
  },
]

// ----------------------------------------------------------------------------
// Indexes
// ----------------------------------------------------------------------------

const byId = new Map<string, Entity>(entities.map((e) => [e.id, e]))
const resourceById = new Map(resources.map((r) => [r.id, r]))

// Recurrence OVERRIDE index (materialize-on-touch, D1). Maps `${seriesId}@${dayStart}`
// → the materialized occurrence entity that stands in for that day. Lets the expander
// swap a virtual occurrence for its real override in O(1) instead of scanning. Kept in
// sync wherever overrides are created (materializeOccurrence) or loaded (hydrate).
const overrideIndex = new Map<string, Entity>()
function overrideKey(seriesId: string, dayStart: number): string {
  return `${seriesId}@${dayStart}`
}
function indexOverride(e: Entity): void {
  if (e.seriesId != null && e.recurrenceId != null) {
    overrideIndex.set(overrideKey(e.seriesId, e.recurrenceId), e)
  }
}
/** The materialized override for one occurrence day, if the user has touched it. */
export function occurrenceOverride(seriesId: string, dayStart: number): Entity | undefined {
  return overrideIndex.get(overrideKey(seriesId, dayStart))
}
// Seed data has no overrides, but stay correct if that ever changes.
for (const e of entities) indexOverride(e)

// ----------------------------------------------------------------------------
// Core entity accessors
// ----------------------------------------------------------------------------

export function getEntity(id: string): Entity | undefined {
  return byId.get(id)
}

// ── GLYPH PULSE BUS ─────────────────────────────────────────────────────────────
// A one-shot "spin-once" signal broadcast BY ENTITY ID, so a Face can flash its glyph in
// response to something that happened ELSEWHERE (not its own click). Today's sole use: when
// an INSTANT is marked (or fires by a passed `at`), the instant AND every TASK ancestor spin
// once TOGETHER — the parent task's glyph (and all its task ancestors') acknowledges the tick
// at the same moment. Module-level (survives re-renders); Faces subscribe by their own id.
type PulseListener = () => void
const pulseListeners = new Map<string, Set<PulseListener>>()

/** Subscribe a Face (by its entity id) to pulse signals. Returns an unsubscribe fn. */
export function subscribeGlyphPulse(id: string, cb: PulseListener): () => void {
  let set = pulseListeners.get(id)
  if (!set) pulseListeners.set(id, (set = new Set()))
  set.add(cb)
  return () => {
    set!.delete(cb)
    if (set!.size === 0) pulseListeners.delete(id)
  }
}

/** Fire a one-shot pulse at each id (any subscribed Face spins its glyph once). */
export function pulseGlyphs(ids: Iterable<string>): void {
  for (const id of ids) pulseListeners.get(id)?.forEach((cb) => cb())
}

/**
 * The chain of TASK ancestors above an entity, walking `parentId` upward. Stops at the first
 * non-task parent (a task's containment ends where the task nesting ends) — an instant under
 * `Task A ▸ Task B ▸ instant` yields `[B, A]`; a `Space ▸ Task ▸ instant` yields `[Task]`.
 * Cycle-guarded. Used to propagate an instant's mark pulse up its task lineage.
 */
export function taskAncestorIds(id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>([id])
  let cur = byId.get(id)?.parentId
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const p = byId.get(cur)
    if (!p || p.kind !== "task") break
    out.push(p.id)
    cur = p.parentId
  }
  return out
}

export function getResource(id: string): Resource | undefined {
  return resourceById.get(id)
}

/**
 * Direct children of a context — the entities whose ORIGIN parent is it, plus
 * entities LINKED (tagged) to it. This powers the task list: a context shows
 * its own children only, never the children of its children. Returned in
 * CREATION order (oldest first): the `entities` array is in insertion order
 * (seed first, user items appended), so we simply preserve it rather than
 * sorting by kind. The user may reorder later via drag-and-drop.
 */
export function getChildren(contextId: string): Entity[] {
  const kids = entities.filter(
    (e) =>
      e.id !== contextId &&
      // The SOUL stays structural — the animating self is never browsable content, so
      // it's excluded from every do-list / child listing. INDIVIDUAL is intentionally
      // NOT filtered anymore (Jul 2026): it's temporarily creatable for dogfooding, and
      // in the root canvas the root itself IS the Individual, so a created person should
      // appear as a normal child. (The scaffold's own Individual is the root context and
      // its Soul parent is unreachable, so neither leaks into a listing here.)
      e.kind !== "soul" &&
      // SOFT-DELETED entities drop out of EVERY listing + rollup unconditionally (unlike
      // `hidden`, which "Show hidden" reveals). They're reachable only via the container's
      // right-click ▸ Deleted list (getDeletedChildren) to Restore. See Entity.deletedAt.
      e.deletedAt == null &&
      // Materialized recurrence occurrences (overrides) are timeline instances, not
      // do-list children — they must never leak into any listing (the round-27 trap).
      e.seriesId == null &&
      (e.parentId === contextId || e.taggedContextIds.includes(contextId)),
  )

  // Apply the user's drag-and-drop order (if any) for this context. Ranked ids
  // come first in the saved order; anything unranked (e.g. a freshly created
  // item, or one added after the last reorder) keeps its creation-order slot at
  // the end. Decorate/sort/undecorate so we never depend on Array.sort stability
  // for the unranked tail and never mutate the source `entities` array.
  const order = orderByContext[contextId]
  if (!order || order.length === 0) return kids
  const rank = new Map<string, number>()
  order.forEach((id, i) => rank.set(id, i))
  return kids
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ra = rank.get(a.e.id)
      const rb = rank.get(b.e.id)
      if (ra != null && rb != null) return ra - rb
      if (ra != null) return -1
      if (rb != null) return 1
      return a.i - b.i
    })
    .map((x) => x.e)
}

/**
 * The SOFT-DELETED children at a context — the mirror of {@link getChildren}, returning only
 * the entities `getChildren` filters out for being deleted (same parent/tag membership + the
 * soul/series exclusions). Powers the container's right-click ▸ Deleted restore list. Newest
 * deletions first (by `deletedAt`) so the most recent mistake is easiest to undo.
 */
export function getDeletedChildren(contextId: string): Entity[] {
  return entities
    .filter(
      (e) =>
        e.id !== contextId &&
        e.kind !== "soul" &&
        e.seriesId == null &&
        e.deletedAt != null &&
        (e.parentId === contextId || e.taggedContextIds.includes(contextId)),
    )
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
}

// Wire getChildren into kinds.ts so child-gated Task completion (a Done task isn't
// COMPLETE until all its `kind==="task"` children are) can resolve children without a
// circular import (kinds is the lower module). One-time, at module load.
setChildrenResolver(getChildren)

// Wire a CONTAINMENT-ONLY resolver (parentId links, NEVER taggedContextIds, and NEVER
// materialized recurrence occurrences) for the ongoing ROLLUP: a Space is ongoing while a
// CONTAINED descendant runs, but a merely tagged-in ongoing entity must NOT light it up.
setContainedResolver((contextId) => entities.filter((e) => e.parentId === contextId && e.seriesId == null))

/**
 * Whether `childId` has an IN-PLACE owning node inside `hostId` ������������� i.e. it would
 * render in `host`'s DO-LIST (structural parent or tagged space) OR in `host`'s
 * DOCK (pinned there). Either gives the entity a row/card to morph out of and
 * back into, so it is NOT detached. (A pinned space, e.g. Health on home, is a
 * dock member even though home is not its parent — without the pin check it would
 * be wrongly treated as detached and open from center instead of its dock card.)
 */
export function isMemberOf(childId: string, hostId: string): boolean {
  const e = byId.get(childId)
  if (!e) return false
  return e.parentId === hostId || e.taggedContextIds.includes(hostId) || isPinned(hostId, childId)
}

/**
 * The inverse of {@link isMemberOf}: `childId` does NOT belong to `hostId`'s
 * do-list/dock, so opening it "under" `host` in the nav stack has no in-place row
 * to morph from — it must be rendered as a DETACHED window (see work-surface) and
 * morphed from an explicit origin instead. The root has no host (never detached).
 */
export function isDetachedChild(childId: string, hostId: string | undefined): boolean {
  if (!hostId) return false
  return !isMemberOf(childId, hostId)
}

/**
 * The three task tallies (open / done / closed) are MUTUALLY EXCLUSIVE and mirror
 * the three glyph states (see `isClosed`):
 *   • OPEN   — outline, empty  : incomplete AND not closed
 *   • DONE   — outline + check : completed but NOT yet closed
 *   • CLOSED — filled          : closed (manual/cancelled/derived past midnight)
 * Only DIRECT child tasks (origin + tagged) count; child spaces/events are excluded.
 */

/** Count of open (incomplete, not closed) direct child tasks. */
export function getOpenTaskCount(contextId: string): number {
  return getChildren(contextId).filter((e) => e.kind === "task" && !isDone(e) && !isClosed(e)).length
}

/** Count of done-but-not-closed direct child tasks (checkmark, no fill). */
export function getDoneTaskCount(contextId: string): number {
  return getChildren(contextId).filter((e) => e.kind === "task" && isDone(e) && !isClosed(e)).length
}

/**
 * Count of closed direct child tasks that were closed for a reason OTHER than
 * cancellation (filled glyph). Cancelled tasks are `isClosed` too, but the excerpt
 * shows them as their own tally (struck-through glyph), so they're excluded here.
 */
export function getClosedTaskCount(contextId: string): number {
  return getChildren(contextId).filter((e) => e.kind === "task" && isClosed(e) && !e.cancelled).length
}

/** Count of cancelled direct child tasks (struck-through glyph). Mutually exclusive
 *  from the open/done/closed tallies: cancelled implies `isClosed`, so those helpers
 *  (which all gate on `isClosed` / `!e.cancelled`) never also count these. */
export function getCancelledTaskCount(contextId: string): number {
  return getChildren(contextId).filter((e) => e.kind === "task" && !!e.cancelled).length
}

/** Count of OPEN direct child moments (outline triangle). "Open" = not yet closed,
 *  which — via `isClosed` — also excludes cancelled moments and ones past their end. */
export function getOpenMomentCount(contextId: string): number {
  return getChildren(contextId).filter((e) => e.kind === "moment" && !isClosed(e)).length
}

/** Count of CANCELLED direct child moments (struck-through triangle). */
export function getCancelledMomentCount(contextId: string): number {
  return getChildren(contextId).filter((e) => e.kind === "moment" && !!e.cancelled).length
}

/** Count of CANCELLED direct child instants (struck-through triangle). Only the
 *  cancelled instants surface in the excerpt (open/passed instants are omitted). */
export function getCancelledInstantCount(contextId: string): number {
  return getChildren(contextId).filter((e) => e.kind === "instant" && !!e.cancelled).length
}

/**
 * Count of DIRECT child SPACES (origin + tagged). Uses the same `getChildren`
 * listing as the do-list/dock, so it matches what's browsable inside the entity.
 * Drives the "spaces" counter in the rail excerpt.
 */
export function getChildSpaceCount(contextId: string): number {
  return getChildren(contextId).filter((e) => e.kind === "space").length
}

/**
 * Every entity that has at least one session in `schedule.sessions`, regardless of kind or
 * position in the tree. Needed by the dayline's spine (middle rail) + recorded (bottom) rail:
 * `collectDescendants` only walks SPACES, so a Resource/Task/Moment leaf (e.g. a web resource you
 * were focused on) would be invisible to those rails — the v0.6.21 bug where the spine showed the
 * parent Space instead of the current leaf. Read-only snapshot (a fresh array).
 */
export function getEntitiesWithSessions(): Entity[] {
  return entities.filter((e) => (e.schedule?.sessions?.length ?? 0) > 0)
}

// ----------------------------------------------------------------------------
// Subtree helpers (structural origin tree) — drive timeline focus + dimming
// ----------------------------------------------------------------------------

/** Set of space ids in `contextId`'s structural subtree, including itself. */
export function collectDescendants(contextId: string): Set<string> {
  const set = new Set<string>([contextId])
  let grew = true
  while (grew) {
    grew = false
    for (const e of entities) {
      if (e.kind !== "space" || e.parentId === null || e.seriesId != null) continue
      if (set.has(e.parentId) && !set.has(e.id)) {
        set.add(e.id)
        grew = true
      }
    }
  }
  return set
}

/** True when `contextId` is `nodeId` or a descendant of it. */
export function isInSubtree(nodeId: string, contextId: string): boolean {
  if (nodeId === ROOT_ID) return true
  return collectDescendants(nodeId).has(contextId)
}

/**
 * Walk up from `contextId` and return the DIRECT child space of `focusId` whose
 * subtree contains it — i.e. the band an item would roll up INTO under the
 * adaptive semantic-LOD. Returns:
 *   - `null` if `contextId` is the focus itself or a direct member of it (no
 *     intervening child space — these items always render individually), or
 *   - `undefined` if `contextId` isn't under `focusId` at all.
 * Drives timeline semantic rollup (e.g. a meeting deep under "Day Job" resolves
 * to the "Day Job" child space when focus is Home).
 */
export function directChildOfFocus(contextId: string | null, focusId: string): string | null | undefined {
  if (!contextId) return undefined
  // Build the parent chain of `contextId` up to the root.
  const chain: string[] = []
  let cur: Entity | undefined = byId.get(contextId)
  while (cur) {
    chain.push(cur.id)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  const focusIdx = chain.indexOf(focusId)
  // s_root focus: the "direct child of root" is the chain element just below root.
  if (focusId === ROOT_ID) {
    // chain ends at the true root (s_root or a top-level node). Find s_root's index.
    const rootIdx = chain.indexOf(ROOT_ID)
    const idx = rootIdx === -1 ? chain.length - 1 : rootIdx
    if (idx <= 0) return null // item lives directly at root
    return chain[idx - 1]
  }
  if (focusIdx === -1) return undefined // not under focus
  if (focusIdx === 0) return null // item lives directly in focus
  return chain[focusIdx - 1] // the direct child of focus on the path down
}

// ----------------------------------------------------------------------------
// Compatibility selectors — kept so existing components keep working. They are
// now thin wrappers over the unified entity model.
// ----------------------------------------------------------------------------

/** A space entity by id (undefined for non-space ids). */
export function getSpace(id: string): Entity | undefined {
  const e = byId.get(id)
  return e && e.kind === "space" ? e : undefined
}

/**
 * Resolve the accent color a child should inherit on the timeline. Walk up the
 * parent chain starting at `contextId` and return the nearest ancestor that has
 * its own accent. The root space (`s_root` / "Space 0") has no accent, so an
 * item created directly under it resolves to `undefined` — callers render those
 * with a neutral fallback (light grey). e.g. an instant in Zero inherits Zero's
 * magenta; an instant in Space 0 inherits nothing.
 */
export function getInheritedAccent(contextId: string | null): string | undefined {
  let current = contextId ? byId.get(contextId) : undefined
  while (current) {
    if (current.kind === "space" && current.color) return current.color
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return undefined
}

/**
 * The ENVIRONMENT KEY for a web resource opened under `entityId` — the identity of the
 * isolated cookie jar / login it uses. Walk up the entity's OWN parentId chain and return the
 * nearest SPACE ancestor's id; if there is no Space ancestor, return ROOT_ID (the shared default
 * environment). This is what makes SSO work WITHIN a Space (every resource filed under the same
 * Space — directly or nested under Tasks/Moments/etc. — shares one env, so a login carries across
 * them) while ISOLATING across Spaces (a resource under "Client A" and one under "Client B" get
 * separate envs, so separate logins). Deterministic by design: it follows the entity's PRIMARY
 * parent chain only (never `taggedContextIds`), so a resource's env never changes with how you
 * navigated to it. The host keys the WebView2 environment folder + profile by this string.
 */
export function getEnvKey(entityId: string | null): string {
  let current = entityId ? byId.get(entityId) : undefined
  while (current) {
    if (current.kind === "space") return current.id
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return ROOT_ID
}

// ----------------------------------------------------------------------------
// FREQUENT ENTITIES (§4 quick-create band)
// ----------------------------------------------------------------------------

/** One row of the FREQUENT band: a recurring activity (a kind+title the user creates
 *  repeatedly), with the info needed to quick-create another and to list the ones
 *  currently running. */
export interface FrequentGroup {
  /** Stable identity: `${kind}\u0000${normalizedTitle}`. */
  key: string
  kind: EntityKind
  /** Display title (the most recent occurrence's exact casing). */
  title: string
  /** How many occurrences fell inside the recent window (the ranking weight). */
  count: number
  /** Where a NEW occurrence is created — the parent the activity USUALLY lives under
   *  (the modal parentId across matches, tie-broken by the most recent). */
  parentId: string
  /** The representative occurrence's OWN accent (`:color:`), if any — else undefined
   *  (the tile falls back to grey, or the sleep default for sleep-titled rows). */
  accent?: string
  /** How many members are currently ONGOING (started, unended → spinning). Drives the
   *  `(n)` counter + the "spin the tile glyph" state. Moment-only in practice. */
  ongoingCount: number
  /** Members shown in the expanded vertical list: everything currently ONGOING **or**
   *  COMPLETE-but-not-closed (a finished span still awaiting its overnight filing).
   *  Sorted by start (oldest first). Ended (closed/cancelled) members are excluded. */
  instances: FrequentInstance[]
}

/** One row of a FREQUENT group's expanded list — an ongoing or complete occurrence. */
export interface FrequentInstance {
  id: string
  kind: EntityKind
  title: string
  startAt: number
  /** The scheduled span end (ms) if any — present for a COMPLETE occurrence, and also for
   *  an ONGOING one that carries a FUTURE end (which powers the down-counter). null when
   *  the occurrence has no end at all (open-ended ongoing → elapsed count-up). */
  endAt: number | null
  state: "ongoing" | "complete"
  /** Canonical glyph fill from {@link fillsGlyph} — so the list glyph matches the entity
   *  header exactly (COMPLETE fills; ONGOING stays an outline that spins). */
  filled: boolean
}

/** Kinds that count as repeatable "activities" for the FREQUENT band. Structural kinds
 *  (identity scaffold + containers) are excluded �� you don't quick-create a Space "now". */
const FREQUENT_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>(["task", "moment", "instant"])

/**
 * Rank the user's recurring activities for the FREQUENT band: group live entities by
 * (kind + normalized title), COUNT occurrences created within a recent window (default
 * 30 days), and return the busiest groups. Each group also carries where to create the
 * next one (its usual parent) and the members currently ongoing.
 *
 * "Frequent" means repeated: a group needs at least `minCount` (default 2) windowed
 * occurrences to qualify, so genuine one-offs never clutter the band.
 */
export function getFrequentEntities(opts?: {
  windowDays?: number
  limit?: number
  minCount?: number
}): FrequentGroup[] {
  const windowDays = opts?.windowDays ?? 30
  const limit = opts?.limit ?? 12
  const minCount = opts?.minCount ?? 2
  const now = Date.now()
  const since = now - windowDays * DAY_MS

  interface Bucket {
    kind: EntityKind
    members: Entity[] // all live members sharing this key (any time)
    windowCount: number // members created within the window (ranking weight)
    latest: Entity // most-recently-created member (representative casing/accent)
    parentCounts: Map<string, number> // parentId → how many members live there
  }
  const buckets = new Map<string, Bucket>()

  for (const e of entities) {
    if (e.id === ROOT_ID) continue
    if (!FREQUENT_KINDS.has(e.kind)) continue
    const norm = e.title.trim().replace(/\s+/g, " ").toLowerCase()
    if (!norm) continue
    const key = `${e.kind}\u0000${norm}`
    const created = e.creationDate ?? 0
    let b = buckets.get(key)
    if (!b) {
      b = { kind: e.kind, members: [], windowCount: 0, latest: e, parentCounts: new Map() }
      buckets.set(key, b)
    }
    b.members.push(e)
    if (created >= since) b.windowCount++
    if (created >= (b.latest.creationDate ?? 0)) b.latest = e
    if (e.parentId) b.parentCounts.set(e.parentId, (b.parentCounts.get(e.parentId) ?? 0) + 1)
  }

  const groups: FrequentGroup[] = []
  for (const [key, b] of buckets) {
    if (b.windowCount < minCount) continue
    // Usual parent = the modal parentId (tie → the latest member's parent).
    let parentId = b.latest.parentId ?? ROOT_ID
    let best = -1
    for (const [pid, c] of b.parentCounts) {
      if (c > best) {
        best = c
        parentId = pid
      }
    }
    // The expanded-list members: ONGOING (live) + COMPLETE (finished, not yet closed),
    // oldest first. Ended members (closed/cancelled/…) drop out.
    const instances: FrequentInstance[] = b.members
      // STATUS (ongoing) is now its own axis; a "complete" STATE still comes from getState.
      .map((m) => ({ m, on: isOngoing(m, now), word: getState(m, now).word }))
      .filter((x) => x.on || x.word === "complete")
      .sort((a, c) => (plannedStart(a.m) ?? 0) - (plannedStart(c.m) ?? 0))
      .map((x) => ({
        id: x.m.id,
        kind: x.m.kind,
        title: x.m.title,
        startAt: plannedStart(x.m) ?? now,
        endAt: x.m.schedule?.endDate ?? null,
        state: (x.on ? "ongoing" : "complete") as "ongoing" | "complete",
        filled: fillsGlyph(x.m),
      }))
    const ongoingCount = instances.reduce((n, i) => n + (i.state === "ongoing" ? 1 : 0), 0)
    // ACCENT: the newest member that ACTUALLY carries one — NOT strictly `b.latest`, whose
    // accent may be undefined (a punched-in occurrence is created without a color, and being
    // newest would otherwise blank the tile dot). Falls back to any accented member.
  const accent = b.members
    .filter((m) => !!m.color)
    .sort((a, c) => (c.creationDate ?? 0) - (a.creationDate ?? 0))[0]?.color
    groups.push({
      key,
      kind: b.kind,
      title: b.latest.title,
      count: b.windowCount,
      parentId,
      accent,
      ongoingCount,
      instances,
    })
  }

  // Busiest first; ties broken by the most recent occurrence so a fresh habit floats up.
  groups.sort((a, c) => c.count - a.count)
  return groups.slice(0, limit)
}

/** A task entity by id (undefined for non-task ids). */
export function getTask(id: string): Entity | undefined {
  const e = byId.get(id)
  return e && e.kind === "task" ? e : undefined
}

/** A moment entity by id (undefined for non-moment ids). */
export function getMoment(id: string): Entity | undefined {
  const e = byId.get(id)
  return e && e.kind === "moment" ? e : undefined
}

/** An instant entity by id (undefined for non-instant ids). */
export function getInstant(id: string): Entity | undefined {
  const e = byId.get(id)
  return e && e.kind === "instant" ? e : undefined
}

/** Direct child spaces of a context. */
export function getChildSpaces(contextId: string): Entity[] {
  return entities.filter((e) => e.kind === "space" && e.parentId === contextId)
}

  /** Resources DIRECTLY input to a context (its own `inputs` whose id resolves in the Resource
   * catalog — not the subtree). Non-resource input edges (the future general case) are skipped. */
  export function getAssignedResources(contextId: string): Resource[] {
  const space = getSpace(contextId)
  if (!space) return []
  return (space.inputs ?? [])
  .map((edge) => resourceById.get(edge.id))
  .filter(Boolean) as Resource[]
  }

/**
 * Tasks anywhere in a context's subtree (origin or tagged). Used by legacy
 * callers; the task list itself uses getChildren for direct children.
 */
export function getSubtreeTasks(contextId: string): Entity[] {
  if (contextId === ROOT_ID) return entities.filter((e) => e.kind === "task" && e.seriesId == null)
  const descendants = collectDescendants(contextId)
  return entities.filter(
    (e) =>
      e.kind === "task" &&
      e.seriesId == null &&
      ((e.parentId !== null && descendants.has(e.parentId)) ||
        e.taggedContextIds.some((sid) => descendants.has(sid))),
  )
}

/** Timed entities anywhere in a context's subtree (NOT just moments) — anything
 *  carrying a schedule. Drives the timeline — moments render as spans, instants as
 *  single-point markers, and SCHEDULED SPACES (a space with its own `schedule`, e.g.
 *  a recurring "Workout" world) render as span chips too. Time is read directly off
 *  `entity.schedule` (absolute epoch ms). Recurring entities are expanded into per-day
 *  occurrences by getTimelineOccurrences; this selector returns the underlying entities. */
export function getTimedDescendants(contextId: string): Entity[] {
  // ANY entity that carries a scheduled time (start / end / point / due) is timed —
  // we no longer discriminate by kind. A Task with a start+end, a Space with a due
  // date, a Community with a point — all belong on the lifeline. `seriesId != null`
  // rows are per-day occurrence OVERRIDES (materialized from a recurring mother), which
  // getTimelineOccurrences emits itself, so they're excluded here to avoid duplicates.
  const hasScheduledTime = (s: Entity["schedule"]) =>
    !!s &&
    (s.startDate != null ||
      s.endDate != null ||
      s.at != null ||
      s.dueDate != null ||
      // An entity may have a null live start/end but keep planned/past spans — those
      // plannedOccurrences must still place it on the lifeline so their ticks keep rendering.
      (s.plannedOccurrences != null && s.plannedOccurrences.length > 0))
  const isTimed = (e: Entity) => e.seriesId == null && hasScheduledTime(e.schedule)
  if (contextId === ROOT_ID) return entities.filter(isTimed)
  const descendants = collectDescendants(contextId)
  return entities.filter(
    (e) => isTimed(e) && e.parentId !== null && descendants.has(e.parentId),
  )
}

/**
 * A concrete, placed instance of a timed entity on the timeline. One-off
 * entities yield a single occurrence; recurring ones yield one per matching day
 * within the queried range. Each occurrence carries the entity's identity and
 * resolved `schedule`, plus a unique `occKey` for React/lane bookkeeping.
 */
// Intersection (not `extends`) so it DISTRIBUTES over the `Entity` discriminated
// union — `TimelineOccurrence` is "any Entity variant, plus an `occKey`", and
// narrowing on `.kind` still reaches each variant's own fields.
export type TimelineOccurrence = Entity & {
  /** Unique per rendered occurrence (a recurring series produces several). */
  occKey: string
  /** OCCURRENCE DISPATCH IDENTITY (v0.2.249) — present only for dayline occurrences from
      `getDaylineOccurrences`, so a top-rail tick's right-click menu can act on THAT occurrence (the same
      origin-discriminated address the §0 block uses). Absent for the legacy `getTimelineOccurrences`. */
  occRef?: {
    origin: "definite" | "rule"
    occIndex: number
    recurrenceId?: number
    ruleId?: string
    /** (end ?? start) >= now — gates Edit/Cancel (can't re-time/cancel history). */
    cancellable: boolean
  }
}

/** Local midnight (epoch ms) for the day containing `epoch`. */
function dayStartOf(epoch: number): number {
  const d = new Date(epoch)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Does the local day starting at `dayStart` match `repeat` (anchored at the
 * series' first occurrence `anchor`)? Implements the small RRULE subset in
 * `Recurrence`: daily / weekly(+byWeekday) / monthly / yearly, each with an
 * optional `interval` and `until`.
 */
export function dayMatchesRecurrence(dayStart: number, anchor: number, repeat: Recurrence): boolean {
  const anchorDay = dayStartOf(anchor)
  if (dayStart < anchorDay) return false
  if (repeat.until != null && dayStart > repeat.until) return false
  const interval = Math.max(1, repeat.interval ?? 1)
  const daysSince = Math.round((dayStart - anchorDay) / DAY_MS)
  switch (repeat.freq) {
    case "daily":
      return daysSince % interval === 0
    case "weekly": {
      const wd = new Date(dayStart).getDay()
      const allowed = repeat.byWeekday ?? [new Date(anchor).getDay()]
      if (!allowed.includes(wd)) return false
      return Math.floor(daysSince / 7) % interval === 0
    }
    case "monthly": {
      const a = new Date(anchor)
      const d = new Date(dayStart)
      if (a.getDate() !== d.getDate()) return false
      const months = (d.getFullYear() - a.getFullYear()) * 12 + (d.getMonth() - a.getMonth())
      return months >= 0 && months % interval === 0
    }
    case "yearly": {
      const a = new Date(anchor)
      const d = new Date(dayStart)
      return (
        d.getMonth() === a.getMonth() &&
        d.getDate() === a.getDate() &&
        (d.getFullYear() - a.getFullYear()) % interval === 0
      )
    }
  }
}

/**
 * Project a schedule's `timeblocks` (D4 multi-timeblock days, stored as absolute times on
 * the anchor day) onto `dayStart`, preserving each timeblock's wall-clock start-of-day
 * (DST-safe via setHours) and its duration. Returns timeblocks sorted by start. Used by
 * both the expander (virtual occurrences) and materializeOccurrence (overrides) so a
 * "Day Job 8–11:30 AND 13:30–18:00" rule lands those two spans on every matching day.
 */
function shiftTimeblocksToDay(
  timeblocks: { startAt: number; endAt: number }[],
  dayStart: number,
): { startAt: number; endAt: number }[] {
  return timeblocks
    .map((b) => {
      const bs = new Date(b.startAt)
      const start = new Date(dayStart)
      start.setHours(bs.getHours(), bs.getMinutes(), bs.getSeconds(), 0)
      const startAt = start.getTime()
      return { startAt, endAt: startAt + (b.endAt - b.startAt) }
    })
    .sort((a, b) => a.startAt - b.startAt)
}

/**
 * Timed entities for a space's subtree, EXPANDED into concrete occurrences
 * within [rangeStart, rangeEnd]. One-offs pass through unchanged; recurring
 * schedules emit one occurrence per matching local day, preserving the anchor's
 * wall-clock time-of-day (DST-safe, via setHours). Drives the timeline.
 */
export function getTimelineOccurrences(
  contextId: string,
  rangeStart: number,
  rangeEnd: number,
): TimelineOccurrence[] {
  const out: TimelineOccurrence[] = []
  for (const e of getTimedDescendants(contextId)) {
    const s = e.schedule
    if (!s) continue

    // NON-PRIMARY PLANNED OCCURRENCES — the other spans besides the current (scalar) primary. They
    // paint as FIXED top-rail ticks (their own start/end schedule), independent of the current live
    // state and independent of the live anchor below. Non-recurring only.
    if (s.plannedOccurrences && s.plannedOccurrences.length > 0) {
      s.plannedOccurrences.forEach((occ, i) => {
        out.push({
          ...e,
          schedule: {
            ...s,
            startDate: occ.start,
            endDate: occ.end,
            plannedOccurrences: undefined,
            repeat: undefined,
          },
          occKey: `${e.id}#occ${i}`,
        })
      })
    }

    // A point (`at`), a span start, or — for a due-only entity like a Task deadline —
    // the `dueDate` all serve as the timeline anchor, so a task with just a due date still
    // places a marker.
    // "whenever" is not a fixed time, so it can't anchor a timeline occurrence.
    const anchor = s.at ?? (isPlannedStart(s.startDate) ? s.startDate : undefined) ?? s.dueDate
    if (anchor == null) continue

    if (!s.repeat) {
      // One-off: pass through (the timeline clips to the viewport itself).
      out.push({ ...e, occKey: e.id })
      continue
    }

    const duration = isPlannedStart(s.startDate) && s.endDate != null ? s.endDate - s.startDate : 0
    const anchorDate = new Date(anchor)
    // Walk each local day in range; emit an occurrence on matching days. Using a
    // Date stepper (setDate) keeps midnights correct across DST boundaries.
    const cursor = new Date(rangeStart)
    cursor.setHours(0, 0, 0, 0)
    while (cursor.getTime() <= rangeEnd) {
      const dayStart = cursor.getTime()
      if (dayMatchesRecurrence(dayStart, anchor, s.repeat)) {
        // MATERIALIZE-ON-TOUCH: if the user has touched this day, emit the real
        // override entity (its own id, its own schedule/completion/subtasks) instead
        // of the virtual occurrence — and emit NOTHING if they cancelled the day.
        const override = occurrenceOverride(e.id, dayStart)
        if (override) {
          if (!override.cancelled) out.push({ ...override, occKey: `${e.id}@${dayStart}` })
        } else {
          const occDate = new Date(dayStart)
          occDate.setHours(anchorDate.getHours(), anchorDate.getMinutes(), anchorDate.getSeconds(), 0)
          const occStart = occDate.getTime()
          let schedule: Schedule
          if (s.timeblocks && s.timeblocks.length > 0) {
            // Multi-timeblock day (D4): project every span onto this day; mirror
            // startAt/endAt to the first start / last end so single-span readers
            // (bounds, sorting) keep working without knowing about timeblocks.
            const timeblocks = shiftTimeblocksToDay(s.timeblocks, dayStart)
            schedule = { ...s, timeblocks, startDate: timeblocks[0].startAt, endDate: timeblocks[timeblocks.length - 1].endAt }
          } else if (s.at != null) {
            schedule = { ...s, at: occStart }
          } else {
            schedule = { ...s, startDate: occStart, endDate: occStart + duration }
          }
          out.push({ ...e, schedule, occKey: `${e.id}@${dayStart}` })
        }
      }
      cursor.setDate(cursor.getDate() + 1)
    }
  }
  return out
}

/**
 * DAYLINE occurrences (v0.2.249) — the TOP-rail data source, sourced from the SAME `projectOccurrences`
 * engine the §0 block uses (NOT the legacy `getTimelineOccurrences` walker). This is what finally makes
 * additional `series[]` (.246), edited-instance times via `exceptions[].start/end` (.248), and the
 * `repeatAnchor` decoupling (.247) show correctly on the dayline — the old walker was blind to all three.
 *
 * Walks the whole tree; for each timed entity projects its occurrences windowed to [lo, hi] (past-capable),
 * skips cancelled ones (they're struck in §0; a ghost tick on the dayline would just be noise), and
 * synthesizes a single-instance `TimelineOccurrence` per record so the existing dayline geometry
 * (ongoing / closed / point / sleep-sky / fades) keeps working unchanged. Each carries `occRef` so a
 * top-tick right-click can open the per-occurrence menu.
 */
export function getDaylineOccurrences(lo: number, hi: number, now: number = Date.now()): TimelineOccurrence[] {
  const out: TimelineOccurrence[] = []
  for (const e of getTimedDescendants(ROOT_ID)) {
    const s = e.schedule
    if (!s) continue
    for (const rec of projectOccurrences({ id: e.id, schedule: s }, now, 10, { from: lo, until: hi })) {
      if (rec.cancelled) continue
      // Clip to the window (definite scalar/plannedOccurrences aren't window-bounded by the projector).
      if (rec.start > hi || (rec.end ?? rec.start) < lo) continue
      // Single-instance schedule: strip the recurrence machinery and pin this instance's own start/end so
      // the memo reads a plain one-off. Preserve a point (`at`) instance as a point.
      const instSchedule: Schedule = {
        ...s,
        repeat: undefined,
        series: undefined,
        plannedOccurrences: undefined,
        exceptions: undefined,
        startDate: rec.start,
        endDate: rec.end,
        at: s.at != null ? rec.start : undefined,
      }
      const occKey =
        rec.origin === "rule"
          ? `${e.id}@${rec.recurrenceId}${rec.ruleId ? `~${rec.ruleId}` : ""}`
          : `${e.id}#occ${rec.occIndex}`
      out.push({
        ...e,
        schedule: instSchedule,
        occKey,
        occRef: {
          origin: rec.origin,
          occIndex: rec.occIndex,
          recurrenceId: rec.recurrenceId,
          ruleId: rec.ruleId,
          cancellable: (rec.end ?? rec.start) >= now,
        },
      })
    }

    // END-ONLY occurrence (v0.2.249) — a non-recurring entity with a declared END but NO concrete start
    // (and no `at` point, no definite one-off slots). `projectOccurrences` emits NOTHING for it (its
    // definite branch requires `isPlannedStart(startDate)`), so synthesize a start-LESS occurrence here.
    // The dayline memo anchors it at its end and paints a LEFTWARD fade — the mirror of an open-ended
    // start's right fade — and §0 already renders it as "unset – <end>". Due-only tasks (a `dueDate` with
    // NO `endDate`) are intentionally excluded: they stay points, per decision.
    const hasRule = !!s.repeat || !!(s.series && s.series.length)
    const startless =
      !hasRule &&
      s.endDate != null &&
      !isPlannedStart(s.startDate) &&
      s.at == null &&
      (s.plannedOccurrences == null || s.plannedOccurrences.length === 0)
    if (startless && s.endDate! >= lo && s.endDate! <= hi) {
      out.push({
        ...e,
        // Pure end-only schedule: strip every anchor EXCEPT the end so the memo takes the unknown-start
        // path (st == null, endNum set).
        schedule: {
          ...s,
          repeat: undefined,
          series: undefined,
          plannedOccurrences: undefined,
          exceptions: undefined,
          startDate: undefined,
          at: undefined,
          dueDate: undefined,
          endDate: s.endDate,
        },
        occKey: `${e.id}#endonly`,
        occRef: { origin: "definite", occIndex: -1, cancellable: s.endDate! >= now },
      })
    }
  }
  return out
}

/** Assets anywhere in a context's subtree. */
export function getSubtreeAssets(contextId: string): Asset[] {
  if (contextId === ROOT_ID) return assets
  const descendants = collectDescendants(contextId)
  return assets.filter((a) => descendants.has(a.contextId))
}

/**
 * A "context item" wrapper around an Entity. The `task` / `moment` / `space`
 * fields are convenience aliases that all point to the SAME underlying entity
 * (populated based on `kind`), so kind-specific readers continue to work.
 */
export interface ContextItem {
  id: string
  kind: EntityKind
  title: string
  entity: Entity
  task?: Entity
  moment?: Entity
  space?: Entity
}

function toContextItem(e: Entity): ContextItem {
  return {
    id: e.id,
    kind: e.kind,
    title: e.title,
    entity: e,
    task: e.kind === "task" ? e : undefined,
    moment: e.kind === "moment" ? e : undefined,
    space: e.kind === "space" ? e : undefined,
  }
}

/** Direct children of a context as ContextItems (spaces, tasks, moments). */
export function getContextItems(contextId: string): ContextItem[] {
  return getChildren(contextId).map(toContextItem)
}

/** Resolve any entity id to its ContextItem. */
export function resolveContextItem(id: string): ContextItem | undefined {
  const e = byId.get(id)
  return e ? toContextItem(e) : undefined
}

// ----------------------------------------------------------------------------
// Pins — per-context promotion of an item into the SPACES row. Pinning is
// scoped to the context it was pinned from (a `contextId` → item ids map), so
// the same item can be pinned in one space without affecting others. A pinned
// item is shown in the SPACES row and hidden from that context's task list.
// ----------------------------------------------------------------------------

const pinnedByContext: Record<string, string[]> = {}

// Seed: every existing SPACE is pinned into its parent context's dock, so the
// whole space hierarchy reads as first-class "places" in the SPACES row from
// the start. The root (parentId === null) has no parent dock to sit in.
// User pins restored from storage are merged on top of this in hydrate.
// (Root canvas ships a fresh identity-only tree, so this loop pins nothing until
// the user creates spaces — but it stays correct as the tree grows.)
for (const e of entities) {
  if (e.kind !== "space" || e.parentId === null) continue
  const arr = pinnedByContext[e.parentId] ?? (pinnedByContext[e.parentId] = [])
  arr.push(e.id)
}

export function getPinnedIds(contextId: string): string[] {
  return pinnedByContext[contextId] ?? []
}

export function isPinned(contextId: string, itemId: string): boolean {
  return (pinnedByContext[contextId] ?? []).includes(itemId)
}

/** ContextItems pinned within a context, resolved and in pin order. */
export function getPinnedItems(contextId: string): ContextItem[] {
  return getPinnedIds(contextId)
    .map((id) => resolveContextItem(id))
    .filter(Boolean) as ContextItem[]
}

export function pinItem(contextId: string, itemId: string): void {
  const arr = pinnedByContext[contextId] ?? (pinnedByContext[contextId] = [])
  if (!arr.includes(itemId)) arr.push(itemId)
  persist()
}

export function unpinItem(contextId: string, itemId: string): void {
  const arr = pinnedByContext[contextId]
  if (!arr) return
  const i = arr.indexOf(itemId)
  if (i >= 0) arr.splice(i, 1)
  if (arr.length === 0) delete pinnedByContext[contextId]
  persist()
}

/**
 * Persist a new dock order for a context. `orderedIds` is the full arranged pin
 * sequence from a drag-and-drop reorder; only ids that are actually pinned in this
 * context are kept (any that aren't are dropped, and any currently-pinned id missing
 * from the list is appended so nothing silently disappears). Idempotent.
 */
export function reorderPins(contextId: string, orderedIds: string[]): void {
  const current = pinnedByContext[contextId]
  if (!current || current.length === 0) return
  const set = new Set(current)
  const next = orderedIds.filter((id) => set.has(id))
  for (const id of current) if (!next.includes(id)) next.push(id)
  pinnedByContext[contextId] = next
  persist()
}

// ----------------------------------------------------------------------------
// STARTER PINS — the curated GLOBAL list behind the §4 PINNED frame. Distinct
// from `pinnedByContext` (the per-context Space dock): this is ONE flat, ordered
// list of entity ids the user chose to keep at hand as "starters". Clicking a
// starter drills into it (which, if it's a Task, punches in a focus session via the
// nav layer — see the Sessions block below). Restored from storage; persisted on toggle.
// ----------------------------------------------------------------------------

let starterPins: string[] = []

/** True if this entity is currently pinned as a starter. */
export function isStarterPinned(id: string): boolean {
  return starterPins.includes(id)
}

/** The pinned starter entities, resolved and in pin order (unresolvable ids dropped). */
export function getStarterPinnedEntities(): Entity[] {
  return starterPins.map((id) => byId.get(id)).filter(Boolean) as Entity[]
}

/**
 * Every entity that is OWN-ongoing right now (see `isOwnOngoing`) — the GLOBAL set the §4
 * PINS band lists, regardless of where the entity lives in the tree. Iterates ALL entities
 * rather than `collectDescendants` (which walks Space containment ONLY and so would MISS an
 * ongoing Moment / Task / any non-Space leaf — the bug that hid an ongoing Moment from §4).
 * Excludes the structural Soul and materialized recurrence occurrences, matching what is
 * ever surfaced as browsable content elsewhere.
 */
  export function getOwnOngoingEntities(now: number = Date.now()): Entity[] {
  return entities.filter((e) => e.kind !== "soul" && e.seriesId == null && isOwnOngoing(e, now))
  }

  /** How long a just-marked INSTANT lingers in the §4 band as a full chip (ms). After this
   *  window its chip fades away entirely (an instant is never ongoing, so it doesn't belong in
   *  the band beyond this brief "just happened" acknowledgement). See {@link getRecentlyMarkedInstants}. */
  export const RECENT_MARK_MS = 30_000

  /**
   * INSTANTS marked within the last {@link RECENT_MARK_MS} — the transient "just happened" set the
   * §4 band shows AS WELL AS the ongoing entities. Each carries the timestamp of its MOST RECENT
   * mark (`markedAt`) so the chip can render "Ns ago". Newest mark first. An instant with no mark
   * in the window is absent (its chip has already faded). Bounded scan over all entities (tiny).
   */
  export function getRecentlyMarkedInstants(now: number = Date.now()): { entity: Entity; markedAt: number }[] {
  const out: { entity: Entity; markedAt: number }[] = []
  for (const e of entities) {
  if (e.kind !== "instant" || e.seriesId != null) continue
  const marks = getMarks(e) // newest-first
  const last = marks[0]?.startedAt
  if (last != null && now - last <= RECENT_MARK_MS) out.push({ entity: e, markedAt: last })
  }
  return out.sort((a, b) => b.markedAt - a.markedAt)
  }

  /** How long ANY entity that just STOPPED being ongoing lingers in the §4 band as a
   *  NOTIFICATION chip (ms) before it fades away. Shorter than an instant's mark window
   *  ({@link RECENT_MARK_MS}) — a stopped session is a quicker acknowledgement than a logged
   *  occurrence. See {@link getRecentlyEndedEntities}. */
  export const NOTIFY_LINGER_MS = 10_000

  /**
   * Entities that RECENTLY STOPPED being ongoing — their most recent session closed within
   * the last {@link NOTIFY_LINGER_MS} AND they are not ongoing now. These become transient §4
   * NOTIFICATION chips (the universal "it just stopped, here's a moment to notice" band), the
   * general-kind analogue of {@link getRecentlyMarkedInstants}. INSTANTS are excluded (they use
   * the mark path). Each carries `endedAt` (the close time) AND `lastMs` — the FROZEN length of
   * the session that just closed (its `endAt − startAt`), so the chip can show a stable final
   * duration that never re-derives (and never flickers to 0). Newest first. Bounded scan over all
   * entities (tiny).
   */
  export function getRecentlyEndedEntities(now: number = Date.now()): { entity: Entity; endedAt: number; lastMs: number }[] {
  const out: { entity: Entity; endedAt: number; lastMs: number }[] = []
  for (const e of entities) {
  if (e.kind === "soul" || e.kind === "instant" || e.seriesId != null) continue
  if (isOwnOngoing(e, now)) continue // still ongoing ⇒ the ongoing list owns it
  // The most recent CLOSED session — its end is the moment it last stopped, its span is the
  // final session length we freeze onto the chip.
  let endedAt: number | undefined
  let lastMs = 0
  for (const se of getSessions(e)) {
  if (se.endedAt != null && (endedAt == null || se.endedAt > endedAt)) {
  endedAt = se.endedAt
  lastMs = Math.max(0, se.endedAt - se.startedAt)
  }
  }
  if (endedAt != null && now - endedAt <= NOTIFY_LINGER_MS) out.push({ entity: e, endedAt, lastMs })
  }
  return out.sort((a, b) => b.endedAt - a.endedAt)
  }

/** Toggle an entity's starter-pin membership. Returns the new pinned state. */
export function toggleStarterPin(id: string): boolean {
  const i = starterPins.indexOf(id)
  if (i >= 0) {
    starterPins.splice(i, 1)
    persist()
    return false
  }
  starterPins.push(id)
  persist()
  return true
}

// ----------------------------------------------------------------------------
// SESSIONS — tracked work punch-ins/outs, stored as a PAIRS ARRAY on the entity
// (`schedule.sessions`; see types.ts). The last entry lacking `endAt` is the ONE
// open session, and that alone is what makes getState read the entity `ongoing`
// EVERYWHERE it appears. Two writers open sessions: FOCUS (drilling into a Task past
// a dwell threshold — see zero0-canvas) and PLAY (the glyph on a "whenever"
// moment/space). Deliberately NOT mirrored into scalar startAt/endAt: sessions are a
// tracking layer OVER the declared schedule; mirroring would clobber the "whenever"
// sentinel and trip a moment's midnight auto-close. Pure reads (getSessions/
// getOpenSession/hasOpenSession) live in kinds.ts; the WRITES are here.
// ----------------------------------------------------------------------------

/**
 * Sessions this short (ms) are treated as pass-through NOISE and DROPPED on close, so
 * transiting A→B→C to reach C leaves no trace on A/B. The nav layer also gates opening
 * behind a longer dwell; this floor additionally guards play/programmatic closes.
 */
export const MIN_SESSION_MS = 1500

/**
 * Reload grace (ms) for the hydrate liveness check: if the app was known-alive within this window
 * of the new load, a dangling focus session is treated as CONTINUOUS across a reload/deploy and
 * left running (rather than closed as a shutdown). A reload re-hydrates in seconds, so 60s is a
 * comfortable margin. [OPEN ITEM #4 — Loris to tune while dogfooding.]
 */
export const ALIVE_GRACE_MS = 60_000

/** Persist a session mutation, mirroring setEntityScheduleField's seeded-override path. */
function persistSessionMutation(id: string, entity: LooseEntity, sched: Schedule): void {
  entity.schedule = sched
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), schedule: sched })
  }
  persist()
}

/**
 * THE derive step: recompute `schedule.sessions` PURELY from the entity's log and persist it.
 * sessions[] is now a MATERIALIZED CACHE (Loris' hybrid: log = truth, sessions[] = derived view,
 * refreshed after EVERY log append). Every session writer below ends by calling this, so there is
 * ONE place the fold rules (flavored single-ongoing, discard-short, terminal-closes-ongoing) live.
 */
function recomputeSessionsFromLog(id: string, entity: LooseEntity): void {
  const sched: Schedule = { ...(entity.schedule ?? {}) }
  sched.sessions = deriveSessionsFromLog(entity as unknown as Entity, {
    minSessionMs: MIN_SESSION_MS,
    ongoingOnEnter: ONGOING_ON_ENTER.has((entity as unknown as Entity).kind),
  })
  persistSessionMutation(id, entity, sched)
}

/**
 * OPEN a session (LOG-FIRST): append the right verb, then re-derive sessions[]. `via` "focus" is
 * ACCESS (⇒ `accessed`); "play" is a PLAYED span. An AUTO play (opts.auto) writes NO
 * log entry — the auto ongoing span is DERIVED from `accessed` by {@link deriveSessionsFromLog}, so
 * logging it would double-log on entry (the thing Loris killed). A MANUAL/remote play ⇒ `started`.
 * Idempotent per rail (no-op if that rail is already open). Returns true if a session is now open.
 */
export function openSession(
  id: string,
  via: Session["via"] = "focus",
  at = Date.now(),
  opts?: { auto?: boolean },
): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  if (hasOpenSession(stored, via)) return true // this rail already running — no-op (focus + play concurrent)
  const entity = mutable(stored)
  // focus ⇒ accessed; MANUAL play ⇒ started; AUTO play ⇒ nothing (derived from accessed).
  const type: LogType | null = via === "focus" ? "accessed" : opts?.auto ? null : "started"
  if (type) entity.log = appendInstant(ensureEntityLog(entity), makeInstant(type, at))
  recomputeSessionsFromLog(id, entity)
  // Report whether the intended rail actually ended up open (an auto play with no prior `accessed`
  // derives nothing — callers treat that as "not opened").
  return hasOpenSession(byId.get(id)!, via)
}

/**
 * CLOSE the open session on an entity (LOG-FIRST): append the right verb, then re-derive.
 *   - focus ⇒ `exited`.
 *   - play  ⇒ `stopped` (v0.2.257 start/stop-only: ALWAYS, auto OR remote). The fold's `stopped`
 *     now closes whichever play span is open, so an explicit Stop can end a session you started by
 *     ENTERING — without leaving (the focus/access session keeps running). Previously an auto play
 *     wrote NOTHING here and the fold re-derived it as open (the "chip won't stop in place" bug).
 * NB on EXIT the focus close writes `exited` first, which already closes the auto play in the fold,
 * so the subsequent play close finds nothing open and emits no redundant `stopped`. Discard-short is
 * applied by the fold. No-op if nothing is open on that rail. Returns true if a session was closed.
 */
export function closeSession(id: string, via?: Session["via"], at = Date.now()): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  const open = getOpenSession(stored, via)
  if (!open) return false
  const entity = mutable(stored)
  const type: LogType = open.via === "focus" ? "exited" : "stopped"
  entity.log = appendInstant(ensureEntityLog(entity), makeInstant(type, at))
  recomputeSessionsFromLog(id, entity)
  return true
}

/**
 * RE-OPEN an AUTO ongoing after a device-idle cap (v0.2.311). The runtime away-watchdog caps the
 * auto play with a `stopped` at last-known-alive but LEAVES the focus/access span OPEN (access is
 * continuous while Zero is open — v0.2.306). That's the problem for resume: an auto play is DERIVED
 * from an `accessed`, and since focus never closed there is no new `accessed` to re-derive it, while
 * the post-cap `stopped` keeps it closed. `openSession(…,{auto})` can't help — it writes nothing and
 * relies on that missing `accessed`. So we append a `resumed`, which the fold interprets as "re-open
 * the auto ongoing" WITHOUT splitting the continuous focus span (unlike a fresh `accessed`). No-op if
 * a play is already open (e.g. a manual stopwatch) or the entity is blocked (done/closed ⇒ the fold's
 * `resumed` won't open). Returns true iff a play span is open afterwards.
 */
export function reopenAutoPlay(id: string, at = Date.now()): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  if (hasOpenSession(stored, "play")) return true // already running — no-op
  const entity = mutable(stored)
  entity.log = appendInstant(ensureEntityLog(entity), makeInstant("resumed", at))
  recomputeSessionsFromLog(id, entity)
  return hasOpenSession(byId.get(id)!, "play")
}

/**
 * ADD A MANUAL RECORDED SESSION (LOG-FIRST, v0.2.269) — the past/ongoing-session half of the Plan
 * dialog. Appends ONE self-describing `session` log entry carrying its own `{sessionStart, sessionEnd}`
 * (see {@link Instant}), then re-derives `sessions[]`. Because {@link deriveSessionsFromLog} reads the
 * span from the entry's payload (not from walk position), this works for ANY past window and does NOT
 * touch the single play/stop "open" slot — so it can coexist with a live ongoing session.
 *
 *   - `end` given      ⇒ a CLOSED recorded session [start, end].
 *   - `end` omitted/null ⇒ a still-ONGOING recorded session that STARTED at `start` (no `endedAt`).
 *
 * `start` is clamped to `≤ now`; when `end` is given it's clamped to `≥ start` (a zero/negative span
 * collapses to a mark-like point, harmless). The append is truth-based: it records that the user
 * declared this session happened. Returns true on success.
 */
export function addManualSession(id: string, start: number, end?: number | null, now = Date.now()): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  const entity = mutable(stored)
  const s = Math.min(start, now)
  const entry: Instant = { at: now, type: "session", sessionStart: s }
  if (end != null) entry.sessionEnd = Math.max(end, s)
  entity.log = appendInstant(ensureEntityLog(entity), entry)
  recomputeSessionsFromLog(id, entity)
  return true
}

/**
 * EDIT A RECORDED SESSION'S TIME (LOG-FIRST, append-only, v0.2.293) — the past/recorded counterpart of
 * "+ Edit time" for planned occurrences. `anchorId` is the id of the log entry that OPENED the target
 * session (its {@link Session.anchorId}). Rather than mutating that boundary entry, this appends ONE
 * `session-edit` overlay carrying the corrected `{sessionStart, sessionEnd}` keyed by `targetId`; the
 * fold ({@link deriveSessionsFromLog}) applies it as a post-pass. Only RECORDED (`via:"play"`) sessions
 * are targetable — the access spine (`via:"focus"`) is display-only — and the fold's overlay scope is
 * likewise limited to play, so an `accessed` anchor's edit resolves uniquely to its play session.
 *
 *   - `start`          ⇒ new punch-in.
 *   - `end` number     ⇒ new close (CLOSED session). The UI always sends a numeric end (past sessions
 *                        being edited are closed), so a still-ongoing session is not re-timed here.
 *
 * `start` is clamped to `≤ now`; `end` is clamped to `≥ start`. No-op (returns false) if `anchorId`
 * doesn't resolve to an editable recorded session on the entity. Returns true on success.
 */
export function editSession(
  id: string,
  anchorId: number,
  start: number,
  end: number,
  now = Date.now(),
): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  // Guard: the anchor must currently resolve to a RECORDED session on this entity. Prevents an edit
  // targeting an access span or a stale/absent anchor from silently appending a dead overlay.
  const target = (stored.schedule?.sessions ?? []).find((s) => s.via === "play" && s.anchorId === anchorId)
  if (!target) return false
  const entity = mutable(stored)
  const s = Math.min(start, now)
  const e = Math.max(end, s)
  const entry: Instant = { at: now, type: "session-edit", targetId: anchorId, sessionStart: s, sessionEnd: e }
  entity.log = appendInstant(ensureEntityLog(entity), entry)
  recomputeSessionsFromLog(id, entity)
  return true
}

/**
 * DELETE A RECORDED SESSION (LOG-FIRST, append-only, v0.2.293) — appends a `session-delete` TOMBSTONE
 * keyed by the target's `anchorId`; the fold drops the matching `via:"play"` session on re-derive. The
 * originating boundary entries stay in the log (append-only), so history retraces both the session and
 * its removal. No-op (returns false) if the anchor doesn't resolve to a recorded session. Returns true.
 */
export function deleteSession(id: string, anchorId: number, now = Date.now()): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  const target = (stored.schedule?.sessions ?? []).find((s) => s.via === "play" && s.anchorId === anchorId)
  if (!target) return false
  const entity = mutable(stored)
  entity.log = appendInstant(ensureEntityLog(entity), { at: now, type: "session-delete", targetId: anchorId })
  recomputeSessionsFromLog(id, entity)
  return true
}

// v0.2.257 — pauseOngoing / resumeOngoing were RETIRED with the start/stop-only session model.
// The glyph is now a plain Play/Stop toggle: STOP = closeSession("play") (writes `stopped`, which the
// fold closes for any flavor even in-place), START = openSession("play"). Old logs' `paused`/`resumed`
// entries are still READ by the fold (deriveSessionsFromLog) for back-compat, but never written again.

/**
 * Backdate/adjust the START of an entity's OPEN session — the running session's punch-in
 * moment. This is what `--start:<time>` targets when the entity is ONGOING: rather than moving
 * the declared schedule anchor, it corrects WHEN the current session actually began (e.g.
 * `--start:5min ago` on a running stopwatch). Clamped to `≤ now` (a live session can't start in
 * the future) and, when a previous session exists, to `> that session's end` (no overlap).
 * Logs an `sessionStart = <time>` set. No-op if nothing is open. Returns true if it moved.
 */
export function setOpenSessionStart(id: string, at: number, now = Date.now()): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  // v0.6.32: `--start` on an ONGOING entity adjusts the PLAY (ongoing) session — that's the one
  // whose start "when did this begin" means. Fall back to any open session for non-play kinds.
  const open = getOpenSession(stored, "play") ?? getOpenSession(stored)
  if (!open) return false
  const entity = mutable(stored)
  const sched: Schedule = { ...(entity.schedule ?? {}) }
  const all = [...(sched.sessions ?? [])]
  let start = Math.min(at, now) // a live session can't have started in the future

  // SWALLOW the sessions covered by the new [start, now] span into the ONE extended open
  // session (Loris' model): backdating to 7:00 PM turns a fragmented dwell history into a
  // single honest session, rather than clamping forward past the last punch-out. A closed
  // session lying at/after `start` is CONSUMED (dropped); one that STRADDLES `start` (began
  // earlier) is MERGED by pulling `start` back to its own start so its earlier portion isn't
  // lost. Sessions entirely before the span, and instant marks, are left untouched. Sessions
  // are non-overlapping + ordered, so a later straddler can't invalidate an earlier keep.
  const kept: Session[] = []
  for (const e of all) {
    if (e === open) continue // re-appended (last) with the new start
    // v0.6.32: only sessions of the SAME rail (`via`) are swallowed/merged. A concurrent session on
  // another rail (e.g. the open `focus` access session while we backdate `play`) is left intact —
  // otherwise backdating ongoing would silently eat your access session.
    if (e.via !== open.via) {
      kept.push(e)
      continue
    }
    if (e.via === "mark") {
      kept.push(e)
      continue
    }
    const eEnd = e.endedAt ?? e.startedAt
    if (eEnd < start) {
      kept.push(e) // entirely before the new span — untouched
      continue
    }
    if (e.startedAt < start) start = e.startedAt // straddles → extend the span back to cover it
    // else: fully inside [start, now] ⇒ swallowed (not kept)
  }
  kept.push({ ...open, startedAt: start })
  sched.sessions = kept
  logSet(entity, "sessionStart", start)
  persistSessionMutation(id, entity, sched)
  return true
}

/**
 * END whatever makes an entity OWN-ongoing (see `isOwnOngoing`) — the one action behind
 * the §4 PINS glyph. Precedence:
 *   - an OPEN SESSION (focus/play) ⇒ close it (`closeSession`), OR
 *   - a running CONCRETE span (Moment/Space started, no end yet) ⇒ stamp `endAt = now`
 *     so the span closes right here.
 * Returns true if it ended something. A rollup-only container (spinning only because a
 * descendant runs) is NOT own-ongoing, so this is a no-op on it — you end its child instead.
 */
export function endOngoing(id: string, at = Date.now()): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  // Close the STATE-RELEVANT open session = the PLAY session (v0.6.32: ongoing is play-only, so
  // this is simply "stop the ongoing stopwatch"). A `focus` (access) session is deliberately
  // left running — ending an entity's ongoing shouldn't kick you out of viewing it (ACCESS keeps
  // ticking). The old moment/instant focus special-case is gone: focus never flips state now.
  if (getOpenSession(stored, "play")) {
    return closeSession(id, "play", at)
  }
  if ((stored.kind === "moment" || stored.kind === "space") && isOwnOngoing(stored, at)) {
    // Running concrete span with no known end → cap it at now via the schedule field setter
    // (which also stamps closeAt / logs the set), matching a manual `--end:now`.
    if (effectiveScheduleEnd(stored.schedule) == null) {
      return setEntityScheduleField(id, "endDate", at)
    }
  }
  return false
}

/**
 * MARK an occurrence on an INSTANT — append a ZERO-LENGTH session (`endAt === startAt`,
 * via `"mark"`) to `schedule.sessions`, i.e. a single timestamp in a growing tally. Unlike
 * open/close this is a ONE-SHOT append, so it deliberately BYPASSES the MIN_SESSION_MS
 * discard-short floor (a mark is meant to be zero-length; it must never be dropped). No-op on
 * a non-instant. Returns true if a mark was recorded. Each mark also surfaces as a point on
 * the dayline's recorded rail (see zero0-dayline: `point: en <= st`, marks kept un-coalesced).
 */
export function markInstant(id: string, at = Date.now()): boolean {
  const stored = byId.get(id)
  if (!stored || stored.kind !== "instant") return false
  // Respect a HARD maxNb cap: once complete, a hard-capped instant accepts no more marks.
  if (!isMarkable(stored, at)) return false
  const entity = mutable(stored)
  const log = ensureEntityLog(entity)
  // LOG-FIRST (like the session writers): append the `mark`, then re-derive sessions[]. The fold
  // rebuilds it as a zero-length (endAt===startAt) session via "mark"; discard-short never touches a
  // mark (it's meant to be zero-length). sessions[] is now a pure projection of the log.
  entity.log = appendInstant(log, makeInstant("mark", at))
  // Like a Moment, an instant files at the next local midnight — anchored on this latest
  // occurrence (unless --close:manual). Stamped so every viewer flips at the same instant.
  entity.closeAt = computeCloseAt(entity, at)
  recomputeSessionsFromLog(id, entity)
  // ONE-SHOT PULSE: the instant fired, so it AND every task ancestor spin their glyph once,
  // together — the parent task (and its task ancestors) acknowledge the mark at the same beat.
  pulseGlyphs([id, ...taskAncestorIds(id)])
  return true
  }

/**
 * Set an INSTANT's max authorized OCCURRENCES (`--maxnb:3`) and whether that cap is HARD
 * (`--maxnbhard` ⇒ no marks past complete). `maxNb <= 1` clears back to the default (a unique
 * occurrence); `hard === false` clears the hard flag. Re-stamps `closeAt` since the occurrence
 * requirement can change whether/when it completes. Instants only.
 */
export function setInstantMax(id: string, maxNb: number, hard: boolean): boolean {
  const stored = byId.get(id)
  if (!stored || stored.kind !== "instant") return false
  const entity = mutable(stored)
  const sched: Schedule = { ...(entity.schedule ?? {}) }
  if (maxNb <= 1) delete sched.maxNb
  else sched.maxNb = Math.floor(maxNb)
  if (hard) sched.maxNbHard = true
  else delete sched.maxNbHard
  entity.schedule = sched
  logSet(entity, "maxNb", sched.maxNb ?? 1)
  entity.closeAt = computeCloseAt(entity)
  persistSessionMutation(id, entity, sched)
  return true
}

/** Toggle the open/closed state of an entity's session (Play ⇄ Stop). Returns the new
 *  open state. Used by the glyph play/pause on a "whenever" moment/space. */
export function toggleSession(id: string, via: Session["via"] = "play"): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  // v0.6.32: toggle THIS rail specifically — a running `play` stops without touching an open
  // `focus`, and vice versa. (Was: any open session, which conflated the two now-concurrent rails.)
  if (hasOpenSession(stored, via)) {
    closeSession(id, via)
    return false
  }
  openSession(id, via)
  return true
}

// ----------------------------------------------------------------------------
// OCCURRENCES — the top-rail lifecycle of a Moment / Space (v0.6.18). Distinct from
  // SESSIONS (bottom PLAYED rail = played/work time). Play STARTS an occurrence, Stop ENDS it,
// Reopen ARCHIVES the finished span into `occurrences[]` and returns the entity to open —
// preserving the span's length as the default duration for the next Play. Non-recurring only.
// ----------------------------------------------------------------------------

// LIVE occurrence LIFECYCLE (Play/Stop top-rail) is a moment/space thing — a running span you punch
// in/out of. Leave it narrow.
const isOccurrenceKind = (e: Entity) => e.kind === "moment" || e.kind === "space"

// PLANNED occurrences (the §0 block's "+ add slot" / cancel), by contrast, are meaningful on EVERY
// kind except the Soul (v0.2.238) — an instant, task, resource, etc. can all carry a schedule of
// planned points/spans. This gates the planned-occurrence WRITERS; the Soul is the one entity with no
// schedule of its own.
const canPlanOccurrences = (e: Entity) => e.kind !== "soul"

/**
 * PLAY — start an occurrence NOW (top rail). Sets `startAt = at`; if a `duration` is known
 * (e.g. preserved from a prior span), stamps `endAt = at + duration` so the span is pre-sized;
 * otherwise leaves it open-ended (ongoing until Stop). Reuses `setEntityScheduleField` so the
 * closeAt re-stamp / logging / seeded-override / persist all happen. Moment/Space only.
 */
export function startOccurrence(id: string, at = Date.now()): boolean {
  const stored = byId.get(id)
  if (!stored || !isOccurrenceKind(stored)) return false
  const dur = stored.schedule?.duration
  setEntityScheduleField(id, "startDate", at)
  setEntityScheduleField(id, "endDate", dur != null ? at + dur * 60000 : null)
  return true
}

/**
 * STOP — end the running occurrence early by stamping `endAt = at` (updates the top-rail tick
 * length). No-op if there's no concrete running start. Moment/Space only.
 */
export function endOccurrence(id: string, at = Date.now()): boolean {
  const stored = byId.get(id)
  if (!stored || !isOccurrenceKind(stored)) return false
  if (!isPlannedStart(stored.schedule?.startDate)) return false
  return setEntityScheduleField(id, "endDate", at)
}

/**
 * RESYNC THE PRIMARY (v0.2.232) — the ONE invariant enforcer behind the scalar-collapse. The model
 * everything relies on: the SCALAR `startDate`/`endDate` = the CURRENT (soonest non-cancelled)
 * occurrence, and `occurrences[]` = every OTHER occurrence (future, past, or cancelled). This keeps
 * all ~53 scalar readers, `getState`, `getScheduleCells`, the timeline expander and the duration
 * combiners working UNCHANGED (they still see "current primary + the rest, no overlap") while making
 * EVERY occurrence — the primary included — cancellable: a writer just edits the flat set and calls
 * this, which re-picks the soonest live span as the scalar primary and drops the rest into
 * `plannedOccurrences[]`. Idempotent. Only ever runs for occurrence kinds (moment/space), whose
 * primary always carries a concrete start; an end-only scalar (never produced for these kinds) is
 * left as-is.
 */
function resyncPrimary(sched: Schedule, now: number = Date.now()): void {
  // RULE-BEARING BRANCH (v0.2.247): when the entity carries ANY recurrence — the primary `repeat` OR ≥1
  // additional `series[]` — the scalar `startDate`/`endDate` MIRRORS the GLOBAL current-or-next
  // occurrence across every series + every definite one-off (was: frozen at the rule anchor). The rule
  // seed itself lives in `repeatAnchor` / each `SeriesRule.anchorStart`, so mirroring here never drifts a
  // rule. `plannedOccurrences[]` is LEFT AS-IS (it's projected directly, independent of the scalar). All
  // ~53 scalar readers therefore reflect "what's actually next" for recurring entities too.
  if (sched.repeat || (sched.series && sched.series.length)) {
    const projected = projectOccurrences({ id: "_resync", schedule: sched }, now, 60)
    const live = projected.filter((o) => !o.cancelled)
    const notPassed = live.filter((o) => (o.end ?? o.start) >= now)
    const pick = notPassed.length
      ? notPassed.sort((a, b) => a.start - b.start)[0]
      : live.sort((a, b) => b.start - a.start)[0]
    if (pick) {
      sched.startDate = pick.start
      if (pick.end != null) sched.endDate = pick.end
      else delete sched.endDate
    } else {
      delete sched.startDate
      delete sched.endDate
    }
    return
  }
  const all: { start: number; end?: number; cancelled?: boolean }[] = []
  const cs = sched.startDate
  if (typeof cs === "number") all.push({ start: cs, end: sched.endDate, cancelled: false })
  all.push(...(sched.plannedOccurrences ?? []))
  const live = all.map((o, i) => ({ o, i })).filter((x) => !x.o.cancelled)
  // CURRENT-OR-NEXT primary (v0.2.235; was "earliest live", which left the tag stuck on a stale/missed
  // past slot). Prefer the occurrence the user would call "when's this next?": among live spans that
  // have NOT fully passed (end — or start if point — still ≥ now), the soonest by start (so an ONGOING
  // span, whose start is already behind now, naturally wins over a later upcoming one). If EVERY live
  // span is in the past, fall back to the MOST-RECENT one (largest start) so the scalar still reflects
  // "the thing that just happened" rather than the oldest. Recomputed at each write; view-time freshness
  // for the block's own "next" marker is handled separately in getOccurrenceRows.
  const notPassed = live.filter((x) => (x.o.end ?? x.o.start) >= now)
  const pick = notPassed.length
    ? notPassed.sort((a, b) => a.o.start - b.o.start || a.i - b.i)[0]
    : live.sort((a, b) => b.o.start - a.o.start || a.i - b.i)[0]
  const primary = pick?.o
  if (primary) {
    sched.startDate = primary.start
    if (primary.end != null) sched.endDate = primary.end
    else delete sched.endDate
    sched.plannedOccurrences = all.filter((o) => o !== primary)
  } else {
    // Nothing live (empty, or every span cancelled) → no current primary; the entity is idle/playable.
    delete sched.startDate
    delete sched.endDate
    sched.plannedOccurrences = all
  }
  // Drop an empty array so a plan-less entity serializes clean (matches pre-collapse shape).
  if (sched.plannedOccurrences && sched.plannedOccurrences.length === 0) delete sched.plannedOccurrences
}

/**
 * CLOCK-TRIGGERED SCALAR SWEEP (v0.2.271) — the missing CLOCK trigger for {@link resyncPrimary}.
 *
 * The scalar `startDate`/`endDate` is a MIRROR of the current-or-next occurrence, but it was only
 * ever re-mirrored on a WRITE (every schedule writer calls `resyncPrimary`). So once the wall clock
 * crossed an occurrence boundary with NO intervening write, the scalar went stale — e.g. it kept
 * showing a 1:38–1:40 slot at 1:41 while §0 (which derives current-or-next at VIEW time) had already
 * rolled to the 1:49 slot. This is the long-deferred "STEP 3 / derived scalar" gap; rather than swap
 * ~53 direct scalar readers for a read-time getter (invasive, and many readers legitimately want the
 * stored anchor), we simply RE-RUN the already-correct `resyncPrimary` on a clock tick. That keeps the
 * stored-scalar model intact and makes EVERY reader (raw fields, dayline, metaEcho, …) current at once.
 *
 * Called once per second from the canvas. Cheap: a per-entity O(1) guard skips everything that can't
 * have rolled forward — an entity is a candidate ONLY when its current scalar has actually PASSED
 * (`(endDate ?? startDate) < now`) or it has no scalar but carries a rule / extra occurrence that could
 * (re)populate one. For a candidate we run `resyncPrimary` on a clone and diff start/end; unchanged ⇒
 * no mutation, no persist. `persist()` therefore fires only on a real promotion (rare), never per tick.
 * Returns true when ANY entity changed, so the caller can bump its render.
 */
export function sweepStaleScalars(now: number = Date.now()): boolean {
  let changed = false
  for (const stored of byId.values()) {
    const cur = stored.schedule
    if (!cur) continue
    const hasScalar = typeof cur.startDate === "number"
    const hasRule = !!cur.repeat || !!(cur.series && cur.series.length)
    const hasExtras = !!(cur.plannedOccurrences && cur.plannedOccurrences.length)
    // GUARD. A concrete scalar that has NOT yet passed is still the current-or-next ⇒ nothing to do.
    // Otherwise the entity can only roll forward if its scalar passed, or (no scalar) a rule/extra
    // could populate one. Everything else is skipped in O(1) — the common case every tick.
    if (hasScalar) {
      const passed = (cur.endDate ?? (cur.startDate as number)) < now
      if (!passed) continue
    } else if (!hasRule && !hasExtras) {
      continue
    }
    const sched: Schedule = { ...cur }
    const beforeStart = sched.startDate
    const beforeEnd = sched.endDate
    resyncPrimary(sched, now)
    if (sched.startDate === beforeStart && sched.endDate === beforeEnd) continue // pick unchanged
    const entity = mutable(stored)
    entity.schedule = sched
    if (!userEntityIds.has(stored.id)) {
      seededOverrides.set(stored.id, { ...seededOverrides.get(stored.id), schedule: sched })
    }
    changed = true
  }
  if (changed) persist()
  return changed
}

/**
 * CANCEL THE PRIMARY occurrence (v0.2.232) — the current (scalar) occurrence has no
 * `plannedOccurrences[]` slot to flag, so cancelling it means: record it as a struck entry in
 * `plannedOccurrences[]`, then `resyncPrimary` promotes the next soonest live span into the scalar
 * (or clears it → idle when none remain). This is what makes the PRIMARY cancellable like any other
 * slot. Moment/Space only.
 */
export function cancelPrimaryOccurrence(id: string): boolean {
  const stored = byId.get(id)
  if (!stored || !canPlanOccurrences(stored)) return false
  const sched: Schedule = { ...(stored.schedule ?? {}) }
  if (!isPlannedStart(sched.startDate)) return false // no concrete primary to cancel
  const cancelled = { start: sched.startDate, end: sched.endDate, cancelled: true }
  sched.plannedOccurrences = [...(sched.plannedOccurrences ?? []), cancelled]
  delete sched.startDate // clear the scalar so resync re-picks from the flat set
  delete sched.endDate
  resyncPrimary(sched)
  const entity = mutable(stored)
  entity.schedule = sched
  // v0.2.254: explicit occurrence-cancel log for the primary span (replaces the startDate mirror-log).
  logOccurrence(entity, `cancelled · ${fmtOccSpan(cancelled.start, cancelled.end)}`)
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), schedule: sched })
  }
  persist()
  return true
}

/**
 * CANCEL (or un-cancel) a `plannedOccurrences[]` occurrence (v0.6.30) — mark the entry as `cancelled`
 * (or clear it). `index` targets `schedule.plannedOccurrences[]`. The entry STAYS in the list as a
 * struck-out attempt. After the flag flips, `resyncPrimary` runs so an UN-cancel that is now the
 * soonest live span is promoted to the scalar primary (and a cancel never leaves a cancelled span as
 * primary). `cancelled` defaults to true. Returns false when there's no such entry.
 */
export function setOccurrenceCancelled(id: string, index: number, cancelled = true): boolean {
  const stored = byId.get(id)
  const occs = stored?.schedule?.plannedOccurrences
  if (!stored || !occs || index < 0 || index >= occs.length) return false
  const sched: Schedule = { ...(stored.schedule ?? {}) }
  const target = occs[index]
  sched.plannedOccurrences = occs.map((o, i) => (i === index ? { ...o, cancelled } : o))
  resyncPrimary(sched)
  const entity = mutable(stored)
  entity.schedule = sched
  // v0.2.254: explicit occurrence cancel/restore log for a definite slot.
  logOccurrence(entity, `${cancelled ? "cancelled" : "restored"} · ${fmtOccSpan(target.start, target.end)}`)
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), schedule: sched })
  }
  persist()
  return true
}

/**
 * ADD OCCURRENCE (v0.2.229) — the genuine WRITER for a user-added planned occurrence (the companion
 * to the §0 PLANNED OCCURRENCES block's "+ Add slot"). One path (v0.2.232): append the span to
 * `plannedOccurrences[]`, then `resyncPrimary` re-picks the soonest live span as the scalar primary.
 * `end` is optional (an open-ended / point occurrence). Available on every kind except the Soul
 * (canPlanOccurrences, v0.2.238 — was Moment/Space only). Returns false otherwise.
 */
export function addOccurrence(id: string, start: number, end?: number): boolean {
  const stored = byId.get(id)
  if (!stored || !canPlanOccurrences(stored)) return false
  const sched: Schedule = { ...(stored.schedule ?? {}) }
  // v0.2.232: one path — append the new span to the flat set, then let resyncPrimary decide whether
  // it's the soonest (⇒ becomes the scalar primary) or just another entry in plannedOccurrences[].
  // This folds the old "first slot fills the scalar / rest append" branch into the single invariant.
  sched.plannedOccurrences = [
    ...(sched.plannedOccurrences ?? []),
    { start, ...(end != null ? { end } : {}) },
  ]
  resyncPrimary(sched)
  const entity = mutable(stored)
  entity.schedule = sched
  // v0.2.254: log the ADD explicitly (every add, whether it became the primary or joined
  // plannedOccurrences[]) — replaces the old startDate mirror-log, which only fired when the add
  // changed the primary and read as noisy "startDate = …" churn.
  logOccurrence(entity, `added · ${fmtOccSpan(start, end)}`)
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), schedule: sched })
  }
  persist()
  return true
}

/** Guard against a runaway scan when a rule never yields `cap` matches within a sane horizon. */
const PROJECT_MAX_SCAN_DAYS = 366 * 10

/**
 * PRIMARY RULE ANCHOR (v0.2.247) — the seed the primary `repeat` expands from. Prefers the decoupled
 * `schedule.repeatAnchor`; falls back to the legacy scalar anchor (`at ?? plannedStart ?? dueDate`, with
 * the scalar duration) for schedules not yet normalized. Returns undefined when there's no usable seed.
 * This indirection is what lets the scalar `startDate`/`endDate` mirror NEXT without drifting the rule.
 */
function primaryRuleAnchor(s: Schedule): { start: number; end?: number } | undefined {
  if (s.repeatAnchor && typeof s.repeatAnchor.start === "number") return s.repeatAnchor
  const start = s.at ?? (isPlannedStart(s.startDate) ? s.startDate : undefined) ?? s.dueDate
  if (start == null) return undefined
  const end = isPlannedStart(s.startDate) && s.endDate != null ? s.endDate : undefined
  return { start, end }
}

/**
 * PROJECT OCCURRENCES (v0.2.234) — the view-time merge that unifies an entity's three occurrence
 * layers into a start-ordered list of lightweight {@link OccurrenceRecord}s (the primitive the §0
 * PLANNED OCCURRENCES block and the future occurrence-centric dayline both consume). Layers:
 *   - DEFINITE: the scalar primary (`startDate`/`endDate`, occIndex −1) + each `plannedOccurrences[]`
 *     slot (occIndex i). Hand-added one-offs.
 *   - RULE: the `repeat` series, expanded FRESH each call (never materialised) from the anchor across
 *     upcoming local days (capped at `cap`, DST-safe via the same day-stepper as the timeline expander),
 *     overlaying `exceptions[recurrenceId]` by local-midnight day-key (v1 uses `cancelled` only).
 * A recurring entity does NOT emit its scalar as a separate definite primary — the anchor is already
 * one rule row (avoids a double-count on the anchor day). Both `repeat` and `plannedOccurrences[]` may
 * co-exist; on a same-day collision BOTH render (definite sorts first — no auto-supersede, by decision).
 * Records carry only `entityId` + occurrence data; the row reads the entity itself for title/color.
 */
/** An optional projection WINDOW (v0.2.249). When present, rule projection walks [from, until] (may be in
    the PAST) instead of the default "next `cap` upcoming from `now`". Used by the dayline. */
export type ProjectWindow = { from?: number; until?: number }

export function projectOccurrences(
  e: { id: string; schedule?: Schedule },
  now: number,
  cap = 10,
  opts?: ProjectWindow,
): OccurrenceRecord[] {
  const s = e.schedule
  if (!s) return []
  const out: OccurrenceRecord[] = []
  // hasRule = the entity carries ANY recurrence (primary `repeat` OR ≥1 additional series). When true
  // the scalar `startDate` is a NEXT-MIRROR (v0.2.247), NOT a real definite slot, so it must NOT be
  // pushed as a definite here (it would double-count a rule/series occurrence it's already mirroring).
  const recurring = !!s.repeat
  const hasRule = recurring || !!(s.series && s.series.length)

  // DEFINITE — scalar primary, ONLY when the entity has NO rule (else the scalar is the NEXT-mirror).
  if (!hasRule && isPlannedStart(s.startDate)) {
    out.push({ entityId: e.id, start: s.startDate!, end: s.endDate, origin: "definite", cancelled: false, occIndex: -1 })
  }
  // DEFINITE — each plannedOccurrences[] slot (extra concrete one-offs; present in BOTH modes).
  ;(s.plannedOccurrences ?? []).forEach((occ, i) => {
    out.push({ entityId: e.id, start: occ.start, end: occ.end, origin: "definite", cancelled: !!occ.cancelled, occIndex: i })
  })

  // RULE — the PRIMARY `repeat` series, projected into the next `cap` upcoming occurrences from today.
  // Its anchor is `repeatAnchor` (v0.2.247; falls back to the old scalar anchor when absent) — NOT the
  // scalar, which now mirrors NEXT — and its exceptions are `schedule.exceptions`; a primary rule row
  // carries NO `ruleId` (undefined).
  if (recurring) {
    const a = primaryRuleAnchor(s)
    if (a != null) {
      const duration = a.end != null ? a.end - a.start : 0
      projectRuleInto(out, e.id, s.repeat!, a.start, duration, s.exceptions, undefined, now, cap, opts)
    }
  }

  // RULE — each ADDITIONAL series (v0.2.246). Self-anchored with its own exceptions; each rule row is
  // tagged with the series' `id` so the block can route actions to the right series.
  for (const sr of s.series ?? []) {
    const duration = sr.anchorEnd != null ? sr.anchorEnd - sr.anchorStart : 0
    projectRuleInto(out, e.id, sr.repeat, sr.anchorStart, duration, sr.exceptions, sr.id, now, cap, opts)
  }

  // Start-ordered; tie-break DEFINITE before RULE on a same-day collision (stable).
  return out.sort(
    (a, b) => a.start - b.start || (a.origin === b.origin ? 0 : a.origin === "definite" ? -1 : 1),
  )
}

/**
 * Project a SINGLE recurrence rule into `out` — the shared expander used for both the primary `repeat`
 * (v0.2.234) and each additional `series[]` entry (v0.2.246). Walks upcoming days from today, emitting a
 * rule `OccurrenceRecord` per matching day (honouring the exceptions map: `removed` days are dropped and
 * don't count toward `cap`; `cancelled` stay visible + count; `start`/`end` override the instance time),
 * up to `cap` matches. `ruleId` tags the emitted records (undefined = primary series).
 */
function projectRuleInto(
  out: OccurrenceRecord[],
  entityId: string,
  repeat: Recurrence,
  anchor: number,
  duration: number,
  exceptions: Record<number, { cancelled?: boolean; removed?: boolean; start?: number; end?: number }> | undefined,
  ruleId: string | undefined,
  now: number,
  cap: number,
  opts?: ProjectWindow,
): void {
  // WINDOW MODE (v0.2.249) — the dayline needs occurrences within an arbitrary [from, until] range that
  // may lie in the PAST, not just the next `cap` upcoming from today. When `opts.from`/`opts.until` are
  // given we floor the cursor at `from` and terminate at `until` (cap ignored — the window bounds the
  // walk). With NO opts the behaviour is IDENTICAL to before (floor at `now`, stop after `cap` matches) —
  // so the ~53 §0/state callers are untouched.
  const from = opts?.from ?? now
  const until = opts?.until
  const windowed = until != null
  const anchorDate = new Date(anchor)
  const cursor = new Date(from)
  cursor.setHours(0, 0, 0, 0)
  let matches = 0
  let scanned = 0
  while ((windowed || matches < cap) && scanned < PROJECT_MAX_SCAN_DAYS) {
    const dayStart = cursor.getTime()
    if (until != null && dayStart > until) break
    if (repeat.until != null && dayStart > repeat.until) break
    if (dayMatchesRecurrence(dayStart, anchor, repeat)) {
      const ex = exceptions?.[dayStart]
      if (ex?.removed) {
        cursor.setDate(cursor.getDate() + 1)
        scanned++
        continue
      }
      const occDate = new Date(dayStart)
      occDate.setHours(anchorDate.getHours(), anchorDate.getMinutes(), anchorDate.getSeconds(), 0)
      const occStart = occDate.getTime()
      out.push({
        entityId,
        start: ex?.start ?? occStart,
        end: ex?.end ?? (duration > 0 ? occStart + duration : undefined),
        origin: "rule",
        cancelled: !!ex?.cancelled,
        occIndex: -1,
        recurrenceId: dayStart,
        ruleId,
      })
      matches++
    }
    cursor.setDate(cursor.getDate() + 1)
    scanned++
  }
}

/**
 * CANCEL (or un-cancel) a RULE occurrence (v0.2.234) — the exceptions-layer writer that makes a
 * VIRTUAL `repeat` instance restore-ably cancellable WITHOUT materialising the whole series. Sets
 * `schedule.exceptions[recurrenceId].cancelled` (recurrenceId = the occurrence's local-midnight
 * day-key). Un-cancelling that leaves an otherwise-empty patch DELETES the key (clean restore ⇒ the
 * day projects virtually again). Since v0.2.247 the scalar MIRRORS NEXT, so cancelling/restoring an
 * instance can change what "next" is ⇒ we `resyncPrimary` after the edit. Requires a `repeat` rule.
 * Returns false otherwise.
 */
export function setRuleOccurrenceCancelled(id: string, recurrenceId: number, cancelled = true, ruleId?: string): boolean {
  const stored = byId.get(id)
  if (!stored?.schedule) return false
  const occPhrase = `${cancelled ? "cancelled" : "restored"} · ${fmtOccDay(recurrenceId)}`
  // ruleId present ⇒ target an ADDITIONAL series' exceptions (v0.2.246); absent ⇒ the primary `repeat`.
  if (ruleId != null) return patchSeriesException(stored, ruleId, recurrenceId, { cancelled }, occPhrase)
  if (!stored.schedule.repeat) return false
  const sched: Schedule = { ...(stored.schedule ?? {}) }
  const exceptions = { ...(sched.exceptions ?? {}) }
  const next = { ...(exceptions[recurrenceId] ?? {}), cancelled }
  if (!next.cancelled && next.start == null && next.end == null) delete exceptions[recurrenceId]
  else exceptions[recurrenceId] = next
  if (Object.keys(exceptions).length === 0) delete sched.exceptions
  else sched.exceptions = exceptions
  resyncPrimary(sched) // NEXT may have changed (v0.2.247)
  const entity = mutable(stored)
  entity.schedule = sched
  // v0.2.254: explicit occurrence cancel/restore log for a primary-rule instance.
  logOccurrence(entity, occPhrase)
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), schedule: sched })
  }
  persist()
  return true
}

/**
 * EDIT the TIME of ONE RULE instance (v0.2.248) — the per-occurrence time-edit writer. Writes
 * `exceptions[recurrenceId].start` (+ optional `.end`) so `projectOccurrences` re-times just that one
 * instance (it already applies these override slots), leaving the rule + its other instances untouched.
 * Scope: time-of-day edit — the caller re-anchors the new clock onto the instance's existing day, so
 * `recurrenceId` (the day-key) stays valid. `ruleId` present ⇒ an additional series (v0.2.246); absent ⇒
 * the primary `repeat`. Resyncs the NEXT mirror after (an edited time can change what's next). Passing
 * `end == null` clears any prior end override (instance reverts to a point / the anchor's duration).
 * Requires the targeted rule to exist. Returns false otherwise.
 */
export function setRuleOccurrenceTime(
  id: string,
  recurrenceId: number,
  start: number,
  end?: number,
  ruleId?: string,
): boolean {
  const stored = byId.get(id)
  if (!stored?.schedule) return false
  const occPhrase = `edited · ${fmtOccSpan(start, end)}`
  if (ruleId != null) return patchSeriesException(stored, ruleId, recurrenceId, { start, end }, occPhrase)
  if (!stored.schedule.repeat) return false
  const sched: Schedule = { ...(stored.schedule ?? {}) }
  const exceptions = { ...(sched.exceptions ?? {}) }
  const prev = exceptions[recurrenceId] ?? {}
  const next: { cancelled?: boolean; removed?: boolean; start?: number; end?: number } = { ...prev, start }
  if (end != null) next.end = end
  else delete next.end
  exceptions[recurrenceId] = next
  sched.exceptions = exceptions
  resyncPrimary(sched) // NEXT may have changed (v0.2.248)
  const entity = mutable(stored)
  entity.schedule = sched
  // v0.2.254: explicit occurrence-edit log for a primary-rule instance.
  logOccurrence(entity, occPhrase)
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), schedule: sched })
  }
  persist()
  return true
}

/**
 * EDIT the TIME of ONE DEFINITE occurrence (v0.2.248) — the one-off analogue of `setRuleOccurrenceTime`.
 * `index` −1 = the scalar PRIMARY span (only reachable on a NON-recurring entity, where the scalar is a
 * real definite row); `index` ≥ 0 = `plannedOccurrences[index]`. Writes the new start (+ optional end),
 * then resyncs so the scalar mirror reflects the change. Time-of-day edit ⇒ caller re-anchors onto the
 * occurrence's existing day. Available on every kind except the Soul. Returns false on a bad index.
 */
export function setDefiniteOccurrenceTime(id: string, index: number, start: number, end?: number): boolean {
  const stored = byId.get(id)
  if (!stored || !canPlanOccurrences(stored)) return false
  const sched: Schedule = { ...(stored.schedule ?? {}) }
  // Capture the pre-edit span so the log can read "edited · <old> → <new>".
  let oldSpan: string
  if (index === -1) {
    if (!isPlannedStart(sched.startDate)) return false
    oldSpan = fmtOccSpan(sched.startDate!, sched.endDate)
    sched.startDate = start
    if (end != null) sched.endDate = end
    else delete sched.endDate
  } else {
    const occs = sched.plannedOccurrences
    if (!occs || index < 0 || index >= occs.length) return false
    oldSpan = fmtOccSpan(occs[index].start, occs[index].end)
    sched.plannedOccurrences = occs.map((o, i) => (i === index ? { ...o, start, end } : o))
  }
  resyncPrimary(sched)
  const entity = mutable(stored)
  entity.schedule = sched
  // v0.2.254: explicit occurrence-edit log (replaces the startDate mirror-log churn).
  logOccurrence(entity, `edited · ${oldSpan} → ${fmtOccSpan(start, end)}`)
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), schedule: sched })
  }
  persist()
  return true
}

/**
 * Apply a patch to ONE additional series' exceptions map (v0.2.246) — the `series[]` analogue of the
 * primary's exception writers. `patch.removed` ⇒ hard EXDATE (delete-instance); `patch.cancelled` ⇒
 * restorable tombstone. An exception that becomes empty (all flags false/absent) is deleted so the day
 * projects virtually again; an empty exceptions map is removed from the series. Returns false if the
 * series doesn't exist. Never touches the scalar (series rows don't drive the primary anchor).
 */
function patchSeriesException(
  stored: Entity,
  ruleId: string,
  recurrenceId: number,
  patch: { cancelled?: boolean; removed?: boolean; start?: number; end?: number },
  logPhrase?: string,
): boolean {
  const sched: Schedule = { ...(stored.schedule ?? {}) }
  const series = sched.series ?? []
  const idx = series.findIndex((sr) => sr.id === ruleId)
  if (idx === -1) return false
  const sr = series[idx]
  const exceptions = { ...(sr.exceptions ?? {}) }
  const next = { ...(exceptions[recurrenceId] ?? {}), ...patch }
  if (!next.cancelled && !next.removed && next.start == null && next.end == null) delete exceptions[recurrenceId]
  else exceptions[recurrenceId] = next
  const nextSr: SeriesRule = { ...sr }
  if (Object.keys(exceptions).length === 0) delete nextSr.exceptions
  else nextSr.exceptions = exceptions
  sched.series = series.map((s, i) => (i === idx ? nextSr : s))
  resyncPrimary(sched) // NEXT may have changed (v0.2.247)
  const entity = mutable(stored)
  entity.schedule = sched
  // v0.2.254: series-scoped occurrence log (add/edit/cancel/restore/delete), when the caller supplies it.
  if (logPhrase) logOccurrence(entity, logPhrase)
  if (!userEntityIds.has(stored.id)) {
    seededOverrides.set(stored.id, { ...seededOverrides.get(stored.id), schedule: sched })
  }
  persist()
  return true
}

/**
 * DELETE a DEFINITE occurrence (v0.2.240) — hard removal, vs the restorable struck tombstone of
 * cancel. `index` −1 = the scalar PRIMARY span (cleared outright; resyncPrimary then promotes the next
 * live span, or the entity goes idle); `index` ≥ 0 = splice `plannedOccurrences[index]`. Then resync.
 * (The primary-delete path is never dispatched for a recurring entity — its scalar is the rule anchor,
 * which has no definite primary row in the block.) Available on every kind except the Soul.
 */
export function deleteOccurrence(id: string, index: number): boolean {
  const stored = byId.get(id)
  if (!stored || !canPlanOccurrences(stored)) return false
  const sched: Schedule = { ...(stored.schedule ?? {}) }
  // Capture the span being removed so the log can read "deleted · <span>".
  let goneSpan: string
  if (index === -1) {
    if (!isPlannedStart(sched.startDate)) return false
    goneSpan = fmtOccSpan(sched.startDate!, sched.endDate)
    delete sched.startDate
    delete sched.endDate
  } else {
    const occs = sched.plannedOccurrences
    if (!occs || index < 0 || index >= occs.length) return false
    goneSpan = fmtOccSpan(occs[index].start, occs[index].end)
    sched.plannedOccurrences = occs.filter((_, i) => i !== index)
  }
  resyncPrimary(sched)
  const entity = mutable(stored)
  entity.schedule = sched
  // v0.2.254: explicit occurrence-delete log (replaces the startDate mirror-log churn).
  logOccurrence(entity, `deleted · ${goneSpan}`)
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), schedule: sched })
  }
  persist()
  return true
}

/**
 * DELETE a RULE instance (v0.2.240) — the hard-EXDATE writer: sets `exceptions[recurrenceId].removed`
 * so `projectOccurrences` drops that instance entirely (and backfills the next future day). Distinct
 * from `setRuleOccurrenceCancelled`, which keeps the instance visible as a restorable struck tombstone.
 * Requires a `repeat` rule. Returns false otherwise.
 */
export function deleteRuleOccurrence(id: string, recurrenceId: number, ruleId?: string): boolean {
  const stored = byId.get(id)
  if (!stored?.schedule) return false
  const occPhrase = `deleted · ${fmtOccDay(recurrenceId)}`
  // ruleId present ⇒ target an ADDITIONAL series' exceptions (v0.2.246); absent ⇒ the primary `repeat`.
  if (ruleId != null) return patchSeriesException(stored, ruleId, recurrenceId, { removed: true }, occPhrase)
  if (!stored.schedule.repeat) return false
  const sched: Schedule = { ...(stored.schedule ?? {}) }
  const exceptions = { ...(sched.exceptions ?? {}) }
  exceptions[recurrenceId] = { ...(exceptions[recurrenceId] ?? {}), removed: true }
  sched.exceptions = exceptions
  resyncPrimary(sched) // NEXT may have changed (v0.2.247)
  const entity = mutable(stored)
  entity.schedule = sched
  // v0.2.254: explicit occurrence-delete log for a primary-rule instance.
  logOccurrence(entity, occPhrase)
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), schedule: sched })
  }
  persist()
  return true
}

/**
 * CANCEL ALL DEFINITE occurrences (v0.2.240) — the definite-list "cancel all" title action. Marks every
 * not-yet-ended definite span cancelled (a struck, per-row-restorable tombstone); already-past ones are
 * left untouched (you can't cancel history, matching the per-row gate). Only the DEFINITE layer is
 * affected — recurrence series are left alone. For a rule-bearing entity the scalar is the NEXT-mirror
 * (v0.2.247), NOT a real definite primary, so it must NOT be swept into the cancel set (guard on
 * `hasRule`, not just `repeat`); `resyncPrimary` then re-mirrors NEXT from the surviving occurrences.
 */
export function cancelAllDefiniteOccurrences(id: string, now: number = Date.now()): boolean {
  const stored = byId.get(id)
  if (!stored || !canPlanOccurrences(stored)) return false
  const sched: Schedule = { ...(stored.schedule ?? {}) }
  const hasRule = !!sched.repeat || !!(sched.series && sched.series.length)
  const all: { start: number; end?: number; cancelled?: boolean }[] = []
  if (!hasRule && isPlannedStart(sched.startDate)) {
    all.push({ start: sched.startDate, end: sched.endDate, cancelled: false })
    delete sched.startDate
    delete sched.endDate
  }
  all.push(...(sched.plannedOccurrences ?? []))
  // Count the still-future definites this actually cancels (matches the map guard below) for the log.
  const cancelledCount = all.filter((o) => !o.cancelled && (o.end ?? o.start) >= now).length
  sched.plannedOccurrences = all.map((o) =>
    !o.cancelled && (o.end ?? o.start) >= now ? { ...o, cancelled: true } : o,
  )
  resyncPrimary(sched, now)
  const entity = mutable(stored)
  entity.schedule = sched
  // v0.2.254: explicit occurrence cancel-all log (replaces the startDate mirror-log churn).
  if (cancelledCount > 0) logOccurrence(entity, `cancelled all · ${cancelledCount}`)
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), schedule: sched })
  }
  persist()
  return true
}

/**
 * SET (or clear) the RECURRENCE rule (v0.2.234; optional anchor v0.2.235) — the writer behind the
 * create-bar `--repeat` flag and the block's "12h daily"-style add-slot. An explicit `anchor`
 * ({start,end?}) SETS the rule anchor (e.g. "12h daily" ⇒ anchor today 12:00), overriding whatever
 * time the entity had. With no anchor and NO existing time (`at`/`startDate`/`dueDate` all absent),
 * seeds `startDate = now` so the series is immediately projectable ("repeats starting now"). Passing
 * null repeat clears the rule (the entity reverts to its definite occurrences). Persist + log.
 */
export function setEntityRepeat(
  id: string,
  repeat: Recurrence | null,
  anchor?: { start: number; end?: number },
): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  const sched: Schedule = { ...(stored.schedule ?? {}) }
  if (repeat) {
    sched.repeat = repeat
    // Seed the DECOUPLED anchor (v0.2.247): explicit anchor wins; else derive from the current scalar
    // anchor (`at`/`startDate`/`dueDate`); else anchor at now. The scalar itself is then re-derived to
    // NEXT by `resyncPrimary` below, so it may differ from this seed.
    if (anchor) {
      sched.repeatAnchor = anchor.end != null ? { start: anchor.start, end: anchor.end } : { start: anchor.start }
    } else if (!sched.repeatAnchor) {
      const derived = primaryRuleAnchor(sched)
      sched.repeatAnchor = derived ?? { start: Date.now() }
    }
  } else {
    delete sched.repeat
    delete sched.repeatAnchor // no primary rule ⇒ no primary anchor
  }
  // Mirror NEXT into the scalar (rule-bearing branch), or restore the definite-set scalar when the last
  // rule was just cleared (and no series remain).
  resyncPrimary(sched)
  const entity = mutable(stored)
  entity.schedule = sched
  logSet(entity, "repeat", repeat ? repeat.freq : null)
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), schedule: sched })
  }
  persist()
  return true
}

/**
 * ADD an ADDITIONAL recurrence series (v0.2.246) — appends a self-anchored rule to `schedule.series[]`,
 * so multiple series co-exist on one entity alongside the primary `repeat`. The optional `anchor`
 * ({start,end?}) seeds the series' anchor; with none, it anchors at `now` (a point instance "repeats
 * starting now"). Returns the new series' id, or null if the entity doesn't exist. Never touches the
 * primary `repeat` or the scalar. This is what the block's rule-typed "+ add slot" calls when a primary
 * rule already exists (so a second rule becomes a NEW series rather than overwriting the first).
 */
export function addSeries(id: string, repeat: Recurrence, anchor?: { start: number; end?: number }): string | null {
  const stored = byId.get(id)
  if (!stored) return null
  const sched: Schedule = { ...(stored.schedule ?? {}) }
  const seriesId = uid("sr")
  const sr: SeriesRule = { id: seriesId, repeat, anchorStart: anchor?.start ?? Date.now() }
  if (anchor?.end != null) sr.anchorEnd = anchor.end
  sched.series = [...(sched.series ?? []), sr]
  resyncPrimary(sched) // the new series may now be the global NEXT ⇒ refresh the scalar mirror (v0.2.247)
  const entity = mutable(stored)
  entity.schedule = sched
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), schedule: sched })
  }
  persist()
  return seriesId
}

/**
 * REMOVE an ADDITIONAL recurrence series (v0.2.246) — drops the `series[]` entry with the given id
 * (its exceptions go with it). The `series[]` array is deleted entirely when it becomes empty. This is
 * the "clear/stop repeating" action for an additional series (the primary uses `setEntityRepeat(id,
 * null)`). Returns false if the entity or series doesn't exist.
 */
export function removeSeries(id: string, ruleId: string): boolean {
  const stored = byId.get(id)
  if (!stored?.schedule?.series) return false
  const sched: Schedule = { ...(stored.schedule ?? {}) }
  const next = (sched.series ?? []).filter((sr) => sr.id !== ruleId)
  if (next.length === (sched.series ?? []).length) return false
  if (next.length === 0) delete sched.series
  else sched.series = next
  resyncPrimary(sched) // removing a series may change the global NEXT ⇒ refresh the scalar mirror (v0.2.247)
  const entity = mutable(stored)
  entity.schedule = sched
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), schedule: sched })
  }
  persist()
  return true
}

/**
 * SET MULTI-TIMEBLOCK days (v0.2.276) — the Plan dialog's "Blocks" mode writer. Stores the given
 * within-day spans as `schedule.timeblocks` (absolute times on their anchor day) and mirrors the
 * scalar `startDate`/`endDate` to the FIRST/LAST timeblock, exactly like `applyParsedSchedule`'s
 * D4 branch, so every single-span reader (duration, bounds, dayline) keeps working and the expander
 * projects each block onto matching days. An optional `repeat` makes the whole block-day recurring
 * (anchored at the first block's start). Passing fewer than 2 blocks is a no-op for the multi-block
 * case — a single span is just a normal start/end, so callers should use the scalar path for that.
 * Deliberately does NOT call `resyncPrimary`: the timeblock mirror IS the primary here (matching
 * applyParsedSchedule, which sets timeblocks + scalar together without a NEXT re-pick).
 */
export function setEntityTimeblocks(
  id: string,
  timeblocks: { startAt: number; endAt: number }[],
  repeat?: Recurrence | null,
): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  if (!timeblocks || timeblocks.length < 2) return false
  const sorted = [...timeblocks].sort((a, b) => a.startAt - b.startAt)
  const sched: Schedule = { ...(stored.schedule ?? {}) }
  sched.timeblocks = sorted
  sched.startDate = sorted[0].startAt
  sched.endDate = sorted[sorted.length - 1].endAt
  if (repeat) {
    sched.repeat = repeat
    sched.repeatAnchor = { start: sorted[0].startAt, end: sorted[sorted.length - 1].endAt }
  }
  const entity = mutable(stored)
  entity.schedule = sched
  logSet(entity, "timeblocks", String(sorted.length))
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), schedule: sched })
  }
  persist()
  return true
}

// ----------------------------------------------------------------------------
// Per-context ORDER �� the user's drag-and-drop sibling order for a do-list.
// Scoped per context (like pins): `contextId` → the ordered child ids. A context
// with no entry uses natural creation order; ids missing from an entry fall to
// the end in creation order, so newly created items keep appending at the bottom.
// getChildren applies this ordering. Persisted so a reorder survives refreshes.
// ----------------------------------------------------------------------------

const orderByContext: Record<string, string[]> = {}

/** The user's saved child order for a context, or [] if none set. */
export function getContextOrder(contextId: string): string[] {
  return orderByContext[contextId] ?? []
}

/**
 * Persist a new sibling order for a context's do-list. `orderedIds` is the full
 * visible order the user arranged via drag-and-drop. Stored verbatim; getChildren
 * ranks children by it (unknown/deleted ids are simply ignored, and children not
 * listed sort to the end in creation order). Idempotent + safe to call on every
 * drop.
 */
export function reorderContextItems(contextId: string, orderedIds: string[]): void {
  orderByContext[contextId] = [...orderedIds]
  persist()
}

/**
 * REPARENT — move an entity so it lives INSIDE `newContextId` (drag-and-drop nest-into).
 * Changes the entity's primary `parentId` (leaving any `taggedContextIds` cross-links alone).
 * Returns false (a no-op) when the move is meaningless or illegal:
 *   - the entity doesn't exist,
 *   - dropping onto itself,
 *   - it's already a direct child of the target,
 *   - the target is the entity itself or one of its DESCENDANTS (would make a cycle / orphan
 *     the moved subtree) — guarded by walking parentId up from the target.
 * On success it also fixes up the saved sibling ORDER: the id is appended to the new context's
 * order (so it lands last) and removed from the old one. Seeded entities record a `parentId`
 * override so the move survives reloads (same pattern as setEntityAccent/Cancelled).
 */
export function moveEntityToContext(entityId: string, newContextId: string): boolean {
  const entity = byId.get(entityId)
  if (!entity) return false
  if (entityId === newContextId) return false
  if (entity.parentId === newContextId) return false
  // REACHABILITY GUARD (v0.2.296): refuse to nest INTO a web resource. A web resource is a browsing
  // LEAF — when focused, the canvas renders the web page and deliberately shows NO child do-list ("the
  // web page IS the content"), so a child moved inside one would have no row anywhere and become
  // unreachable. This is the v0.2.288 data-loss bug (a Space dragged onto a web-resource row silently
  // vanished). Sub-resources created by in-page navigation don't come through here, so nothing legit
  // breaks. The drag layer (onDragEnd) additionally redirects such a drop to a sibling placement.
  const target = byId.get(newContextId)
  if (target?.webUrl) return false
  // CYCLE GUARD: refuse if newContextId is entityId or sits under it. Walk parentId upward
  // from the target; if we reach entityId, the target is a descendant. (Own general walk —
  // collectDescendants only follows spaces, so it can't be reused for arbitrary kinds.)
  let cursor: string | null = newContextId
  const guard = new Set<string>()
  while (cursor && !guard.has(cursor)) {
    if (cursor === entityId) return false
    guard.add(cursor)
    cursor = byId.get(cursor)?.parentId ?? null
  }
  const oldParent = entity.parentId
  entity.parentId = newContextId
  // v0.2.204: RECONCILE redundant cross-tags so a move reads as a true move, not a copy. Drop any
  // taggedContextIds that are now an ANCESTOR (or equal) of the new parent: getChildren matches
  // parentId OR taggedContextIds, so a tag pointing at an ancestor of where the item now lives
  // would keep showing a ghost of it up the chain (the exact bug: task moved into Backlog but still
  // showing under Backlog's parent "Zero" because of an auto-tag to Zero). `isInSubtree(tag,
  // newContextId)` is true when the new parent is that tag or sits under it → that tag is redundant.
  // Genuinely independent tags (siblings / unrelated contexts) are preserved.
  if (entity.taggedContextIds?.length) {
    const kept = entity.taggedContextIds.filter((tag) => !isInSubtree(tag, newContextId))
    if (kept.length !== entity.taggedContextIds.length) {
      entity.taggedContextIds = kept
    }
  }
  if (!userEntityIds.has(entityId)) {
    seededOverrides.set(entityId, {
      ...seededOverrides.get(entityId),
      parentId: newContextId,
      taggedContextIds: entity.taggedContextIds,
    })
  }
  // Land it LAST in the new context's saved order (if that context has one).
  const destOrder = orderByContext[newContextId]
  if (destOrder) orderByContext[newContextId] = [...destOrder.filter((id) => id !== entityId), entityId]
  // Drop it from the old context's saved order so it doesn't linger as a ghost slot.
  if (oldParent && orderByContext[oldParent]) {
    orderByContext[oldParent] = orderByContext[oldParent].filter((id) => id !== entityId)
  }
  persist()
  return true
}

// ----------------------------------------------------------------------------
// Mutations — user-created entities. Persisted to localStorage so created
// items survive refreshes. They push into the same `entities` array/index the
// selectors above read from, so a new item shows up everywhere it should.
// ----------------------------------------------------------------------------

let _seq = 0
const uid = (prefix: string) => `${prefix}_u${Date.now().toString(36)}${(_seq++).toString(36)}`

// Kind → id prefix. Kept in sync with the dedicated add* fns (addTask→t, addMoment→m,
// addInstant→i, addResource→r, addSpace→s). Used by addParsedEntity so an entity's id
// reflects its kind regardless of the create path. Falls back to "t" for unmapped kinds.
const ID_PREFIX: Partial<Record<EntityKind, string>> = {
  entity: "e",
  task: "t",
  moment: "m",
  instant: "i",
  resource: "r",
  space: "s",
  community: "c",
  organism: "o",
  individual: "n",
  soul: "l",
}

// Track which ids are user-created so we can re-serialize just those on save.
const userEntityIds = new Set<string>()
// Tombstones for SEEDED entities the user deleted (user-created ones are simply
// dropped from `userEntityIds`). Persisted so deletions of demo data survive.
const deletedSeededIds = new Set<string>()
// In-place mutations of SEEDED entities (e.g. cancelling an event). Persisted
// as partial overrides; merged back onto the seeded entity on hydrate.
const seededOverrides = new Map<string, Partial<Entity>>()

function persist() {
  writeUserItems({
    entities: entities.filter((e) => userEntityIds.has(e.id)),
    pins: pinnedByContext,
    order: orderByContext,
    deletedIds: [...deletedSeededIds],
    overrides: Object.fromEntries(seededOverrides),
    starterPins: [...starterPins],
  })
}

/**
 * Fold a pre-schedule persisted entity (old flat minutes-from-midnight fields
 * `start`/`end`/`at`/`seconds` and free-text `dueDate`) into the new `schedule`
 * object, anchored to today. Mutates in place; no-op once `schedule` exists or
 * no legacy fields are present. Keeps localStorage data from older builds valid.
 */
function migrateLegacyTime(entity: Entity): void {
  if (entity.schedule) return
  // Legacy fields are no longer on the Entity type; read via a loose view.
  const legacy = entity as Entity & {
    start?: number
    end?: number
    at?: number
    seconds?: number
    dueDate?: string
  }
  const fromMin = (min: number, sec = 0) => t(Math.floor(min / 60), min % 60, sec)
  const schedule: NonNullable<Entity["schedule"]> = {}
  if (typeof legacy.start === "number") schedule.startDate = fromMin(legacy.start)
  if (typeof legacy.end === "number") schedule.endDate = fromMin(legacy.end)
  if (typeof legacy.at === "number") schedule.at = fromMin(legacy.at, legacy.seconds ?? 0)
  // Old free-text dueDate can't be parsed reliably; default a labelled due to 5pm today.
  if (legacy.dueDate) schedule.dueDate = t(17)
  if (Object.keys(schedule).length > 0) entity.schedule = schedule
  delete legacy.start
  delete legacy.end
  delete legacy.at
  delete legacy.seconds
  delete legacy.dueDate
}

/**
 * ONTOLOGY MIGRATION (Jul 2026): web-surfaces used to be created as `kind:"task"`
 * with a `webUrl` (the old "resource task"). A URL is a thing the work DRAWS ON, so
 * it is now its own `resource` kind (diamond glyph). This one-time, in-place flip
 * upgrades any such PERSISTED entity so old data matches newly-created resources.
 * Mutates in place; no-op for anything that isn't a task-with-webUrl. It drops the
 * task-only `priority` (resources have none) and keeps id/title/webUrl/pins intact,
 * so the entity — and any dock pin referencing its id — survives unchanged.
 */
function migrateWebTaskToResource(entity: Entity): void {
  if (entity.kind !== "task" || !entity.webUrl) return
  const loose = entity as Entity & { priority?: unknown }
  ;(entity as { kind: EntityKind }).kind = "resource"
  delete loose.priority
}

/**
 * ONTOLOGY MIGRATION (Jul 2026): the time-span kind was renamed `event` → `moment`
 * (a "Moment" — a span in time — per the Zero ontology bible). This one-time,
 * in-place flip upgrades any PERSISTED entity still carrying the legacy
 * `kind:"event"` so old data matches newly-created moments. Reads `kind` through a
 * loose view because `"event"` is no longer part of the EntityKind union. No-op for
 * every other kind; id/title/schedule/pins are untouched, so the entity — and any
 * dock pin or recurrence override referencing its id — survives unchanged.
 */
function migrateEventToMoment(entity: Entity): void {
  if ((entity as { kind: string }).kind !== "event") return
  ;(entity as { kind: EntityKind }).kind = "moment"
}

/**
 * ONTOLOGY MIGRATION (Jul 2026, Phase 2 + 2b): fold a persisted entity's legacy
 * SCALAR lifecycle fields (`creationDate`/`completedOn`/`closedOn`/`reopenedOn`, plus
 * `cancelled` and the terminal `retiredOn`/`diedOn`) into the append-only
 * {@link Instant} log — Meta field 1 — if it doesn't already have one.
 * Idempotent (a non-empty `log` is left untouched) and NON-destructive: the scalar
 * fields are kept as the transitional backup, and reads already prefer the log. Only
 * runs for PERSISTED user entities in the hydrate loop; seeded entities keep reading
 * through the scalar fallback and gain a session log lazily when toggled.
 */
function migrateCompletionToLog(entity: Entity): void {
  if (entity.log && entity.log.length > 0) return
  entity.log = buildLogFromScalars(entity)
}

/** The space-era key the multi-parent link field used before it became `taggedContextIds`. */
const LEGACY_TAGGED_KEY = "taggedSpaceIds"

/**
 * ONE-TIME KEY MIGRATION (Jul 2026): the persisted multi-parent link field was renamed
 * `taggedSpaceIds` → `taggedContextIds` (a "context" is any entity, so the link is fully
 * recursive — not space-specific). Persisted entities from older builds still carry the
 * OLD key, so this renames it in place on the freshly-read {@link UserItems} — for both
 * created `entities` and any seeded-entity `overrides` patch that captured the field.
 * MUST run before {@link migrateStoredRootId}, which reads `taggedContextIds` to reattach
 * the old root id inside those links. Idempotent: no-op once no legacy key remains.
 */
function migrateStoredTaggedKey(stored: UserItems): void {
  const rename = (obj: Record<string, unknown>) => {
    if (Array.isArray(obj[LEGACY_TAGGED_KEY]) && obj.taggedContextIds === undefined) {
      obj.taggedContextIds = obj[LEGACY_TAGGED_KEY]
    }
    delete obj[LEGACY_TAGGED_KEY]
  }
  for (const e of stored.entities) rename(e as unknown as Record<string, unknown>)
  for (const patch of Object.values(stored.overrides)) rename(patch as Record<string, unknown>)
}

/** The pre-v0.2.229 field name for entity inputs (a bare `string[]` of Resource ids). */
const LEGACY_INPUTS_KEY = "assignedResourceIds"

/**
 * ONE-TIME MIGRATION (v0.2.229): `assignedResourceIds: string[]` → `inputs: InputEdge[]`. Renames
 * the key AND reshapes each bare id into an object edge `{ id }` (so a future `amount?`/`role` is
 * additive). Runs in place on the freshly-read {@link UserItems} for both created `entities` and
 * any seeded-entity `overrides` patch that captured the field.
 * MUST run before {@link migrateStoredRootId}, which now remaps ids INSIDE the `inputs` edges.
 * Idempotent: no-op once the legacy key is gone and `inputs` is already object-shaped.
 */
function migrateStoredInputs(stored: UserItems): void {
  const rename = (obj: Record<string, unknown>) => {
    const legacy = obj[LEGACY_INPUTS_KEY]
    if (Array.isArray(legacy) && obj.inputs === undefined) {
      obj.inputs = legacy.map((v) => (typeof v === "string" ? { id: v } : v))
    }
    delete obj[LEGACY_INPUTS_KEY]
    // Defensive: an `inputs` persisted as a bare string[] (shouldn't happen) → wrap it.
    if (Array.isArray(obj.inputs)) {
      obj.inputs = (obj.inputs as unknown[]).map((v) => (typeof v === "string" ? { id: v } : v))
    }
  }
  for (const e of stored.entities) rename(e as unknown as Record<string, unknown>)
  for (const patch of Object.values(stored.overrides)) rename(patch as Record<string, unknown>)
}

/** The space-era id the root Individual used before it became {@link ROOT_ID} ("0"). */
const LEGACY_ROOT_ID = "s_root"

/**
 * ONE-TIME MIGRATION (Jul 2026): the root Individual's id changed from the space-era
 * `"s_root"` to the ontology-clean {@link ROOT_ID} (`"0"`). The root itself is seeded
 * (so it already loads as `"0"`), but any data the user PERSISTED under the old id would
 * otherwise dangle. This remaps, in place on the freshly-read {@link UserItems}:
 *   • child `parentId`s pointing at the old root → `"0"` (reattaches the whole subtree);
   *   • id references inside `taggedContextIds` / `inputs` edges;
 *   • the per-context `pins` / `order` maps keyed by (or listing) the old id;
 *   • an `overrides` patch keyed by the old id (e.g. a renamed/recolored root);
 *   • any `deletedIds` entry.
 * Idempotent and fully no-op once a store has no `"s_root"` left (i.e. every future load).
 */
function migrateStoredRootId(stored: UserItems): void {
  const swap = (id: string) => (id === LEGACY_ROOT_ID ? ROOT_ID : id)
  for (const e of stored.entities) {
    if (e.parentId === LEGACY_ROOT_ID) e.parentId = ROOT_ID
    if (Array.isArray(e.taggedContextIds)) e.taggedContextIds = e.taggedContextIds.map(swap)
    // `inputs` is already object-wrapped by migrateStoredInputs (runs before this); remap the id inside each edge.
    if (Array.isArray(e.inputs)) e.inputs = e.inputs.map((edge) => ({ ...edge, id: swap(edge.id) }))
  }
  const remapMap = (m: Record<string, string[]>) => {
    if (Array.isArray(m[LEGACY_ROOT_ID])) {
      m[ROOT_ID] = [...(m[ROOT_ID] ?? []), ...m[LEGACY_ROOT_ID]]
      delete m[LEGACY_ROOT_ID]
    }
    for (const k of Object.keys(m)) m[k] = m[k].map(swap)
  }
  remapMap(stored.pins)
  remapMap(stored.order)
  if (stored.overrides[LEGACY_ROOT_ID]) {
    stored.overrides[ROOT_ID] = { ...(stored.overrides[ROOT_ID] ?? {}), ...stored.overrides[LEGACY_ROOT_ID] }
    delete stored.overrides[LEGACY_ROOT_ID]
  }
  stored.deletedIds = stored.deletedIds.map(swap)
}

// The canonical key is `schedule.sessions` (with `via`). Persisted data can be in TWO older
// shapes we normalize on hydrate:
//   A) pre-v0.4.8 — key `sessions`, entries discriminated by `kind` (the original name; we're
//      BACK to `sessions` now, so the key is already right — only `kind`→`via` needs fixing).
//   B) v0.4.8..this rename �� key `engagements`, entries already using `via` (move key back).
const INTERIM_SESSIONS_KEY = "engagements" // the "engagements" era (B) — move it back to `sessions`
const LEGACY_SESSION_VIA_KEY = "kind" // the pre-v0.4.8 per-entry discriminator (A) → `via`
/**
 * Normalize persisted schedules onto the canonical `schedule.sessions: {…, via}[]` shape,
 * undoing the interim `engagements` rename (B) and the original `kind` discriminator (A). Runs
 * on `entity.schedule` for every stored entity AND any seeded-entity `overrides` patch that
 * captured a schedule. In-memory only (like the tagged/root migrations); localStorage rewrites
 * on the next mutation. Idempotent: canonical data ⇒ no-op.
 */
function migrateStoredSessionsKey(stored: UserItems): void {
  const fix = (sched: unknown) => {
    if (!sched || typeof sched !== "object") return
    const s = sched as Record<string, unknown>
    // (B) interim `engagements` array key → canonical `sessions` (don't clobber existing).
    const interim = s[INTERIM_SESSIONS_KEY]
    if (Array.isArray(interim) && s.sessions === undefined) {
      s.sessions = interim
      delete s[INTERIM_SESSIONS_KEY]
    }
    // (A) normalize each entry's `kind` discriminator → `via`.
    const list = s.sessions
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (entry && typeof entry === "object") {
          const e = entry as Record<string, unknown>
          if (e[LEGACY_SESSION_VIA_KEY] !== undefined && e.via === undefined) {
            e.via = e[LEGACY_SESSION_VIA_KEY]
          }
          delete e[LEGACY_SESSION_VIA_KEY]
        }
      }
    }
  }
  for (const e of stored.entities) fix((e as { schedule?: unknown }).schedule)
  for (const patch of Object.values(stored.overrides)) fix((patch as { schedule?: unknown }).schedule)
}

/**
 * v0.2.228 FIELD RENAMES — normalize persisted data onto the new explicit names. Runs on every
 * stored entity AND every seeded-entity `overrides` patch. Rules:
 *   TOP-LEVEL:  createdAt→creationDate, accent→color, webTitle→displayTitle,
 *               completed→done, completedOn→doneOn  (v0.2.229 — the DONE marker; renamed off the
 *               name it shared with the separate COMPLETE verdict `complete`/`completeOn`, which
 *               are LEFT UNTOUCHED here)
 *   SCHEDULE (the PLAN):  startAt→startDate, endAt→endDate, dueAt→dueDate  (`at` unchanged)
 *   SCHEDULE:  blocks→timeblocks (v0.2.229 — "block" was overloaded); its INNER startAt/endAt
 *              are UNCHANGED (a timeblock is a planned sub-span).
   *   RECORDED sessions[]:  startAt→startedAt, endAt→endedAt
   *   OCCURRENCES[] (now the PLAN, v0.2.229):  startAt/startedAt→start, endAt/endedAt→end
 * In-memory only (like the sibling migrations); localStorage rewrites on the next mutation.
 * Idempotent: canonical data ⇒ no-op (never clobbers an already-present new key).
 */
function migrateStoredScheduleFields(stored: UserItems): void {
  const move = (o: Record<string, unknown>, from: string, to: string) => {
    if (o[from] !== undefined && o[to] === undefined) o[to] = o[from]
    delete o[from]
  }
  const fixRecordedList = (list: unknown) => {
    if (!Array.isArray(list)) return
    for (const entry of list) {
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>
        move(e, "startAt", "startedAt")
        move(e, "endAt", "endedAt")
      }
    }
  }
  // PLANNED OCCURRENCES were reshaped {startedAt,endedAt}→{start,end} (v0.2.229 — occurrences are the
  // PLAN, actual is derived). Map from BOTH legacy shapes in one hop: the very-old `startAt`/`endAt`
  // AND the interim `startedAt`/`endedAt`. `cancelled` is unchanged. (Kept SEPARATE from
  // fixRecordedList, which still applies to sessions[] — those stay recorded `startedAt`/`endedAt`.)
  const fixOccurrenceList = (list: unknown) => {
    if (!Array.isArray(list)) return
    for (const entry of list) {
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>
        move(e, "startAt", "start")
        move(e, "startedAt", "start")
        move(e, "endAt", "end")
        move(e, "endedAt", "end")
      }
    }
  }
  const fixOne = (obj: unknown) => {
    if (!obj || typeof obj !== "object") return
    const o = obj as Record<string, unknown>
    // top-level renamed fields
    move(o, "createdAt", "creationDate")
    move(o, "accent", "color")
    move(o, "webTitle", "displayTitle")
    // DONE marker rename (v0.2.229). Only touches `completed`/`completedOn`; the COMPLETE-verdict
    // keys `complete`/`completeOn` are distinct and deliberately left alone.
    move(o, "completed", "done")
    move(o, "completedOn", "doneOn")
    // schedule
    const sched = o.schedule
    if (sched && typeof sched === "object") {
      const s = sched as Record<string, unknown>
      move(s, "startAt", "startDate")
      move(s, "endAt", "endDate")
      move(s, "dueAt", "dueDate")
      move(s, "blocks", "timeblocks") // v0.2.229 key rename; inner startAt/endAt left as-is
      move(s, "occurrences", "plannedOccurrences") // v0.2.233 key rename (occurrences �� plannedOccurrences)
      fixRecordedList(s.sessions)
      fixOccurrenceList(s.plannedOccurrences) // normalize entry shape on the NEW key
    }
  }
  for (const e of stored.entities) fixOne(e)
  for (const patch of Object.values(stored.overrides)) fixOne(patch)
}

let _hydrated = false

/**
 * Merge localStorage-persisted user entities into the in-memory store. Safe to
 * call multiple times; only runs once. Returns true if anything was added so
 * callers can bump their data version.
 */
export function hydrateFromStorage(): boolean {
  if (_hydrated) return false
  _hydrated = true
  const stored = readUserItems()
  // Normalize the space-era `taggedSpaceIds` key → `taggedContextIds` FIRST, so the
  // root-id remap below can read the multi-parent links through the new key.
  migrateStoredTaggedKey(stored)
  // v0.2.229: `assignedResourceIds: string[]` → `inputs: InputEdge[]`. MUST precede the root-id
  // remap below, which now swaps ids inside the (already object-wrapped) `inputs` edges.
  migrateStoredInputs(stored)
  // Reattach any data persisted under the old space-era root id before merging.
  migrateStoredRootId(stored)
  // Normalize persisted schedules onto canonical `sessions[]` (undo interim `engagements` key + old `kind`).
  migrateStoredSessionsKey(stored)
  // v0.2.228: rename schedule/top-level fields (startAt→startDate, accent→color, sessions startAt→startedAt, …).
  migrateStoredScheduleFields(stored)
  let added = false
  // DEV-only: collect log↔scalar disagreements to prove out dual-write before the
  // scalars are retired (Phase 3). Reported once after the loop; never in prod.
  const logAudit: LogScalarMismatch[] = []

  for (const entity of stored.entities) {
    if (byId.has(entity.id)) continue
    migrateLegacyTime(entity)
    migrateWebTaskToResource(entity)
    migrateEventToMoment(entity)
    // Audit BEFORE seeding a log so only GENUINELY persisted logs are checked
    // (freshly-migrated ones would match their scalars by construction).
    if (process.env.NODE_ENV !== "production") logAudit.push(...auditLogScalarConsistency(entity))
    migrateCompletionToLog(entity)
    // Backfill per-entity log ids on LEGACY (pre-id) stored logs, BEFORE any append can run this
    // session — this is what makes `nextLogId` correct thereafter (no append could collide with an
    // un-id'd legacy entry). Idempotent + no-op for already-id'd logs.
    if (entity.log) entity.log = ensureLogIds(entity.log)
    entities.push(entity)
    byId.set(entity.id, entity)
    userEntityIds.add(entity.id)
    // Re-register any persisted recurrence overrides into the occurrence index.
    indexOverride(entity)
    added = true
  }

  // Restore pins (per-context). Pins reference seeded or user items by id.
  for (const [contextId, ids] of Object.entries(stored.pins)) {
    if (!Array.isArray(ids) || ids.length === 0) continue
    pinnedByContext[contextId] = [...ids]
    added = true
  }

  // Restore per-context drag-and-drop order (references seeded or user ids).
  for (const [contextId, ids] of Object.entries(stored.order)) {
    if (!Array.isArray(ids) || ids.length === 0) continue
    orderByContext[contextId] = [...ids]
    added = true
  }

  // Restore the global starter-pin list (the curated §4 PINNED frame). Ids may
  // reference seeded or user entities; unresolvable ones are filtered lazily by
  // getStarterPinnedEntities, so we keep the list verbatim here.
  if (Array.isArray(stored.starterPins) && stored.starterPins.length > 0) {
    starterPins = [...stored.starterPins]
    added = true
  }

  // Apply in-place overrides for seeded entities (e.g. a cancelled event).
  for (const [id, patch] of Object.entries(stored.overrides)) {
    const entity = byId.get(id)
    if (!entity || userEntityIds.has(id)) continue
    Object.assign(entity, patch)
    // An override patch may carry a legacy (pre-id) `log` for a seeded entity — seal ids here too.
    if (entity.log) entity.log = ensureLogIds(entity.log)
    seededOverrides.set(id, patch)
    added = true
  }

  // Apply tombstones for seeded entities the user deleted.
  for (const id of stored.deletedIds) {
    if (userEntityIds.has(id)) continue
    if (removeEntityById(id)) {
      deletedSeededIds.add(id)
      added = true
    }
  }

  // Hydrate-cleanup: reconcile any DANGLING focus session a previous run left open. Focus
  // punch-ins open on EVERY kind (moment/instant included — recorded ACTIVITY, doesn't flip STATE),
  // so this scans ALL kinds; the `via === "play"` guard leaves manual PLAY stopwatches running.
  //
  // LIVENESS (v0.6.20, NO heartbeat): `getLastKnownAlive()` is the newest moment we have evidence
  // the app was alive — the access log's last flush stamp (written on every hide/reload). Two
  // cases:
  //   • alive-RECENTLY (now ��� alive ≤ ALIVE_GRACE_MS) ⇒ this was a mere RELOAD/deploy while you
  //     were still present, NOT a shutdown. LEAVE the focus session OPEN so it stays continuous
  //     (openSession is idempotent, so the canvas re-uses it) — one long ongoing bar, matching
  //     "I never ended it". (The OLD bug closed it at lastLogAt≈startAt → span≈0 → dropped.)
  //   • genuine GAP ⇒ the app really was shut. Close the span at the LAST-KNOWN-ALIVE moment (the
  //     truthful "when I was last here"), NOT lastLogAt (≈0 for an idle session), and DROP spans
  //     ≤ MIN_SESSION_MS. We never fabricate an end beyond what we can prove.
  // v0.2.293 ANCHOR-ID BACKFILL (GATED) — sessions[] persisted before this release carry no
  // `anchorId`, so their recorded spans wouldn't be editable (editSession/deleteSession need the
  // anchor). Re-derive from the log and adopt the fold output ONLY when it faithfully reproduces the
  // cached RECORDED (play) set: same count AND same [startedAt, endedAt] bounds, in order. That proves
  // the cache is losslessly reconstructible from the log, so adopting it merely ATTACHES anchorId
  // without changing any timing. A cache the log can't reproduce (e.g. a `setOpenSessionStart`
  // backdate-merge, or hand-imported data) fails the gate and is left verbatim — degrading gracefully
  // to non-editable rather than risking a silent re-time. Runs BEFORE the dangling-session cleanup so
  // the (now-anchored) sessions flow through it unchanged. In-memory only; persists on next mutation.
  for (const entity of entities) {
    const cached = entity.schedule?.sessions
    if (!cached || cached.length === 0 || !entity.log) continue
    if (cached.some((s) => s.via === "play" && s.anchorId != null)) continue // already anchored
    const derived = deriveSessionsFromLog(entity, {
      minSessionMs: MIN_SESSION_MS,
      ongoingOnEnter: ONGOING_ON_ENTER.has(entity.kind),
    })
    const cachedPlay = cached.filter((s) => s.via === "play")
    const derivedPlay = derived.filter((s) => s.via === "play")
    if (cachedPlay.length !== derivedPlay.length) continue // shape drift ⇒ don't touch
    const matches = cachedPlay.every((c, i) => {
      const d = derivedPlay[i]
      return c.startedAt === d.startedAt && (c.endedAt ?? null) === (d.endedAt ?? null)
    })
    if (!matches) continue
    // Faithful reproduction — adopt the derived list (carries anchorId + identical bounds).
    entity.schedule = { ...entity.schedule, sessions: derived }
  }

  const aliveAt = getLastKnownAlive()
  const nowAt = Date.now()
  const aliveRecently = aliveAt != null && nowAt - aliveAt <= ALIVE_GRACE_MS
  // AWAY RECONCILIATION (v0.2.302 — LOG-WRITE, upgraded from the old in-memory cap). On a genuine
  // gap (the user was away — e.g. a week's vacation — and the app never wrote its exit), append ONE
  // truthful `exited` instant at LAST-KNOWN-ALIVE to every entity holding a dangling ACCESS-DRIVEN
  // span (an open `focus` OR an open AUTO play, i.e. ongoing-on-enter). The fold's `exited` case then
  // closes BOTH the focus AND the auto ongoing at that moment, while a MANUAL/remote play (a
  // deliberate stopwatch, `via:"play"` without `auto`) SURVIVES untouched.
  //   • Why log-write, not the old cache patch: `getSessions` reads the cached `sessions[]`, but ANY
  //     later re-fold (e.g. the resume click → openSession → recomputeSessionsFromLog) re-derives from
  //     the raw log and would REOPEN a cache-only cap (the auto span has no `exited` in the log). By
  //     writing the `exited` we make the closure DURABLE and TRUTHFUL, so (a) the glyph reads stopped,
  //     (b) the dayline tick ENDS at last-known-alive (Loris' explicit ask), and (c) a resume opens a
  //     FRESH span from the click time instead of resurrecting a week-long stale one.
  //   • This also makes ACCESS spans accurate: the v0.2.301 mid-log guard closes a stale focus at the
  //     NEXT access (overstating it by the gap); this closes it at last-known-alive (the real end).
  // alive-RECENTLY (now − alive ≤ ALIVE_GRACE_MS) ⇒ a mere reload while present ⇒ leave everything
  // open (continuous). No alive evidence at all ⇒ fall back to lastLogAt, and the fold drops any span
  // that collapses below MIN_SESSION_MS — we never fabricate an end beyond what we can prove.
  if (!aliveRecently) {
    for (const entity of entities) {
      const sessions = entity.schedule?.sessions
      if (!sessions || sessions.length === 0) continue
      const openAccessStarts = sessions
        .filter((e) => e.endedAt == null && (e.via === "focus" || (e.via === "play" && e.auto)))
        .map((e) => e.startedAt)
      if (openAccessStarts.length === 0) continue // nothing access-driven dangling (manual play stays)
      // Bound the close at ≥ the LATEST open start so no span goes negative; the fold discards any
      // sub-MIN_SESSION_MS remainder. `exited` closes focus + auto ongoing; manual play is left alone.
      const latestOpenStart = Math.max(...openAccessStarts)
      const closeAt = Math.max(aliveAt ?? lastLogAt(entity) ?? latestOpenStart, latestOpenStart)
      entity.log = appendInstant(ensureEntityLog(entity), makeInstant("exited", closeAt))
      recomputeSessionsFromLog(entity.id, entity)
      // In-memory only (like the id/tagged migrations); persists on the next mutation.
    }
  }

  // Close any DANGLING session on an entity that is ALREADY CLOSED (cancelled / completed
  // / closed / retired / dead). A closed entity can't still be running, so its open
  // session is an ORPHAN punch-in that never got punched out — otherwise it prints as an
  // eternal ongoing bar on the dayline. Stamp its end at the entity's last logged activity
  // (`lastLogAt`) so the bar terminates AND the record shows WHEN it ended (openable). Unlike
  // the focus-cleanup above (which keeps a `play` stopwatch running while the ENTITY is still
  // OPEN), this fires for ANY kind + ANY session kind precisely because the entity is closed.
  for (const entity of entities) {
    const sessions = entity.schedule?.sessions
    if (!sessions || sessions.length === 0) continue
    if (!isClosed(entity)) continue // still open ⇒ legitimately running, leave it
    // v0.6.32: cap EVERY open session (focus AND play) — a closed entity can hold both now.
    let changed = false
    const next: Session[] = []
    for (const e of sessions) {
      if (e.endedAt != null) {
        next.push(e)
        continue
      }
      changed = true
      const endAt = lastLogAt(entity) ?? e.startedAt
      if (endAt - e.startedAt <= MIN_SESSION_MS) continue // too short → drop
      next.push({ ...e, endedAt: endAt })
    }
    if (changed) entity.schedule = { ...entity.schedule, sessions: next }
  }

  // v0.2.247 NEXT-MIRROR NORMALIZATION — for every RULE-BEARING entity (primary `repeat` OR ≥1 series),
  // seed the decoupled `repeatAnchor` from the legacy scalar anchor (once), then re-derive the scalar
  // `startDate`/`endDate` as the GLOBAL current-or-next occurrence. This migrates pre-.247 data (where
  // the scalar WAS the frozen anchor) in place and refreshes the mirror for seeds on every load so a
  // recurring entity's scalar always reflects "what's next" at open time. In-memory only (persists on
  // the next mutation), idempotent. Covers seeded + user entities (both are in `entities` by now).
  for (const entity of entities) {
    const s = entity.schedule
    if (!s) continue
    const hasRule = !!s.repeat || !!(s.series && s.series.length)
    if (!hasRule) continue
    const sched: Schedule = { ...s }
    if (s.repeat && !s.repeatAnchor) {
      const derived = primaryRuleAnchor(sched)
      if (derived) sched.repeatAnchor = derived
    }
    resyncPrimary(sched)
    entity.schedule = sched
  }

  // DEV-only: surface any log↔scalar drift found above. A clean load (no warning)
  // across normal dogfooding is the green light to retire the scalar backups.
  if (process.env.NODE_ENV !== "production" && logAudit.length > 0) {
    console.warn(
      `[v0] entity-log consistency: ${logAudit.length} mismatch(es) between log-derived state and scalar backup:`,
      logAudit,
    )
  }

  return added
}

/** The latest timestamp in an entity's lifecycle log, or null if it has no log. */
function lastLogAt(entity: Entity): number | null {
  const log = entity.log
  if (!log || log.length === 0) return null
  let max = log[0].at
  for (const e of log) if (e.at > max) max = e.at
  return max
}

/**
 * CROSS-WINDOW RESYNC — rebuild the user-created portion of the in-memory store from
 * localStorage, reconciling ADD / UPDATE / DELETE (unlike {@link hydrateFromStorage},
 * which only additively merges once). Called when ANOTHER window/tab writes our key (the
 * `storage` event never fires in the window that made the change, so there's no echo
 * loop). Returns true if anything actually changed, so the caller can bump its re-render.
 *
 * Model = last-write-wins on the whole blob (that's how `persist()` saves). We treat the
 * stored blob as the source of truth for USER entities + pins + order + seed overrides +
 * tombstones; SEED entities the reader hasn't overridden are left as their code defaults.
 * Known limitation: an override CLEARED in another window isn't reverted here (we only
 * apply present overrides) — acceptable for the browse-in-one-window/work-in-another case.
 */
export function resyncFromStorage(): boolean {
  if (typeof window === "undefined") return false
  const stored = readUserItems()
  migrateStoredTaggedKey(stored)
  migrateStoredInputs(stored)
  migrateStoredRootId(stored)
  migrateStoredSessionsKey(stored)
  migrateStoredScheduleFields(stored)
  let changed = false

  const storedById = new Map(stored.entities.map((e) => [e.id, e]))

  // 1) DELETE — user entities that vanished from storage (deleted in another window).
  for (const id of [...userEntityIds]) {
    if (!storedById.has(id)) {
      if (removeEntityById(id)) {
        userEntityIds.delete(id)
        changed = true
      }
    }
  }

  // 2) ADD / UPDATE — from storage. New ones are pushed; existing user entities are
  //    updated IN PLACE (same object reference, so live consumers stay valid): drop keys
  //    no longer present, then copy the stored fields over.
  for (const raw of stored.entities) {
    const entity = raw
    migrateLegacyTime(entity)
    migrateWebTaskToResource(entity)
    migrateEventToMoment(entity)
    migrateCompletionToLog(entity)
    const existing = byId.get(entity.id)
    if (!existing) {
      entities.push(entity)
      byId.set(entity.id, entity)
      userEntityIds.add(entity.id)
      indexOverride(entity)
      changed = true
    } else if (userEntityIds.has(entity.id)) {
      for (const k of Object.keys(existing)) {
        if (!(k in entity)) delete (existing as unknown as Record<string, unknown>)[k]
      }
      Object.assign(existing, entity)
      indexOverride(existing)
      changed = true
    }
  }

  // 3) PINS + ORDER — replace wholesale (storage is authoritative after an external write).
  for (const k of Object.keys(pinnedByContext)) delete pinnedByContext[k]
  for (const [c, ids] of Object.entries(stored.pins)) {
    if (Array.isArray(ids) && ids.length) pinnedByContext[c] = [...ids]
  }
  for (const k of Object.keys(orderByContext)) delete orderByContext[k]
  for (const [c, ids] of Object.entries(stored.order)) {
    if (Array.isArray(ids) && ids.length) orderByContext[c] = [...ids]
  }
  changed = true

  // 4) SEED OVERRIDES — apply patches onto seeded entities (e.g. a color set elsewhere).
  for (const [id, patch] of Object.entries(stored.overrides)) {
    const e = byId.get(id)
    if (e && !userEntityIds.has(id)) {
      Object.assign(e, patch)
      seededOverrides.set(id, patch)
    }
  }

  // 5) TOMBSTONES — seed entities deleted in another window.
  for (const id of stored.deletedIds) {
    if (!userEntityIds.has(id) && byId.has(id) && removeEntityById(id)) {
      deletedSeededIds.add(id)
    }
  }

  return changed
}

/**
 * ON-DEMAND log↔scalar consistency audit over ALL current in-memory entities
 * (the `§ 5` dev chord). Unlike the hydrate-time check — which is dev-gated and
 * console-only — this runs anytime and returns the mismatches so the caller can
 * surface them in the packaged app (where NODE_ENV is production). Only entities
 * that carry a persisted log are checked; log-less ones read pure scalar fallback
 * and can't disagree. Non-mutating.
 */
export function runLogConsistencyAudit(): LogScalarMismatch[] {
  const out: LogScalarMismatch[] = []
  for (const entity of entities) out.push(...auditLogScalarConsistency(entity))
  return out
}

/**
 * Build a FULL, copy-pasteable diagnostic for the `§ 5` audit — everything needed to
 * debug a mismatch without a follow-up round: the count, plus for each affected entity
 * its id/kind/title, its COMPLETE `log` array, and every raw lifecycle scalar. Returned
 * as a formatted JSON string so the chord can drop it on the clipboard. `count: 0` means
 * consistent. Non-mutating.
 */
export function buildLogAuditReport(): { count: number; text: string } {
  const mismatches = runLogConsistencyAudit()
  // Group the flat mismatch list by entity so each affected entity is dumped once.
  const affectedIds = [...new Set(mismatches.map((m) => m.id))]
  const detail = affectedIds.map((id) => {
    const e = byId.get(id)
    return {
      id,
      kind: e?.kind,
      title: e?.title,
      axes: mismatches.filter((m) => m.id === id).map((m) => ({ axis: m.axis, log: m.fromLog, scalar: m.fromScalar })),
      log: e?.log ?? null,
      scalars: e
        ? {
            done: e.done,
            doneOn: e.doneOn,
            closed: e.closed,
            closedOn: e.closedOn,
            reopened: e.reopened,
            reopenedOn: e.reopenedOn,
            cancelled: e.cancelled,
            cancelledOn: e.cancelledOn,
            creationDate: e.creationDate,
          }
        : null,
    }
  })
  const report = {
    kind: "zero-entity-log-audit",
    at: new Date().toISOString(),
    mismatchCount: mismatches.length,
    affectedEntityCount: affectedIds.length,
    detail,
  }
  return { count: mismatches.length, text: JSON.stringify(report, null, 2) }
}

export function addTask(input: { title: string; contextId: string }): Entity {
  const now = Date.now()
  const entity: Entity = {
    id: uid("t"),
    kind: "task",
    title: input.title,
    parentId: input.contextId,
    taggedContextIds: [],
    done: false,
    creationDate: now,
    // Birth is the first log entry; scalars above are the transitional backup. Via appendInstant so
    // it gets its per-entity id (1) like every other entry.
    log: appendInstant(undefined, makeInstant("created", now)),
    priority: "medium",
    tags: [],
  }
  entities.push(entity)
  byId.set(entity.id, entity)
  userEntityIds.add(entity.id)
  persist()
  return entity
}

/**
 * Create an entity from a PARSED create-field intent (see `create-parse.ts`) in one
 * write: a given `kind`, an optional `schedule` (span/point), and an optional already-
 * `done` state (logging a PAST activity). Unlike `addTask` + `changeEntityKind`,
 * this sets the exact schedule instead of the per-kind placeholder span, and stamps
 * `doneOn` when done — so "Slept --2330-0630" lands as a finished Moment in a
 * single persist. Mirrors `addTask`'s store bookkeeping (userEntityIds + persist).
 */
export function addParsedEntity(input: {
  title: string
  contextId: string
  kind: EntityKind
  schedule?: Schedule
  done?: boolean
}): Entity {
  const now = Date.now()
  const entity = makeEntity({
    // Kind-correct id prefix (matches the dedicated add* fns): task→t, moment→m,
    // instant→i, resource→r, space→s, community→c, organism→o, individual��n, soul→l.
    // Defaults to "t" for any kind without a dedicated prefix.
    id: uid(ID_PREFIX[input.kind] ?? "t"),
    kind: input.kind,
    title: input.title,
    parentId: input.contextId,
    taggedContextIds: [],
    creationDate: now,
    done: input.done ?? false,
    ...(input.done ? { doneOn: now } : {}),
    ...(input.schedule ? { schedule: input.schedule } : {}),
    // Tasks carry a priority + tags like `addTask` seeds; other kinds don't need them.
    ...(input.kind === "task" ? { priority: "medium" as TaskPriority, tags: [] } : {}),
  })
  // Seed the lifecycle log from the just-set scalars: a `created` entry, plus a
  // `done` entry when logging a PAST activity (input.done) — so "Slept …"
  // lands as a finished Moment WITH history in one persist.
  entity.log = buildLogFromScalars(entity)
  // Stamp the absolute midnight close for a scheduled moment/instant (or a done task,
  // e.g. a past-tense "Slept …" logged as already-done) so it time-closes tz-stably.
  entity.closeAt = computeCloseAt(entity, now)
  entities.push(entity)
  byId.set(entity.id, entity)
  userEntityIds.add(entity.id)
  persist()
  return entity
}

/**
 * Resolve a recurring mother's `schedule` to the CONCRETE single-day schedule for
 * the occurrence on `dayStart`: shift the anchor's wall-clock time-of-day onto that
 * day (DST-safe via setHours) and DROP `repeat` (an override is one fixed day, not a
 * series). Mirrors the per-day math in getTimelineOccurrences, including multi-block
 * days (D4): each block is projected onto `dayStart` and startAt/endAt mirror the
 * first/last span.
 */
function resolveOccurrenceSchedule(s: Schedule | undefined, dayStart: number): Schedule | undefined {
  if (!s) return undefined
  const anchor = s.at ?? s.startDate
  const resolved: Schedule = { ...s }
  delete resolved.repeat
  if (anchor == null) return resolved
  if (s.timeblocks && s.timeblocks.length > 0) {
    const timeblocks = shiftTimeblocksToDay(s.timeblocks, dayStart)
    resolved.timeblocks = timeblocks
    resolved.startDate = timeblocks[0].startAt
    resolved.endDate = timeblocks[timeblocks.length - 1].endAt
    return resolved
  }
  const a = new Date(anchor)
  const occ = new Date(dayStart)
  occ.setHours(a.getHours(), a.getMinutes(), a.getSeconds(), 0)
  const occStart = occ.getTime()
  const duration = isPlannedStart(s.startDate) && s.endDate != null ? s.endDate - s.startDate : 0
  if (s.at != null) {
    // Instant (point): collapse start/end onto the same shifted instant so a materialized
    // occurrence never inherits the anchor day's stale startAt/endAt (which would misplace it).
    resolved.at = occStart
    resolved.startDate = occStart
    resolved.endDate = occStart
  } else {
    resolved.startDate = occStart
    resolved.endDate = occStart + duration
  }
  return resolved
}

/**
 * MATERIALIZE-ON-TOUCH (D1). Turn one virtual occurrence of a recurring `seriesId`
 * on `dayStart` into a REAL "override" entity the first time the user touches that
 * day. Idempotent: returns the existing override if there already is one. The
 * override:
 *   - carries its own id (so opening/checking it acts on that day ALONE),
 *   - links back via `seriesId` + `recurrenceId` (NOT `parentId`, so it never leaks
 *     into the mother's do-list — see getChildren),
 *   - pins its own resolved single-day `schedule` (no `repeat`), and
 *   - CLONES the mother's content subtasks (D2) so each day is independently
 *     checkable/personalizable ("Tuesday = leg day").
 * The mother keeps its `repeat` rule as the source of truth; untouched days stay
 * virtual. Returns undefined only if the mother id is unknown.
 */
export function materializeOccurrence(seriesId: string, dayStart: number): Entity | undefined {
  const existing = occurrenceOverride(seriesId, dayStart)
  if (existing) return existing
  const mother = byId.get(seriesId)
  if (!mother) return undefined

    // The web-surface binding lives on EntityBase, so it carries over for any kind
  // (e.g. a recurring resource). `priority` is task-only, so it stays narrowed.
  const taskExtras = {
    ...(mother.kind === "task" && mother.priority ? { priority: mother.priority } : {}),
    ...(mother.webUrl ? { webUrl: mother.webUrl } : {}),
    ...(mother.webResourceId ? { webResourceId: mother.webResourceId } : {}),
  }

  // `kind` is dynamic (mirrors the mother), so build through the makeEntity boundary.
  const override: Entity = makeEntity({
    id: uid("occ"),
    kind: mother.kind,
    title: mother.title,
    parentId: mother.parentId,
    taggedContextIds: [...mother.taggedContextIds],
    seriesId,
    recurrenceId: dayStart,
    schedule: resolveOccurrenceSchedule(mother.schedule, dayStart),
    done: false,
    ...(mother.color ? { color: mother.color } : {}),
    ...(mother.description ? { description: mother.description } : {}),
    ...(mother.tags ? { tags: [...mother.tags] } : {}),
    ...taskExtras,
  })
  entities.push(override)
  byId.set(override.id, override)
  userEntityIds.add(override.id)
  indexOverride(override)

  // Clone the mother's CONTENT subtasks (its real children, never other overrides)
  // under this override so they can be checked/edited for this day independently.
  const subtasks = entities.filter((c) => c.parentId === seriesId && c.seriesId == null)
  for (const child of subtasks) {
    const clone: Entity = {
      ...child,
      id: uid("t"),
      parentId: override.id,
      taggedContextIds: [...child.taggedContextIds],
      done: false,
    }
    entities.push(clone)
    byId.set(clone.id, clone)
    userEntityIds.add(clone.id)
  }

  persist()
  return override
}

/**
 * Create a RESOURCE — a `resource` entity (diamond glyph) bound to a web
 * resource/URL. A URL is a thing the work DRAWS ON, so Zero models it as a
 * resource, never a task: opening it shows a web surface (live embed or
 * illustrative stand-in) instead of a do-list. This is the create path behind the
 * "type a URL / pick a resource" gesture. Title falls back to the resource/host
 * name when the user only supplied a URL.
 */
export function addWebResource(input: {
  title: string
  url: string
  contextId: string
  resourceId?: string
}): Entity {
  const entity: Entity = {
    id: uid("r"),
    kind: "resource",
    title: input.title,
    parentId: input.contextId,
    taggedContextIds: [],
    done: false,
    tags: [],
    webUrl: input.url,
    webResourceId: input.resourceId,
  }
  entities.push(entity)
  byId.set(entity.id, entity)
  userEntityIds.add(entity.id)
  persist()
  return entity
  }

  /**
   * Persist the fetched DISPLAY TITLE (real webpage <title>) for a web resource. The
   * entity's own `title` (the raw URL) is untouched — this only fills `displayTitle`, the label
   * shown in ENTITY CONTENT + breadcrumb. No-op when unchanged so a re-fetch doesn't churn
   * persistence. Mirrors the seeded/user split used by the other scalar setters. (Universal field
   * since v0.2.228, but only auto-populated here in the URL case — see EntityBase.displayTitle.)
   */
  export function setWebTitle(id: string, webTitle: string): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  const next = webTitle.trim()
  if (!next || next === stored.displayTitle) return false
  mutable(stored).displayTitle = next
  if (!userEntityIds.has(id)) {
  seededOverrides.set(id, { ...seededOverrides.get(id), displayTitle: next })
  }
  persist()
  return true
  }

  export function addSpace(input: { name: string; parentId: string }): Entity {
  const entity: Entity = {
    id: uid("s"),
    kind: "space",
    title: input.name,
    parentId: input.parentId,
  taggedContextIds: [],
  description: "",
  inputs: [],
  }
  entities.push(entity)
  byId.set(entity.id, entity)
  userEntityIds.add(entity.id)
  // A new space is, by default, PINNED into the dock of the context it was
  // created from — it reads as a first-class place immediately. The user can
  // demote it into the DO list later by unpinning it.
  pinItem(input.parentId, entity.id)
  persist()
  return entity
}

export function addMoment(input: { title: string; contextId: string }): Entity {
  const entity: Entity = {
    id: uid("m"),
    kind: "moment",
    title: input.title,
    parentId: input.contextId,
    taggedContextIds: [],
    // Defaults to a noon→1pm block TODAY (absolute epoch ms).
    schedule: { startDate: t(12), endDate: t(13) },
  }
  entities.push(entity)
  byId.set(entity.id, entity)
  userEntityIds.add(entity.id)
  persist()
  return entity
}

export function addInstant(input: { title: string; contextId: string }): Entity {
  // An instant is a single point in time (down-triangle). With no explicit time it
  // defaults to NOW — the moment of creation — so a fresh instant lands on the
  // now-marker (matches "a mark is a point acknowledged now"). The old noon default
  // was a temporary placeholder (and used the stale module-load START_OF_TODAY anchor,
  // so it wasn't even noon *today* on a long-running session).
  const entity: Entity = {
    id: uid("i"),
    kind: "instant",
    title: input.title,
    parentId: input.contextId,
    taggedContextIds: [],
    schedule: { at: Date.now() },
  }
  entities.push(entity)
  byId.set(entity.id, entity)
  userEntityIds.add(entity.id)
  persist()
  return entity
}

/**
 * Rough inline time parser for instant creation. Looks for a `--<time>` token
 * anywhere in the title — e.g. "Standup --4pm", "Ping --16:30", "Call --9:15am",
 * "Sync --7" — and returns the CLEANED title (token stripped) plus an absolute
 * epoch for TODAY at that time. No / invalid token → `{ title, at: undefined }`
 * and the caller keeps the default (now). Intentionally minimal: a proper time
 * picker comes later; this just lets the user scatter instants across the day.
 */
export function parseInstantTime(raw: string): { title: string; at?: number } {
  const m = raw.match(/\s*--\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (!m || m.index == null) return { title: raw.trim() }
  let h = parseInt(m[1], 10)
  const min = m[2] ? parseInt(m[2], 10) : 0
  const ampm = m[3]?.toLowerCase()
  if (ampm === "pm" && h < 12) h += 12
  if (ampm === "am" && h === 12) h = 0
  if (h > 23 || min > 59) return { title: raw.trim() } // out of range → ignore token
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const at = start.getTime() + h * 3_600_000 + min * 60_000
  const cleaned = (raw.slice(0, m.index) + raw.slice(m.index + m[0].length)).trim()
  return { title: cleaned || raw.trim(), at }
}

/** Set an instant's moment (absolute epoch ms). No-op unless the entity exists
 *  and is an instant. Persisted. */
export function setInstantAt(id: string, at: number): void {
  const entity = byId.get(id)
  if (!entity || entity.kind !== "instant") return
  entity.schedule = { ...entity.schedule, at }
  persist()
}

/** Set an entity's title (used as the inline draft commits its name). No-op if
 *  the id is unknown. Persisted. */
export function setEntityTitle(id: string, title: string): void {
  const entity = byId.get(id)
  if (!entity) return
  entity.title = title
  persist()
}

/**
 * Rename an entity AND record the change in its append-only title history, so a
 * historical view (e.g. the activity tracker) can label a past segment with the name
 * the entity had at that time. On the FIRST rename the PRIOR title is backfilled at the
 * entity's `creationDate` (or `now` if unknown), so the log is complete from birth; then
 * the new title is appended at `now`. `entity.title` stays the canonical current value.
 * No-op (returns false) if the id is unknown or the trimmed title is empty/unchanged.
 */
export function renameEntity(id: string, nextTitle: string, now = Date.now()): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  const title = nextTitle.trim()
  if (!title || title === stored.title) return false
  const entity = mutable(stored)
  const prior = entity.title
  const log: TitleEntry[] = entity.titleLog ? [...entity.titleLog] : [{ title: prior, at: entity.creationDate ?? now }]
  log.push({ title, at: now })
  entity.titleLog = log
  entity.title = title
  // DUAL-WRITE the rename into the UNIFIED log too, so an entity's whole life reads from one
  // list. `titleLog` stays as the derived mirror the activity tracker's `titleAt` folds today.
  logSet(entity, "title", title, now)
  if (!userEntityIds.has(id)) {
    // Seeded entity — persist title + history as an override so both survive refreshes.
    seededOverrides.set(id, { ...seededOverrides.get(id), title, titleLog: log })
  }
  persist()
  return true
}

/**
 * Set a task's completion and PERSIST it. Previously the glyph toggle only flipped
 * local component state, so a checkmark was lost the moment the row/window unmounted
 * — most visible on a recurrence occurrence (check a subtask, close, reopen → it was
 * back to unchecked). Writing through to the store fixes that for ALL tasks, and for
 * materialized occurrences it lands on the override's own cloned subtask, keeping each
 * day independent. No-op if the id is unknown.
 *
 * Named `setTaskDone` (v0.2.229) — the DONE marker is a TASK-ONLY axis (`hasDoneFlag` is true only
 * for Task in KIND_META; the early-return below enforces it), so the name states what the guard
 * already does. The `done`/`doneOn` fields still live on EntityBase (universal shape), but only a
 * Task ever gets them WRITTEN. */
export function setTaskDone(id: string, done: boolean): void {
  const stored = byId.get(id)
  if (!stored) return
  // Only kinds WITH a done flag (Task) hold a "done" checkmark.
  // Space/Resource only open⟷close; terminal kinds retire/die — ignore done writes on them.
  if (done && !hasDoneFlag(stored.kind)) return
  // Only append a log entry on a REAL state change (guards against redundant sets
  // adding duplicate done/undone Instants).
  const changed = isDone(stored) !== done
  const entity = mutable(stored)
  const now = Date.now()
  entity.done = done
  // Track WHEN it was marked done (cleared when un-checked) — part of every space's meta.
  entity.doneOn = done ? now : undefined
  // DONE is the soft "I did this" checkmark ��� its OWN axis. For a Task it DERIVES the
  // interim COMPLETE state (see getState/completeSince) and STAMPS the absolute midnight
  // close (`closeAt`) in the actor's local day, so the task files itself at the same real
  // instant for every viewer. Undone clears the stamped close.
  //
  // Done does NOT set the EXPLICIT complete verdict: a done task keeps its glyph OUTLINE
  // (checkmark only) and only FILLS once it is explicitly Completed or CLOSES at midnight.
  // We actively clear any explicit-complete here so tasks auto-completed by the OLD rule
  // (Done ⇒ Complete) revert to outline. MULTI-USER (future): a requested task's recipient
  // marks Done; only the owner (or a Complete action) sets the fill-driving verdict.
  entity.complete = undefined
  entity.completeOn = undefined
  entity.closeAt = done ? computeCloseAt(entity, now) : undefined
  // DUAL-WRITE: append the toggle to the lifecycle log (the source of truth for reads),
  // seeding a log from scalars first if this entity predates it. Scalars above remain
  // as the transitional backup.
  if (changed) {
    const log = ensureEntityLog(stored)
    stored.log = appendInstant(log, makeInstant(done ? "done" : "undone", entity.doneOn ?? now))
  }
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, {
      ...seededOverrides.get(id),
      done,
      doneOn: entity.doneOn,
      // Cleared: Done no longer implies the explicit complete verdict (see above).
      complete: undefined,
      completeOn: undefined,
      closeAt: entity.closeAt,
    })
  }
  // Marking DONE ends the entity's ONGOING (its `play` session) at the close moment so it stops
  // printing/spinning as ongoing — but KEEPS the `focus` access session open (v0.6.32 fix): a
  // done task you're still looking at keeps accruing ACCESS. Skipped on un-check (done=false)
  // — a reopened entity resumes ongoing on the next enter/dwell.
  if (done) closeSession(id, "play", now)
  persist()
}

/**
 * Change an entity's kind IN PLACE (same id/row), filling in sensible defaults
 * for the target kind's relevant fields. Used by the inline draft's glyph picker
 * so switching kind keeps the exact same list row (no remount/re-animate).
 *
 * Note: unlike `addSpace`, this intentionally does NOT auto-pin a space into the
 * dock — an inline-created space stays in the DO list (and stays selected), so
 * the keyboard create→open→sub-create chain keeps working. The user can pin it
 * later from the context menu.
 */
export function changeEntityKind(id: string, kind: EntityKind): void {
  const stored = byId.get(id)
  if (!stored || stored.kind === kind) return
  const entity = mutable(stored)
  entity.kind = kind
  if (kind === "task") {
    entity.done = entity.done ?? false
    entity.priority = entity.priority ?? "medium"
    entity.tags = entity.tags ?? []
  } else if (kind === "space") {
  entity.description = entity.description ?? ""
  entity.inputs = entity.inputs ?? []
  } else if (kind === "moment") {
    // Default a freshly-picked moment to a now → now+1h block (parity with the instant=now
    // default). The old noon→1pm `t(12)`/`t(13)` was a temporary scaffold on the stale
    // module-load anchor (not even today on a long-running session).
    const startNow = Date.now()
    entity.schedule = { startDate: startNow, endDate: startNow + 60 * 60 * 1000, ...entity.schedule }
  } else if (kind === "instant") {
    // Default a freshly-picked instant to NOW (moment of creation) — lands on the now-marker,
    // matches "a mark is a point acknowledged now". The old noon `t(12)` was a temporary
    // scaffold (and used the stale module-load anchor, so not even noon *today*).
    entity.schedule = { at: Date.now(), ...entity.schedule }
  } else if (kind === "resource" || kind === "community" || kind === "organism") {
    // All container-like: they hold things and carry a blurb. (Organism is the
  // only identity-triad kind that's user-creatable; individual/soul are seeded
  // system entities and never produced through this path.)
  entity.description = entity.description ?? ""
  entity.inputs = entity.inputs ?? []
  }
  // A row switched into a real kind should carry a lifecycle log (an inline draft
  // may have none yet); seed one from scalars if absent, then record the kind change.
  logSet(entity, "kind", kind)
  // Re-stamp (or clear) the midnight close for the new kind — a fresh moment/instant
  // gets one from its default schedule; switching away from those clears it.
  entity.closeAt = computeCloseAt(entity)
  persist()
}

/**
 * Apply a parsed natural-language schedule (see {@link ScheduleParse}) to an EXISTING
 * entity, upgrading it in place. This is the landing point for the NL → recurrence
 * slice: the do-list creates a plain task synchronously (so the create→select→open
 * gesture is untouched), then — once the async parse returns — calls this to retitle
 * the row, switch it to the parsed kind, and attach an absolute `Schedule` (including a
 * `repeat` rule for recurring phrases).
 *
 * All the timezone math happens HERE, on the client, where local "today" is known. The
 * model only ever emits relative fields (a time-of-day, a duration, "until in N days"),
 * so it can never hallucinate an epoch. This deliberately writes ONE entity carrying the
 * rule — occurrences stay virtual (expanded by getTimelineOccurrences) — matching Zero's
 * rule-as-truth model; we do NOT materialize 365 child rows here.
 *
 * Returns true if the entity existed and was updated.
 */
export function applyParsedSchedule(id: string, plan: ScheduleParse): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  // Mutated in place: retitle, switch kind, attach schedule (see `mutable`).
  const entity = mutable(stored)

  if (plan.title.trim()) entity.title = plan.title.trim()

  // Nothing time-related — just keep the (now retitled) plain task.
  if (!plan.isSchedule) {
    persist()
    return true
  }

  entity.kind = plan.kind

  // Local midnight today, and the time-of-day for the (first) occurrence.
  const today0 = (() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  })()
  const hour = plan.startHour ?? 9
  const minute = plan.startMinute ?? 0
  const timeOfDayMs = hour * 3_600_000 + minute * 60_000

  // Build the repeat rule first; its byWeekday also drives where the ANCHOR day lands so
  // the weekly week-phase is correct from day one.
  let repeat: Recurrence | undefined
  if (plan.repeat) {
    const r = plan.repeat
    repeat = { freq: r.freq }
    if (r.interval && r.interval > 1) repeat.interval = r.interval
    if (r.freq === "weekly" && r.byWeekday && r.byWeekday.length > 0) {
      repeat.byWeekday = [...new Set(r.byWeekday)].sort((a, b) => a - b)
    }
    if (r.untilInDays != null) {
      // Inclusive end: end of the day N days from today.
      repeat.until = today0 + r.untilInDays * DAY_MS + (DAY_MS - 1)
    }
  }

  // ANCHOR DAY: the first day on/after today the series actually lands on. For a weekly
  // rule with explicit weekdays, advance to the first allowed weekday so dayMatchesRecurrence
  // (which anchors on this start) computes the right phase; otherwise today.
  let anchorDay = today0
  if (repeat?.freq === "weekly" && repeat.byWeekday && repeat.byWeekday.length > 0) {
    for (let i = 0; i < 7; i++) {
      const d = new Date(today0 + i * DAY_MS)
      if (repeat.byWeekday.includes(d.getDay())) {
        anchorDay = today0 + i * DAY_MS
        break
      }
    }
  }
  const startAt = anchorDay + timeOfDayMs

  // MULTI-TIMEBLOCK days (D4): build the within-day spans on the anchor day. Stored as
  // absolute times there; the expander/materialize project them onto each matching
  // day. Only meaningful with 2+ timeblocks (a single one is just the normal span).
  const timeblocks =
    plan.timeblocks && plan.timeblocks.length >= 2
      ? plan.timeblocks
          .map((b) => ({
            startAt: anchorDay + b.startHour * 3_600_000 + b.startMinute * 60_000,
            endAt: anchorDay + b.endHour * 3_600_000 + b.endMinute * 60_000,
          }))
          .sort((a, b) => a.startAt - b.startAt)
      : undefined

  if (plan.kind === "instant") {
    // Zero-duration point: at === startAt === endAt (uniform with setEntityScheduleField's
    // instant normalization), so it renders as a dayline point and never reads ongoing.
    entity.schedule = { at: startAt, startDate: startAt, endDate: startAt, ...(repeat ? { repeat } : {}) }
  } else if (plan.kind === "moment" || plan.kind === "space") {
  if (plan.kind === "space") {
  entity.description = entity.description ?? ""
  entity.inputs = entity.inputs ?? []
  }
    if (timeblocks) {
      entity.schedule = {
        startDate: timeblocks[0].startAt,
        endDate: timeblocks[timeblocks.length - 1].endAt,
        timeblocks,
        ...(repeat ? { repeat } : {}),
      }
    } else {
      const durMin = plan.durationMinutes ?? 60
      entity.schedule = { startDate: startAt, endDate: startAt + durMin * 60_000, ...(repeat ? { repeat } : {}) }
    }
  } else {
    // task: keep it a task, but attach timing. A recurring task carries the repeat rule;
    // a one-off task with a deadline gets dueDate.
    const sched: NonNullable<Entity["schedule"]> = {}
    if (repeat) {
      sched.startDate = startAt
      sched.repeat = repeat
    } else if (plan.dueInDays != null) {
      sched.dueDate = today0 + plan.dueInDays * DAY_MS + timeOfDayMs
    }
    entity.schedule = Object.keys(sched).length > 0 ? sched : entity.schedule
    entity.done = entity.done ?? false
    entity.priority = entity.priority ?? "medium"
  }

  persist()
  return true
}

/**
 * Mark a task as SENT-as-request (or clear it). For now this only toggles the
 * `requested` flag — there is no recipient or delivery; the visible effect is the
 * glyph sprouting its tilted "sent" edge. Kept separate from `changeEntityKind`
 * because a request is an overlay on an existing kind, not a different kind.
 */
export function setEntityRequested(id: string, requested: boolean): void {
  const stored = byId.get(id)
  if (!stored) return
  const entity = mutable(stored)
  entity.requested = requested
  logSet(entity, "requested", requested)
  if (!userEntityIds.has(id)) {
  // Seeded entity — track as an override patch so the sent state survives refreshes.
  seededOverrides.set(id, { ...seededOverrides.get(id), requested })
  }
  persist()
  }

/**
 * Set (or CLEAR) a single absolute time field on an entity's schedule, in place. This is
 * the write-side of the create-field self-setters (`:start:`/`:end:` → startDate/endDate).
 * Passing `null` removes that field; all OTHER schedule fields are preserved (so setting
 * start doesn't wipe end). If the entity had no schedule yet, one is created. Returns
 * true when the entity existed. The `field` key doubles as the log field name.
 */
export function setEntityScheduleField(
  id: string,
  field: "startDate" | "endDate" | "at" | "dueDate",
  epoch: number | null,
  ): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  const entity = mutable(stored)
  const sched: NonNullable<Entity["schedule"]> = { ...(entity.schedule ?? {}) }
  // An INSTANT is a ZERO-DURATION POINT — its start and end coincide. ANY concrete time set on
  // start/end/at collapses all three to that one epoch, so it can never carry a dangling
  // `startAt` with no `endAt` (which the dayline would paint as an open-ended ONGOING span — the
  // v0.6.9 regression). Clearing removes all three. `at` stays the canonical anchor.
  const isInstant = entity.kind === "instant"
  if (isInstant) {
  if (epoch == null) {
  delete sched.startDate
  delete sched.endDate
  delete sched.at
  } else {
  sched.startDate = epoch
  sched.endDate = epoch
  sched.at = epoch
  }
  } else if (epoch == null) delete sched[field]
  else sched[field] = epoch
  entity.schedule = sched
  // Instant logs the COINCIDENT open + close as a pair (start, then its matching end) so its
  // life log reads a close right after the start. Other kinds log the single field set.
  if (isInstant && epoch != null) {
  logSet(entity, "startAt", epoch)
  logSet(entity, "endAt", epoch)
  } else {
  logSet(entity, field, epoch)
  }
  // Re-stamp the absolute midnight close whenever a MOMENT/INSTANT's end (or point)
  // changes, so its time-close stays tz-stable and in sync with the new schedule. Tasks
  // stamp on Done instead, not from `dueDate`, so they're unaffected here.
  if (entity.kind === "moment" || entity.kind === "instant") {
  entity.closeAt = computeCloseAt(entity)
  }
  if (!userEntityIds.has(id)) {
  // Seeded entity — persist as an override patch so the value survives refreshes.
  seededOverrides.set(id, { ...seededOverrides.get(id), schedule: sched, closeAt: entity.closeAt })
  }
  persist()
  return true
  }

  /**
   * Set (or clear) an entity's explicit DURATION, in MINUTES (`Schedule.duration`).
   * Kind-agnostic and INDEPENDENT of any start — a pure planned/actual length that
   * displays regardless of whether `startAt` is unset, "whenever", or a concrete time.
   * `minutes == null` clears it (falls back to derived span/session/age length).
   * Mirrors `setEntityScheduleField`'s seeded-override handling so it survives refreshes.
   */
  export function setEntityDuration(id: string, minutes: number | null): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  const entity = mutable(stored)
  const sched: NonNullable<Entity["schedule"]> = { ...(entity.schedule ?? {}) }
  if (minutes == null) delete sched.duration
  else sched.duration = minutes
  entity.schedule = sched
  logSet(entity, "duration", minutes)
  if (!userEntityIds.has(id)) {
  seededOverrides.set(id, { ...seededOverrides.get(id), schedule: sched })
  }
  persist()
  return true
  }

  /**
   * Set (or clear) an entity's ACCENT color — the kind-agnostic display color used
   * on the dayline ticks and anywhere an entity paints itself. `hex` is a normalized
   * `#rrggbb` string (see `parseHexColor`); `null` clears it back to inherited/neutral.
   * Mirrors `setEntityScheduleField`'s seeded-override handling so a color set on a
   * seed entity survives refreshes.
   */
  export function setEntityAccent(id: string, hex: string | null): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  const entity = mutable(stored)
  if (hex == null) delete entity.color
  else entity.color = hex
  logSet(entity, "color", hex)
  if (!userEntityIds.has(id)) {
  seededOverrides.set(id, { ...seededOverrides.get(id), color: hex ?? undefined })
  }
  persist()
  return true
  }

// --- Provenance: creator + owner -------------------------------------------
// Single-user today, so both fall back to the current actor ("Loris" = ROOT_ID)
// for any entity written before provenance existed — no stamping or migration
// needed. The stored fields exist for the multi-user future (a task REQUESTED of
// or OWNED by someone else writes them explicitly).

/** The Individual that CREATED an entity (falls back to the current actor). */
export function getCreator(entity: Entity): string {
  return entity.createdBy ?? CURRENT_ACTOR_ID
}

/** The Individual that OWNS an entity's lifecycle — governs Complete + close policy.
 *  Falls back to the creator, then the current actor. */
export function getOwner(entity: Entity): string {
  return entity.ownerId ?? entity.createdBy ?? CURRENT_ACTOR_ID
}

/** One row of an Individual's ACTIVITY FEED — a log entry paired with the entity it happened on. */
export interface ActorFeedEntry {
  entry: Instant
  objectId: string
  /** The object entity's CURRENT title (what to render the action against). */
  objectTitle: string
  /** True when the entry is on the acting individual itself (keeps its bare self-phrasing). */
  isSelf: boolean
}

/**
 * The ACTIVITY FEED for one acting Individual (v0.2.283): every log entry ACROSS ALL entities that
 * was performed BY `actorId`, NEWEST FIRST. An entry's actor = `entry.by` when stamped, else the
 * OWNER of the entity the entry lives on ({@link getOwner} → `ownerId ?? createdBy ?? CURRENT_ACTOR_ID`).
 *
 * In today's single-user model this attributes the whole tree to the root Individual, so its §0 log
 * reads as a real diary of what the uzer did — "created X", "accessed Y", "marked Z done" — rather than
 * just the root entity's own lifecycle. It stays correct for a multi-actor future because an explicit
 * `by` or a non-default ownership routes an entry to the right person. Entries ON THE ACTOR ITSELF are
 * kept (so its own `created` / `bornAt = …` still show), flagged `isSelf` for bare phrasing.
 *
 * Skips soft-deleted entities and materialized recurrence occurrences (`seriesId != null`) — neither is
 * a real act. This is a pure read over the in-memory `entities`; no new stored data. The whole tree is
 * small, so a full scan per call is fine.
 */
export function getActorFeed(actorId: string): ActorFeedEntry[] {
  const out: ActorFeedEntry[] = []
  for (const e of entities) {
    if (e.deletedAt != null || e.seriesId != null) continue
    const log = e.log
    if (!log || log.length === 0) continue
    const owner = getOwner(e)
    const isSelf = e.id === actorId
    for (const entry of log) {
      const actor = entry.by ?? owner
      if (actor !== actorId) continue
      out.push({ entry, objectId: e.id, objectTitle: e.title, isSelf })
    }
  }
  // OLDEST FIRST (v0.2.284) — matches the per-entity LOG's chronological order so both read as a
  // timeline from the beginning (latest action at the bottom). Break same-ms ties by per-entity id
  // for a stable order.
  out.sort((a, b) => a.entry.at - b.entry.at || (a.entry.id ?? 0) - (b.entry.id ?? 0))
  return out
}

// --- Tag links (taggedContextIds): forward + DERIVED reverse ---------------

/** The contexts this entity is ALSO shown in — its own outbound tag links resolved
 *  to entities (missing ids dropped). */
export function getForwardTags(entity: Entity): Entity[] {
  return (entity.taggedContextIds ?? [])
    .map((tid) => byId.get(tid))
    .filter((e): e is Entity => e != null)
}

/** The DERIVED reverse of {@link getForwardTags}: every entity that tags `id`. The link
 *  is stored ONCE (on the tagging child); the back-reference is computed here, so the two
 *  directions can never drift. */
export function getBackReferences(id: string): Entity[] {
  const out: Entity[] = []
  for (const e of entities) {
    if (e.id === id) continue
    if (e.taggedContextIds?.includes(id)) out.push(e)
  }
  return out
}

// --- Auto-tag by title -----------------------------------------------------

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Whole-word phrase match with light singular/plural tolerance. `hay` is lowercase. */
function titlePhraseMatches(hay: string, needleRaw: string): boolean {
  const needle = needleRaw.toLowerCase().trim()
  if (!needle) return false
  const variants = new Set([needle])
  if (needle.endsWith("s")) variants.add(needle.slice(0, -1))
  else variants.add(needle + "s")
  for (const v of variants) {
    if (new RegExp(`\\b${escapeRegExp(v)}\\b`).test(hay)) return true
  }
  return false
}

/**
 * Auto-tag a freshly created entity against the rest of the tree: for every OTHER,
 * non-closed entity whose TITLE occurs as a whole-word phrase inside the new entity's
 * title, add a `taggedContextIds` link (so "Work on Zero" surfaces under the Space
 * "Zero"). Case-insensitive with singular/plural tolerance; skips self, the new
 * entity's own parent (redundant with `parentId`), the root/soul scaffold, and any
 * closed/cancelled entity. When `inheritAccent` and the new entity has no own accent,
 * it adopts the first match's accent. Persists. Returns the matched entities.
 */
export function autoTagByTitle(
  newId: string,
  opts: { inheritAccent: boolean } = { inheritAccent: true },
): Entity[] {
  const stored = byId.get(newId)
  if (!stored) return []
  const hay = stored.title.toLowerCase()
  if (!hay.trim()) return []
  const matched: Entity[] = []
  for (const cand of entities) {
    if (cand.id === newId) continue
    if (cand.id === ROOT_ID || cand.kind === "soul") continue
    // v0.2.204: NEVER auto-tag into a context that is already an ANCESTOR (or the direct parent)
    // of the new entity. An entity created under Space "Zero" will naturally have "Zero" in its
    // title, but it's already a child of Zero — tagging it back to its own ancestor produced a
    // ghost: the item then showed BOTH under its real parent and under the ancestor (getChildren
    // matches parentId OR taggedContextIds), which read as a duplicate. `isInSubtree(cand.id,
    // newId)` is true when the new entity is cand itself or a descendant of cand → skip those.
    if (isInSubtree(cand.id, newId)) continue
    if (cand.title.trim().length < 2) continue // ignore 1-char titles (noise)
    if (isClosed(cand)) continue
    if (titlePhraseMatches(hay, cand.title)) matched.push(cand)
  }
  if (matched.length === 0) return []
  const entity = mutable(stored)
  const links = new Set(entity.taggedContextIds ?? [])
  for (const m of matched) links.add(m.id)
  entity.taggedContextIds = [...links]
  if (opts.inheritAccent && entity.color == null) {
    const inherited = matched[0].color ?? getInheritedAccent(matched[0].id)
    if (inherited) entity.color = inherited
  }
  if (!userEntityIds.has(newId)) {
    seededOverrides.set(newId, {
      ...seededOverrides.get(newId),
      taggedContextIds: entity.taggedContextIds,
      color: entity.color,
    })
  }
  persist()
  return matched
}

// --- Close policy (owner-only) ---------------------------------------------

/**
 * Set an entity's CLOSE POLICY — OWNER-ONLY (no-op + false if the current actor isn't the
 * owner, or the id is unknown). `"manual"` opts out of the automatic midnight time-close
 * and clears any stamped `closeAt`; `"auto"` (or `null` to clear the field) restores it,
 * re-stamping `closeAt` from the schedule/done state via {@link computeCloseAt}. A manual
 * Close/Cancel still applies under either policy ��� this only governs the AUTOMATIC path.
 */
export function setEntityClosePolicy(id: string, policy: "auto" | "manual" | null): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  if (getOwner(stored) !== CURRENT_ACTOR_ID) return false
  const entity = mutable(stored)
  if (policy === "manual") {
    entity.closePolicy = "manual"
    delete entity.closeAt
  } else {
    if (policy === "auto") entity.closePolicy = "auto"
    else delete entity.closePolicy
    const stamped = computeCloseAt(stored)
    if (stamped != null) entity.closeAt = stamped
  }
  logSet(entity, "closePolicy", policy)
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, {
      ...seededOverrides.get(id),
      closePolicy: entity.closePolicy,
      closeAt: entity.closeAt,
    })
  }
  persist()
  return true
}

  /**
   * Set (or clear) an INDIVIDUAL's biological `sex` ("man" | "woman"), in place. Individual-
   * only (returns false for any other kind). Logs the change to the unified lifecycle log and
   * mirrors `setEntityAccent`'s seeded-override handling so it survives refreshes.
   */
  export function setEntitySex(id: string, sex: Sex | null): boolean {
  const stored = byId.get(id)
  if (!stored || stored.kind !== "individual") return false
  const entity = mutable(stored)
  if (sex == null) delete (entity as IndividualEntity).sex
  else (entity as IndividualEntity).sex = sex
  logSet(entity, "sex", sex)
  if (!userEntityIds.has(id)) {
  seededOverrides.set(id, { ...seededOverrides.get(id), sex: sex ?? undefined } as Partial<Entity>)
  }
  persist()
  return true
  }

  /**
   * Set (or clear) an INDIVIDUAL's confirmed `bornAt` birthday (epoch ms), in place. Individual-
   * only (returns false for any other kind). `bornAt` is the SOURCE OF TRUTH for the `alive` state
   * (a past value ⇒ alive; a future one ⇒ still "expected") and drives the AGE row — SEPARATE from
   * the generic planned `schedule.startAt`. Logs the change and mirrors setEntitySex's seeded-
   * override handling so a change to a seeded individual (e.g. the root "0") survives refreshes.
   */
  export function setEntityBornAt(id: string, bornAt: number | null): boolean {
  const stored = byId.get(id)
  if (!stored || stored.kind !== "individual") return false
  // A birth is a RECORDED PAST FACT — reject a future `bornAt` (v0.2.229). "Expected"/scheduled for a
  // being must come from a FUTURE PLANNED START (`schedule.startDate`), never from a future birthday.
  // Clearing (null) is always allowed.
  if (bornAt != null && bornAt > Date.now()) return false
  const entity = mutable(stored)
  if (bornAt == null) delete (entity as IndividualEntity).bornAt
  else (entity as IndividualEntity).bornAt = bornAt
  logSet(entity, "bornAt", bornAt)
  if (!userEntityIds.has(id)) {
  seededOverrides.set(id, { ...seededOverrides.get(id), bornAt: bornAt ?? undefined } as Partial<Entity>)
  }
  persist()
  return true
  }

/**
 * Set (or clear) an INDIVIDUAL's `firstName` / `lastName` — STRUCTURED identity fields kept
 * SEPARATE from the display `title` (this never rewrites the title). Individual-only (returns
 * false for any other kind). Empty/`null` clears the slot. Mirrors {@link setEntitySex}'s log +
 * seeded-override handling so a change to a seeded individual (e.g. the root "0") survives refreshes.
 */
function setIndividualName(id: string, field: "firstName" | "lastName", value: string | null): boolean {
  const stored = byId.get(id)
  if (!stored || stored.kind !== "individual") return false
  const entity = mutable(stored)
  const v = value?.trim() ? value.trim() : null
  if (v == null) delete (entity as IndividualEntity)[field]
  else (entity as IndividualEntity)[field] = v
  logSet(entity, field, v)
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), [field]: v ?? undefined } as Partial<Entity>)
  }
  persist()
  return true
}
export const setEntityFirstName = (id: string, name: string | null) => setIndividualName(id, "firstName", name)
export const setEntityLastName = (id: string, name: string | null) => setIndividualName(id, "lastName", name)

/** Kinds that carry a `parents` relation — the terminal BEINGS Individual + Organism (v0.2.229). */
const KINDS_WITH_PARENTS = new Set<EntityKind>(["individual", "organism"])

/**
 * Set (or clear) a BEING's `parents` — the list of parent ids (a real relation, like
 * `taggedContextIds`). Allowed on the two parent-bearing kinds: an INDIVIDUAL (parent people) and
 * an ORGANISM (parent company / institution). `null`/empty clears it entirely. Ids are stored
 * verbatim (the caller resolves names → ids via {@link findEntityByTitle}, matching the being's OWN
 * kind). Mirrors setEntitySex's log + seeded-override handling.
 */
export function setEntityParents(id: string, parentIds: string[] | null): boolean {
  const stored = byId.get(id)
  if (!stored || !KINDS_WITH_PARENTS.has(stored.kind)) return false
  const entity = mutable(stored)
  const withParents = entity as { parents?: string[] }
  const next = parentIds && parentIds.length > 0 ? [...new Set(parentIds)] : null
  if (next == null) delete withParents.parents
  else withParents.parents = next
  logSet(entity, "parents", next ? next.join(",") : null)
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), parents: next ?? undefined } as Partial<Entity>)
  }
  persist()
  return true
}

/**
 * Resolve a typed NAME to an existing entity of one of the ALLOWED KINDS by case-insensitive exact
 * title match (used by the `--parent:<name>` setter). The allowed set is the child's own "who can
 * be a parent" rule: an Individual's parent is an Individual; an Organism's parents (its FOUNDERS)
 * are Organisms OR Individuals — zero or more of each. Accepts a single kind or a list; returns the
 * first match across the entity order, or null when none. Kept simple (exact, trimmed, lowercased)
 * so it's predictable; disambiguation by richer keys can come later.
 */
export function findEntityByTitle(name: string, kinds: EntityKind | EntityKind[]): Entity | null {
  const needle = name.trim().toLowerCase()
  if (!needle) return null
  const allowed = Array.isArray(kinds) ? kinds : [kinds]
  for (const e of entities) {
    if (allowed.includes(e.kind) && e.title.trim().toLowerCase() === needle) return e
  }
  return null
}

/** Which kinds may be a PARENT of a given child kind (the `--parent:` resolution set). Individual
 *  parents are Individuals; Organism parents (FOUNDERS) are Organisms OR Individuals. */
export function parentKindsFor(childKind: EntityKind): EntityKind[] {
  if (childKind === "organism") return ["organism", "individual"]
  if (childKind === "individual") return ["individual"]
  return []
}

  /**
   * PUBLISH / UNPUBLISH an entity, in place — the Publish menu toggle. `published:true` stamps
   * `publishedAt = now`; `false` clears it. Offered on EVERY kind EXCEPT Soul (returns false for a
   * soul). For an ORGANISM / COMMUNITY this is the ALIVE toggle (parallel to setEntityBornAt for an
   * Individual): publishing makes it `alive` (and undeletable), unpublishing returns it to a draft.
   * For other kinds it just flips the published flag (surfaced in §0). Logs + mirrors the seeded-
   * override handling so a change to a seeded entity survives refreshes.
   */
  export function setEntityPublished(id: string, published: boolean): boolean {
  const stored = byId.get(id)
  if (!stored || stored.kind === "soul") return false
  const entity = mutable(stored)
  const at = published ? Date.now() : null
  if (at == null) delete entity.publishedAt
  else entity.publishedAt = at
  logSet(entity, "publishedAt", at)
  if (!userEntityIds.has(id)) {
  seededOverrides.set(id, { ...seededOverrides.get(id), publishedAt: at ?? undefined } as Partial<Entity>)
  }
  persist()
  return true
  }

/**
 * Set (or clear) an entity's MANUAL `hidden` flag (right-click ▸ Hide / Unhide), in place.
 * Works on any kind. Hiding only removes the entity from its parent's ENTITY CONTENT
 * listing (see the canvas child filter) — relationships, counts, and the timeline are
 * untouched. Logs the change to the unified lifecycle log and mirrors `setEntityAccent`'s
 * seeded-override handling so it survives refreshes.
 */
export function setEntityHidden(id: string, hidden: boolean): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  const entity = mutable(stored)
  // Store the LITERAL boolean (tri-state with `undefined`): true = manually hidden, false =
  // explicitly UNHIDDEN (pins the row visible, overriding the derived auto-hide so "Unhide"
  // reveals an auto-hidden entity too — the fix for the "Unhide did nothing" bug). We no longer
  // delete the key, because `false` must persist to beat the auto rule.
  entity.hidden = hidden
  logSet(entity, "hidden", hidden)
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), hidden } as Partial<Entity>)
  }
  persist()
  return true
}

/**
 * Low-level removal of a single entity from the in-memory store + indexes, plus
 * any pin references to it. Does NOT recurse or persist — callers handle that.
 * Returns true if the entity existed.
 */
function removeEntityById(id: string): boolean {
  const idx = entities.findIndex((e) => e.id === id)
  if (idx === -1) return false
  entities.splice(idx, 1)
  byId.delete(id)
  userEntityIds.delete(id)
  seededOverrides.delete(id)
  // Drop any pins that referenced it, in any context.
  for (const [contextId, ids] of Object.entries(pinnedByContext)) {
    const i = ids.indexOf(id)
    if (i >= 0) ids.splice(i, 1)
    if (ids.length === 0) delete pinnedByContext[contextId]
  }
  return true
}

/**
 * DELETE an entity — SOFT + reversible (v0.3.8x). Deleting no longer removes anything: it
 * stamps `deletedAt`, which drops the entity (and its whole subtree, since the parent is now
 * unlisted) from every listing + rollup. The subtree is left intact so {@link restoreEntity}
 * undoes it by clearing that one stamp. Restore is reached from the container's right-click ▸
 * Deleted list.
 *
 * GUARDED by {@link canDeleteEntity}: a deletable kind that is either a non-life-being (deletable
 * in ANY state — so hidden/closed tasks·moments·spaces CAN be trashed) or a life-being not yet on
 * the record. `opts.byUzer0` bypasses the guard (system actor). Reversible via {@link restoreEntity};
 * a SECOND delete on the trashed row is the permanent {@link hardDeleteEntity}. Returns true if the
 * entity was (soft-)deleted. Seeded entities record an override so it survives refreshes.
 */
export function deleteEntity(id: string, opts?: { byUzer0?: boolean }): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  if (!canDeleteEntity(stored, opts)) return false
  const entity = mutable(stored)
  entity.deletedAt = Date.now()
  logSet(entity, "deleted", true)
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), deletedAt: entity.deletedAt } as Partial<Entity>)
  }
  persist()
  return true
}

/**
 * RESTORE (undelete) a soft-deleted entity — clears `deletedAt`, bringing it (and its whole
 * subtree) back into listings exactly where it was. Mirrors {@link setEntityHidden}'s
 * seeded-override handling so the restore survives refreshes. Returns true if it existed.
 */
export function restoreEntity(id: string): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  const entity = mutable(stored)
  delete entity.deletedAt
  logSet(entity, "deleted", false)
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), deletedAt: undefined } as Partial<Entity>)
  }
  persist()
  return true
}

/**
 * PERMANENT removal (hard delete) of an entity + its whole origin subtree — irreversible. Wired to
 * the menu as the SECOND delete: right-clicking an already-soft-deleted child in the container's
 * "Restore deleted" submenu offers "Delete permanently" (`purge:<id>`), the industry-standard
 * two-step trash→purge. Seeded entities leave a tombstone (`deletedSeededIds`) so the removal
 * survives refreshes; user-created ones are simply dropped.
 */
export function hardDeleteEntity(id: string): void {
  // Collect the entity and all descendants via origin parent links.
  const toDelete: string[] = []
  const collect = (targetId: string) => {
    toDelete.push(targetId)
    for (const e of entities) {
      if (e.parentId === targetId) collect(e.id)
    }
  }
  collect(id)

  for (const targetId of toDelete) {
    const wasSeeded = !userEntityIds.has(targetId) && byId.has(targetId)
    if (removeEntityById(targetId) && wasSeeded) {
      deletedSeededIds.add(targetId)
    }
  }
  persist()
}

/**
 * Cancel (or un-cancel) any entity. It stays on the timeline and in the DO list
 * but renders dimmed with a struck-through title. Seeded items record a partial
 * override so the state survives refreshes.
 */
export function setEntityCancelled(id: string, cancelled: boolean): void {
  const entity = byId.get(id)
  if (!entity) return
  const now = Date.now()
  entity.cancelled = cancelled
  // Phase 2b: track WHEN, so cancel folds into the log as a timestamped Instant.
  entity.cancelledOn = now
  // DUAL-WRITE: append the cancel/restore to the lifecycle log (source of truth for
  // reads via isCancelled), seeding from scalars first if absent. Scalars remain the
  // transitional backup.
  const log = ensureEntityLog(entity)
  entity.log = appendInstant(log, makeInstant(cancelled ? "cancelled" : "restored", now))
  if (!userEntityIds.has(id)) {
    // Seeded entity — track as an override patch (log rebuilt from these on reload).
    seededOverrides.set(id, { ...seededOverrides.get(id), cancelled, cancelledOn: now })
  }
  // Cancelling ENDS the ongoing (`play`) session, keeping `focus`/access (see setTaskDone;
  // v0.6.32). Not on restore.
  if (cancelled) closeSession(id, "play", now)
  persist()
}

/**
 * CLOSE or REOPEN an entity's MANUAL close flag (a PLAIN close only fades the row —
 * it does NOT fill the glyph; fill is reserved for Complete).
 *  - CLOSE (`closed=true`): sets the manual `closed` flag and clears any prior
 *    `reopened` override.
 *  - REOPEN (`closed=false`): clears the manual `closed` flag AND sets `reopened`,
 *    which overrides a DERIVED close via {@link isClosed}. NOTE: to fully reopen an
 *    entity that ended for ANY reason (complete / cancel / close), call the
 *    higher-level {@link reopenEntity} — it clears all three axes; this only handles
 *    the manual close axis.
 * Seeded items record a partial override so the state survives refreshes.
 */
export function setEntityClosed(id: string, closed: boolean): void {
  const entity = byId.get(id)
  if (!entity) return
  const now = Date.now()
  const closedOn = closed ? now : undefined
  const reopened = !closed
  const reopenedOn = reopened ? now : undefined
  entity.closed = closed
  entity.closedOn = closedOn
  entity.reopened = reopened
  entity.reopenedOn = reopenedOn
  // DUAL-WRITE: append the Close/Reopen to the lifecycle log (source of truth for
  // reads via getCloseState), seeding from scalars first if absent. For SEEDED
  // entities this log lives only for the session — the override patch below carries
  // the scalars, and the migration rebuilds the log on reload.
  const log = ensureEntityLog(entity)
  entity.log = appendInstant(log, makeInstant(closed ? "closed" : "reopened", now))
  if (!userEntityIds.has(id)) {
    // Seeded entity — track as an override patch.
    seededOverrides.set(id, { ...seededOverrides.get(id), closed, closedOn, reopened, reopenedOn })
  }
  // A manual Close ENDS the ongoing (`play`) session, keeping `focus`/access (see
  // setTaskDone; v0.6.32). Not on reopen.
  if (closed) closeSession(id, "play", now)
  persist()
}

/**
 * REOPEN an entity that ended for ANY reason. Since an entity can close via a few
 * routes — Cancel (called off), a plain Close, a DERIVED time-close, or a LEGACY
 * complete verdict from old data — there is a SINGLE return path, Reopen, which
 * clears whichever applied:
 *   1. un-cancel (if cancelled), 2. clear any legacy `complete` scalar, 3. lift the
 *      manual/derived close (`setEntityClosed(false)` sets the `reopened` override,
 *      which short-circuits BOTH the derived midnight/end rule AND the legacy
 *      complete read in {@link isClosed}). Leaves the entity DONE-but-open if it was
 *      done (checkmark stays, opacity returns to 1).
 */
export function reopenEntity(id: string): void {
  const stored = byId.get(id)
  if (!stored) return
  if (isCancelled(stored)) setEntityCancelled(id, false)
  // Clear the COMPLETE verdict + the stamped midnight close so a reopened entity can't
  // read as complete/closed again (the `reopened` override also suppresses the derived
  // rules, but clearing `closeAt` keeps the data honest).
  {
    const entity = mutable(stored)
    entity.complete = false
    entity.completeOn = undefined
    entity.closeAt = undefined
    if (!userEntityIds.has(id)) {
      seededOverrides.set(id, {
        ...seededOverrides.get(id),
        complete: false,
        completeOn: undefined,
        closeAt: undefined,
      })
    }
  }
  setEntityClosed(id, false)
}
