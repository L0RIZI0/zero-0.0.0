import type { Asset, Entity, EntityKind, IndividualEntity, Instant, Recurrence, Schedule, Resource, EntityBase, Session, Sex, TaskPriority, TitleEntry, User } from "./types"
import { WHENEVER } from "./types"
  import { hasDoneState, isClosed, computeCloseAt, getState, fillsGlyph, hasOpenSession, getOpenSession, setChildrenResolver, setContainedResolver, isConcreteStart, concreteStart } from "./kinds"
import {
  isDone,
  isCancelled,
  buildLogFromScalars,
  makeInstant,
  makeSet,
  appendInstant,
  auditLogScalarConsistency,
  } from "./entity-log"
import type { LogScalarMismatch } from "./entity-log"
import { readUserItems, writeUserItems } from "./persistence"
import type { UserItems } from "./persistence"
import type { ScheduleParse } from "./schedule-parse"

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
 * setEntityRequested, setEntityCompleted). The returned object is the SAME reference
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

/** Midnight (epoch ms) of the calendar day that the CURRENT 5am→5am "human day"
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
    // Loris's BIRTH — the Individual's creation. Built from local-time components
    // (month is 0-based, so 4 = May) so it round-trips through `toLocaleString()` as
    // 19 May 1991, 13:33 in whatever timezone/locale the reader is in.
  createdAt: new Date(1991, 4, 19, 13, 33, 0, 0).getTime(),
  // Loris is a man.
  sex: "man",
  // Root canvas starts as a FRESH tree: the Individual owns no resources yet, and
  // has no space/task children. Everything below is grown by the user at runtime.
  assignedResourceIds: [],
  },
  // --- WEB-PREVIEW SAMPLE SET ----------------------------------------------
  // A minimal, legible sample under the Individual: ONE of each core kind so the web
  // preview has something to interact with, plus a second Space "Edan" whose start is
  // WHENEVER (a playable one — its glyph offers Play/Stop). Accents per Loris's spec:
  // blue space · purple moment · pink instant · green resource · amber Edan; the Task is
  // left uncoloured. The green Resource points at the internal `/matrix-interactions`
  // doc viewer, so it doubles as the one-click matrix link the preview used to carry.
  //
  // These are demo fixtures (they never persist — only user mutations hit localStorage)
  // and are EXCLUDED from the packaged DESKTOP export via NEXT_PUBLIC_ZERO_ELECTRON, so
  // dogfooding on the Surface app still starts from a clean tree.
  ...(process.env.NEXT_PUBLIC_ZERO_ELECTRON !== "1"
    ? ([
        { id: "seed_space", kind: "space", title: "Space", parentId: ROOT_ID, taggedContextIds: [], accent: "#4A90E2" },
        { id: "seed_task", kind: "task", title: "Task", parentId: ROOT_ID, taggedContextIds: [], completed: false },
        { id: "seed_moment", kind: "moment", title: "Moment", parentId: ROOT_ID, taggedContextIds: [], accent: "#A855F7" },
        { id: "seed_instant", kind: "instant", title: "Instant", parentId: ROOT_ID, taggedContextIds: [], accent: "#EC4899" },
        {
          id: "seed_edan",
          kind: "space",
          title: "Edan",
          parentId: ROOT_ID,
          taggedContextIds: [],
          accent: "#F5A623",
          schedule: { startAt: WHENEVER },
        },
        {
          id: "r_matrix",
          kind: "resource",
          title: "Interaction Matrix",
          parentId: ROOT_ID,
          taggedContextIds: [],
          accent: "#2ECC71",
          completed: false,
          tags: [],
          webUrl: "/matrix-interactions",
        },
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
      // Materialized recurrence occurrences (overrides) are timeline instances, not
      // do-list children �� they must never leak into any listing (the round-27 trap).
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

// Wire getChildren into kinds.ts so child-gated Task completion (a Done task isn't
// COMPLETE until all its `kind==="task"` children are) can resolve children without a
// circular import (kinds is the lower module). One-time, at module load.
setChildrenResolver(getChildren)

// Wire a CONTAINMENT-ONLY resolver (parentId links, NEVER taggedContextIds, and NEVER
// materialized recurrence occurrences) for the ongoing ROLLUP: a Space is ongoing while a
// CONTAINED descendant runs, but a merely tagged-in ongoing entity must NOT light it up.
setContainedResolver((contextId) => entities.filter((e) => e.parentId === contextId && e.seriesId == null))

/**
 * Whether `childId` has an IN-PLACE owning node inside `hostId` — i.e. it would
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
    if (current.kind === "space" && current.accent) return current.accent
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return undefined
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
 *  (identity scaffold + containers) are excluded — you don't quick-create a Space "now". */
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
    const created = e.createdAt ?? 0
    let b = buckets.get(key)
    if (!b) {
      b = { kind: e.kind, members: [], windowCount: 0, latest: e, parentCounts: new Map() }
      buckets.set(key, b)
    }
    b.members.push(e)
    if (created >= since) b.windowCount++
    if (created >= (b.latest.createdAt ?? 0)) b.latest = e
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
      .map((m) => ({ m, word: getState(m, now).word }))
      .filter((x) => x.word === "ongoing" || x.word === "complete")
      .sort((a, c) => (concreteStart(a.m) ?? 0) - (concreteStart(c.m) ?? 0))
      .map((x) => ({
        id: x.m.id,
        kind: x.m.kind,
        title: x.m.title,
        startAt: concreteStart(x.m) ?? now,
        endAt: x.m.schedule?.endAt ?? null,
        state: x.word as "ongoing" | "complete",
        filled: fillsGlyph(x.m),
      }))
    const ongoingCount = instances.reduce((n, i) => n + (i.state === "ongoing" ? 1 : 0), 0)
    // ACCENT: the newest member that ACTUALLY carries one — NOT strictly `b.latest`, whose
    // accent may be undefined (a punched-in occurrence is created without a color, and being
    // newest would otherwise blank the tile dot). Falls back to any accented member.
    const accent = b.members
      .filter((m) => !!m.accent)
      .sort((a, c) => (c.createdAt ?? 0) - (a.createdAt ?? 0))[0]?.accent
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

/** Resources DIRECTLY assigned to a context (its own assignedResourceIds — not the subtree). */
export function getAssignedResources(contextId: string): Resource[] {
  const space = getSpace(contextId)
  if (!space) return []
  return (space.assignedResourceIds ?? [])
    .map((id) => resourceById.get(id))
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
    !!s && (s.startAt != null || s.endAt != null || s.at != null || s.dueAt != null)
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
 * Project a schedule's `blocks` (D4 multi-block days, stored as absolute times on
 * the anchor day) onto `dayStart`, preserving each block's wall-clock start-of-day
 * (DST-safe via setHours) and its duration. Returns blocks sorted by start. Used by
 * both the expander (virtual occurrences) and materializeOccurrence (overrides) so a
 * "Day Job 8–11:30 AND 13:30–18:00" rule lands those two spans on every matching day.
 */
function shiftBlocksToDay(
  blocks: { startAt: number; endAt: number }[],
  dayStart: number,
): { startAt: number; endAt: number }[] {
  return blocks
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
    // A point (`at`), a span start, or — for a due-only entity like a Task deadline —
    // the `dueAt` all serve as the timeline anchor, so a task with just a due date still
    // places a marker.
    // "whenever" is not a fixed time, so it can't anchor a timeline occurrence.
    const anchor = s.at ?? (isConcreteStart(s.startAt) ? s.startAt : undefined) ?? s.dueAt
    if (anchor == null) continue

    if (!s.repeat) {
      // One-off: pass through (the timeline clips to the viewport itself).
      out.push({ ...e, occKey: e.id })
      continue
    }

    const duration = isConcreteStart(s.startAt) && s.endAt != null ? s.endAt - s.startAt : 0
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
          if (s.blocks && s.blocks.length > 0) {
            // Multi-block day (D4): project every span onto this day; mirror
            // startAt/endAt to the first start / last end so single-span readers
            // (bounds, sorting) keep working without knowing about blocks.
            const blocks = shiftBlocksToDay(s.blocks, dayStart)
            schedule = { ...s, blocks, startAt: blocks[0].startAt, endAt: blocks[blocks.length - 1].endAt }
          } else if (s.at != null) {
            schedule = { ...s, at: occStart }
          } else {
            schedule = { ...s, startAt: occStart, endAt: occStart + duration }
          }
          out.push({ ...e, schedule, occKey: `${e.id}@${dayStart}` })
        }
      }
      cursor.setDate(cursor.getDate() + 1)
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

/** Persist a session mutation, mirroring setEntityScheduleField's seeded-override path. */
function persistSessionMutation(id: string, entity: LooseEntity, sched: Schedule): void {
  entity.schedule = sched
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), schedule: sched })
  }
  persist()
}

/**
 * OPEN a session on an entity if none is already open (idempotent). `kind` marks focus
 * punch-ins vs play stopwatches so hydrate-cleanup can close dangling focus sessions
 * while leaving play stopwatches running. Returns true if a session is now open.
 */
export function openSession(id: string, kind: Session["kind"] = "focus", at = Date.now()): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  if (hasOpenSession(stored)) return true // already running — no-op
  const entity = mutable(stored)
  const sched: Schedule = { ...(entity.schedule ?? {}) }
  sched.sessions = [...(sched.sessions ?? []), { startAt: at, kind }]
  const log = ensureEntityLog(entity)
  entity.log = appendInstant(log, makeInstant("session-open", at))
  persistSessionMutation(id, entity, sched)
  return true
}

/**
 * CLOSE the open session on an entity. If the resulting span ≤ MIN_SESSION_MS it is
 * DROPPED entirely (discard-short). No-op if nothing is open. Returns true if a session
 * was closed (or dropped).
 */
export function closeSession(id: string, at = Date.now()): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  const open = getOpenSession(stored)
  if (!open) return false
  const entity = mutable(stored)
  const sched: Schedule = { ...(entity.schedule ?? {}) }
  const sessions = [...(sched.sessions ?? [])]
  const last = sessions[sessions.length - 1]
  if (last && at - last.startAt <= MIN_SESSION_MS) {
    sessions.pop() // too short → discard the whole entry
  } else if (last) {
    sessions[sessions.length - 1] = { ...last, endAt: at }
  }
  sched.sessions = sessions
  const log = ensureEntityLog(entity)
  entity.log = appendInstant(log, makeInstant("session-close", at))
  persistSessionMutation(id, entity, sched)
  return true
}

/** Toggle the open/closed state of an entity's session (Play ⇄ Stop). Returns the new
 *  open state. Used by the glyph play/pause on a "whenever" moment/space. */
export function toggleSession(id: string, kind: Session["kind"] = "play"): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  if (hasOpenSession(stored)) {
    closeSession(id)
    return false
  }
  openSession(id, kind)
  return true
}

// ----------------------------------------------------------------------------
// Per-context ORDER — the user's drag-and-drop sibling order for a do-list.
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
  if (typeof legacy.start === "number") schedule.startAt = fromMin(legacy.start)
  if (typeof legacy.end === "number") schedule.endAt = fromMin(legacy.end)
  if (typeof legacy.at === "number") schedule.at = fromMin(legacy.at, legacy.seconds ?? 0)
  // Old free-text dueDate can't be parsed reliably; default a labelled due to 5pm today.
  if (legacy.dueDate) schedule.dueAt = t(17)
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
 * SCALAR lifecycle fields (`createdAt`/`completedOn`/`closedOn`/`reopenedOn`, plus
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

/** The space-era id the root Individual used before it became {@link ROOT_ID} ("0"). */
const LEGACY_ROOT_ID = "s_root"

/**
 * ONE-TIME MIGRATION (Jul 2026): the root Individual's id changed from the space-era
 * `"s_root"` to the ontology-clean {@link ROOT_ID} (`"0"`). The root itself is seeded
 * (so it already loads as `"0"`), but any data the user PERSISTED under the old id would
 * otherwise dangle. This remaps, in place on the freshly-read {@link UserItems}:
 *   • child `parentId`s pointing at the old root → `"0"` (reattaches the whole subtree);
 *   • id references inside `taggedContextIds` / `assignedResourceIds`;
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
    if (Array.isArray(e.assignedResourceIds)) e.assignedResourceIds = e.assignedResourceIds.map(swap)
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
  // Reattach any data persisted under the old space-era root id before merging.
  migrateStoredRootId(stored)
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

  // Hydrate-cleanup: close any DANGLING focus session a previous run left open (e.g.
  // the app closed while inside a Task). Focus-time must NOT accrue while the app is
  // shut, so we close each at the entity's last known activity and DROP spans that end
  // up ≤ MIN_SESSION_MS. PLAY stopwatches (`kind === "play"`, on moment/space) are LEFT
  // RUNNING on purpose. [DECISION BAKED — easy to flip: delete this loop to keep focus
  // timers running across reloads.]
  for (const entity of entities) {
    if (entity.kind !== "task") continue
    const sessions = entity.schedule?.sessions
    if (!sessions || sessions.length === 0) continue
    const last = sessions[sessions.length - 1]
    if (last.endAt != null || last.kind === "play") continue
    const closeAt = lastLogAt(entity) ?? last.startAt
    const next = [...sessions]
    if (closeAt - last.startAt <= MIN_SESSION_MS) next.pop()
    else next[next.length - 1] = { ...last, endAt: closeAt }
    entity.schedule = { ...entity.schedule, sessions: next }
    // In-memory only (like the id/tagged migrations); persists on the next mutation.
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
  migrateStoredRootId(stored)
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
            completed: e.completed,
            completedOn: e.completedOn,
            closed: e.closed,
            closedOn: e.closedOn,
            reopened: e.reopened,
            reopenedOn: e.reopenedOn,
            cancelled: e.cancelled,
            cancelledOn: e.cancelledOn,
            createdAt: e.createdAt,
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
    completed: false,
    createdAt: now,
    // Birth is the first log entry; scalars above are the transitional backup.
    log: [makeInstant("created", now)],
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
 * `completed` state (logging a PAST activity). Unlike `addTask` + `changeEntityKind`,
 * this sets the exact schedule instead of the per-kind placeholder span, and stamps
 * `completedOn` when done — so "Slept --2330-0630" lands as a finished Moment in a
 * single persist. Mirrors `addTask`'s store bookkeeping (userEntityIds + persist).
 */
export function addParsedEntity(input: {
  title: string
  contextId: string
  kind: EntityKind
  schedule?: Schedule
  completed?: boolean
}): Entity {
  const now = Date.now()
  const entity = makeEntity({
    // Kind-correct id prefix (matches the dedicated add* fns): task→t, moment→m,
    // instant→i, resource→r, space→s, community→c, organism→o, individual→n, soul→l.
    // Defaults to "t" for any kind without a dedicated prefix.
    id: uid(ID_PREFIX[input.kind] ?? "t"),
    kind: input.kind,
    title: input.title,
    parentId: input.contextId,
    taggedContextIds: [],
    createdAt: now,
    completed: input.completed ?? false,
    ...(input.completed ? { completedOn: now } : {}),
    ...(input.schedule ? { schedule: input.schedule } : {}),
    // Tasks carry a priority + tags like `addTask` seeds; other kinds don't need them.
    ...(input.kind === "task" ? { priority: "medium" as TaskPriority, tags: [] } : {}),
  })
  // Seed the lifecycle log from the just-set scalars: a `created` entry, plus a
  // `done` entry when logging a PAST activity (input.completed) — so "Slept …"
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
  const anchor = s.at ?? s.startAt
  const resolved: Schedule = { ...s }
  delete resolved.repeat
  if (anchor == null) return resolved
  if (s.blocks && s.blocks.length > 0) {
    const blocks = shiftBlocksToDay(s.blocks, dayStart)
    resolved.blocks = blocks
    resolved.startAt = blocks[0].startAt
    resolved.endAt = blocks[blocks.length - 1].endAt
    return resolved
  }
  const a = new Date(anchor)
  const occ = new Date(dayStart)
  occ.setHours(a.getHours(), a.getMinutes(), a.getSeconds(), 0)
  const occStart = occ.getTime()
  const duration = isConcreteStart(s.startAt) && s.endAt != null ? s.endAt - s.startAt : 0
  if (s.at != null) {
    resolved.at = occStart
  } else {
    resolved.startAt = occStart
    resolved.endAt = occStart + duration
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
    completed: false,
    ...(mother.accent ? { accent: mother.accent } : {}),
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
      completed: false,
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
    completed: false,
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

export function addSpace(input: { name: string; parentId: string }): Entity {
  const entity: Entity = {
    id: uid("s"),
    kind: "space",
    title: input.name,
    parentId: input.parentId,
    taggedContextIds: [],
    description: "",
    assignedResourceIds: [],
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
    schedule: { startAt: t(12), endAt: t(13) },
  }
  entities.push(entity)
  byId.set(entity.id, entity)
  userEntityIds.add(entity.id)
  persist()
  return entity
}

export function addInstant(input: { title: string; contextId: string }): Entity {
  // An instant is a single point in time (down-triangle). It defaults to noon
  // today exactly; sub-minute precision is free now that `at` is absolute ms.
  const entity: Entity = {
    id: uid("i"),
    kind: "instant",
    title: input.title,
    parentId: input.contextId,
    taggedContextIds: [],
    schedule: { at: t(12) },
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
 * and the caller keeps the default noon. Intentionally minimal: a proper time
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
 * entity's `createdAt` (or `now` if unknown), so the log is complete from birth; then
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
  const log: TitleEntry[] = entity.titleLog ? [...entity.titleLog] : [{ title: prior, at: entity.createdAt ?? now }]
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
 * day independent. No-op if the id is unknown. */
export function setEntityCompleted(id: string, completed: boolean): void {
  const stored = byId.get(id)
  if (!stored) return
  // Only kinds WITH a done axis (Task / Moment / Instant) hold a "done" checkmark.
  // Space/Resource only open⟷close; terminal kinds retire/die — ignore done writes on them.
  if (completed && !hasDoneState(stored.kind)) return
  // Only append a log entry on a REAL state change (guards against redundant sets
  // adding duplicate done/undone Instants).
  const changed = isDone(stored) !== completed
  const entity = mutable(stored)
  const now = Date.now()
  entity.completed = completed
  // Track WHEN it was completed (cleared when un-checked) — part of every space's meta.
  entity.completedOn = completed ? now : undefined
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
  entity.closeAt = completed ? computeCloseAt(entity, now) : undefined
  // DUAL-WRITE: append the toggle to the lifecycle log (the source of truth for reads),
  // seeding a log from scalars first if this entity predates it. Scalars above remain
  // as the transitional backup.
  if (changed) {
    const log = ensureEntityLog(stored)
    stored.log = appendInstant(log, makeInstant(completed ? "done" : "undone", entity.completedOn ?? now))
  }
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, {
      ...seededOverrides.get(id),
      completed,
      completedOn: entity.completedOn,
      // Cleared: Done no longer implies the explicit complete verdict (see above).
      complete: undefined,
      completeOn: undefined,
      closeAt: entity.closeAt,
    })
  }
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
    entity.completed = entity.completed ?? false
    entity.priority = entity.priority ?? "medium"
    entity.tags = entity.tags ?? []
  } else if (kind === "space") {
    entity.description = entity.description ?? ""
    entity.assignedResourceIds = entity.assignedResourceIds ?? []
  } else if (kind === "moment") {
    entity.schedule = { startAt: t(12), endAt: t(13), ...entity.schedule }
  } else if (kind === "instant") {
    entity.schedule = { at: t(12), ...entity.schedule }
  } else if (kind === "resource" || kind === "community" || kind === "organism") {
    // All container-like: they hold things and carry a blurb. (Organism is the
    // only identity-triad kind that's user-creatable; individual/soul are seeded
    // system entities and never produced through this path.)
    entity.description = entity.description ?? ""
    entity.assignedResourceIds = entity.assignedResourceIds ?? []
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

  // MULTI-BLOCK days (D4): build the within-day spans on the anchor day. Stored as
  // absolute times there; the expander/materialize project them onto each matching
  // day. Only meaningful with 2+ blocks (a single block is just the normal span).
  const blocks =
    plan.blocks && plan.blocks.length >= 2
      ? plan.blocks
          .map((b) => ({
            startAt: anchorDay + b.startHour * 3_600_000 + b.startMinute * 60_000,
            endAt: anchorDay + b.endHour * 3_600_000 + b.endMinute * 60_000,
          }))
          .sort((a, b) => a.startAt - b.startAt)
      : undefined

  if (plan.kind === "instant") {
    entity.schedule = { at: startAt, ...(repeat ? { repeat } : {}) }
  } else if (plan.kind === "moment" || plan.kind === "space") {
    if (plan.kind === "space") {
      entity.description = entity.description ?? ""
      entity.assignedResourceIds = entity.assignedResourceIds ?? []
    }
    if (blocks) {
      entity.schedule = {
        startAt: blocks[0].startAt,
        endAt: blocks[blocks.length - 1].endAt,
        blocks,
        ...(repeat ? { repeat } : {}),
      }
    } else {
      const durMin = plan.durationMinutes ?? 60
      entity.schedule = { startAt, endAt: startAt + durMin * 60_000, ...(repeat ? { repeat } : {}) }
    }
  } else {
    // task: keep it a task, but attach timing. A recurring task carries the repeat rule;
    // a one-off task with a deadline gets dueAt.
    const sched: NonNullable<Entity["schedule"]> = {}
    if (repeat) {
      sched.startAt = startAt
      sched.repeat = repeat
    } else if (plan.dueInDays != null) {
      sched.dueAt = today0 + plan.dueInDays * DAY_MS + timeOfDayMs
    }
    entity.schedule = Object.keys(sched).length > 0 ? sched : entity.schedule
    entity.completed = entity.completed ?? false
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
 * the write-side of the create-field self-setters (`:start:`/`:end:` → startAt/endAt).
 * Passing `null` removes that field; all OTHER schedule fields are preserved (so setting
 * start doesn't wipe end). If the entity had no schedule yet, one is created. Returns
 * true when the entity existed.
 */
export function setEntityScheduleField(
  id: string,
  field: "startAt" | "endAt" | "at" | "dueAt",
  epoch: number | null | typeof WHENEVER,
  ): boolean {
  const stored = byId.get(id)
  if (!stored) return false
  // Only `startAt` accepts the "whenever" sentinel (a playable, timeless start).
  if (epoch === WHENEVER && field !== "startAt") return false
  const entity = mutable(stored)
  const sched: NonNullable<Entity["schedule"]> = { ...(entity.schedule ?? {}) }
  if (epoch == null) delete sched[field]
  else if (field === "startAt") sched.startAt = epoch
  else if (epoch !== WHENEVER) sched[field] = epoch
  entity.schedule = sched
  logSet(entity, field, epoch === WHENEVER ? WHENEVER : epoch)
  // Re-stamp the absolute midnight close whenever a MOMENT/INSTANT's end (or point)
  // changes, so its time-close stays tz-stable and in sync with the new schedule. Tasks
  // stamp on Done instead, not from `dueAt`, so they're unaffected here.
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
  if (hex == null) delete entity.accent
  else entity.accent = hex
  logSet(entity, "color", hex)
  if (!userEntityIds.has(id)) {
  seededOverrides.set(id, { ...seededOverrides.get(id), accent: hex ?? undefined })
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
    if (cand.id === newId || cand.id === stored.parentId) continue
    if (cand.id === ROOT_ID || cand.kind === "soul") continue
    if (cand.title.trim().length < 2) continue // ignore 1-char titles (noise)
    if (isClosed(cand)) continue
    if (titlePhraseMatches(hay, cand.title)) matched.push(cand)
  }
  if (matched.length === 0) return []
  const entity = mutable(stored)
  const links = new Set(entity.taggedContextIds ?? [])
  for (const m of matched) links.add(m.id)
  entity.taggedContextIds = [...links]
  if (opts.inheritAccent && entity.accent == null) {
    const inherited = matched[0].accent ?? getInheritedAccent(matched[0].id)
    if (inherited) entity.accent = inherited
  }
  if (!userEntityIds.has(newId)) {
    seededOverrides.set(newId, {
      ...seededOverrides.get(newId),
      taggedContextIds: entity.taggedContextIds,
      accent: entity.accent,
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
 * Close/Cancel still applies under either policy — this only governs the AUTOMATIC path.
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
  if (hidden) entity.hidden = true
  else delete entity.hidden
  logSet(entity, "hidden", hidden)
  if (!userEntityIds.has(id)) {
    seededOverrides.set(id, { ...seededOverrides.get(id), hidden: hidden || undefined } as Partial<Entity>)
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
 * Delete an entity (space / task / event / instant) and everything nested
 * under it (its origin children, recursively). Seeded entities leave a
 * tombstone so the deletion survives refreshes; user-created ones are simply
 * dropped. Persisted afterward.
 */
export function deleteEntity(id: string): void {
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
