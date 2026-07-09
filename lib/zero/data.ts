import type { Asset, Entity, EntityKind, Instant, Recurrence, Schedule, Resource, EntityBase, TaskPriority, User } from "./types"
import { isCompletable, isClosed } from "./kinds"
import { isDone, buildLogFromScalars, makeInstant, appendInstant, auditLogScalarConsistency } from "./entity-log"
import type { LogScalarMismatch } from "./entity-log"
import { readUserItems, writeUserItems } from "./persistence"
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

export const currentUser: User = {
  id: "u_self",
  name: "Loris",
  handle: "loris",
  avatarUrl: "/loris-avatar.png",
}

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
    spaceIds: ["s_root", "s_dayjob", "s_admin", "s_team"],
    tint: "#C9685E",
  },
  {
    id: "r_slack",
    name: "Slack",
    kind: "communication",
    icon: "Sl",
    description: "Team channels",
    spaceIds: ["s_dayjob", "s_team", "s_zero", "s_product"],
    tint: "#7B6CA6",
  },
  {
    id: "r_drive",
    name: "Drive",
    kind: "storage",
    icon: "Dr",
    description: "Cloud files",
    spaceIds: ["s_root", "s_dayjob", "s_zero", "s_admin"],
    tint: "#6E9C84",
  },
  {
    id: "r_figma",
    name: "Figma",
    kind: "design",
    icon: "Fg",
    description: "Design canvas",
    spaceIds: ["s_zero", "s_product", "s_deck"],
    tint: "#C97A5A",
  },
  {
    id: "r_notion",
    name: "Notion",
    kind: "document",
    icon: "No",
    description: "Docs and wikis",
    spaceIds: ["s_root", "s_dayjob", "s_zero", "s_strategy", "s_research"],
    tint: "#9A9A93",
  },
  {
    id: "r_browser",
    name: "Browser Research",
    kind: "browser",
    icon: "Br",
    description: "Open research tabs",
    spaceIds: ["s_research", "s_strategy", "s_zero"],
    tint: "#8A8F99",
  },
  {
    id: "r_journal",
    name: "Journal",
    kind: "note",
    icon: "Jr",
    description: "Daily entries",
    spaceIds: ["s_personal", "s_journal", "s_root"],
    tint: "#A88C6A",
  },
  {
    id: "r_notes",
    name: "Notes",
    kind: "note",
    icon: "Nt",
    description: "Quick captures",
    spaceIds: ["s_root", "s_personal", "s_zero", "s_product"],
    tint: "#9A9488",
  },
  {
    id: "r_deck",
    name: "Investor Deck",
    kind: "document",
    icon: "Dk",
    description: "4FTER narrative",
    spaceIds: ["s_zero", "s_deck", "s_strategy"],
    tint: "#B5895E",
  },
  {
    id: "r_contacts",
    name: "Contacts",
    kind: "service",
    icon: "Co",
    description: "People & relations",
    spaceIds: ["s_root", "s_dayjob", "s_personal", "s_family"],
    tint: "#7F9AA3",
  },
  {
    id: "r_files",
    name: "Files",
    kind: "file",
    icon: "Fl",
    description: "Local resources",
    spaceIds: ["s_root", "s_admin", "s_home"],
    tint: "#969089",
  },
  {
    id: "r_ai",
    name: "AI Assistant",
    kind: "ai",
    icon: "Ze",
    description: "Zero agent",
    spaceIds: [
      "s_root",
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
    spaceIds: ["s_dayjob", "s_team", "s_strategy", "s_admin"],
    tint: "#8C8C84",
  },
  {
    id: "r_sheet",
    name: "Spreadsheet",
    kind: "document",
    icon: "Sh",
    description: "Models & budgets",
    spaceIds: ["s_admin", "s_strategy", "s_nutrition"],
    tint: "#6E9C84",
  },
  {
    id: "r_whiteboard",
    name: "Whiteboard",
    kind: "planning",
    icon: "Wb",
    description: "Spatial planning",
    spaceIds: ["s_product", "s_strategy", "s_zero"],
    tint: "#9189A6",
  },
  {
    id: "r_health",
    name: "Health",
    kind: "service",
    icon: "Hl",
    description: "Vitals & activity",
    spaceIds: ["s_health", "s_training", "s_sleep", "s_nutrition"],
    tint: "#6E9C84",
  },
]

// ----------------------------------------------------------------------------
// Entities — the single recursive model. Spaces, tasks, and events are all
// `Entity` records differing only by `kind`. Every entity has one origin
// `parentId` (the "created-from" container; the root `s_root` has null) plus an
// optional `taggedSpaceIds[]` for multi-parent links ("also shows up in").
//
// Containment for a context's task list is DIRECT children only:
//   parentId === contextId  OR  taggedSpaceIds includes contextId.
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
    taggedSpaceIds: [],
    description: "The irreducible core self.",
  },
  // entity0 is the INDIVIDUAL (glyph: a Z rotated 45° anticlockwise) — the person the
  // Soul animates, whose space IS the homeview (the door to their life). It keeps id
  // `s_root` and all its space children; only its `kind` flipped organism→individual,
  // its `title` is the user's name, and it now nests inside the Soul (`soul_self`).
  // The former separate "i_self" individual node is gone — `s_root` is that person.
  {
    id: "s_root",
    kind: "individual",
    title: currentUser.name,
    parentId: "soul_self",
    taggedSpaceIds: [],
    description: "A person, animated by a Soul.",
    assignedResourceIds: [
      "r_gmail",
      "r_drive",
      "r_notion",
      "r_journal",
      "r_notes",
      "r_contacts",
      "r_files",
      "r_ai",
    ],
  },
  // --- Spaces ---------------------------------------------------------------
  // Day Job
  {
    id: "s_dayjob",
    kind: "space",
    title: "Day Job",
    parentId: "s_root",
    taggedSpaceIds: [],
    description: "Your role, your team, the work that pays.",
    assignedResourceIds: ["r_gmail", "r_slack", "r_drive", "r_notion", "r_docs", "r_ai"],
    accent: ACCENT.dayjob,
  },
  {
    id: "s_team",
    kind: "space",
    title: "Team",
    parentId: "s_dayjob",
    taggedSpaceIds: [],
    description: "People you work alongside.",
    assignedResourceIds: ["r_slack", "r_gmail", "r_docs", "r_contacts"],
    accent: ACCENT.dayjob,
  },
  {
    id: "s_strategy",
    kind: "space",
    title: "Strategy",
    parentId: "s_dayjob",
    taggedSpaceIds: [],
    description: "Direction, bets, and the long arc.",
    assignedResourceIds: ["r_notion", "r_browser", "r_deck", "r_docs", "r_whiteboard", "r_sheet", "r_ai"],
    accent: ACCENT.dayjob,
  },
  {
    id: "s_admin",
    kind: "space",
    title: "Admin",
    parentId: "s_dayjob",
    taggedSpaceIds: [],
    description: "The necessary maintenance of work.",
    assignedResourceIds: ["r_gmail", "r_drive", "r_docs", "r_sheet", "r_files"],
    accent: ACCENT.dayjob,
  },
  // Zero
  {
    id: "s_zero",
    kind: "space",
    title: "Zero",
    parentId: "s_root",
    taggedSpaceIds: [],
    description: "Building the contextual shell itself.",
    assignedResourceIds: ["r_figma", "r_notion", "r_slack", "r_deck", "r_whiteboard", "r_notes", "r_ai"],
    accent: ACCENT.zero,
  },
  {
    id: "s_product",
    kind: "space",
    title: "Product",
    parentId: "s_zero",
    taggedSpaceIds: [],
    description: "Interaction, surface, and feel.",
    assignedResourceIds: ["r_figma", "r_whiteboard", "r_notes", "r_slack"],
    accent: ACCENT.zero,
  },
  {
    id: "s_deck",
    kind: "space",
    title: "Deck",
    parentId: "s_zero",
    taggedSpaceIds: [],
    description: "The investor narrative for 4FTER.",
    assignedResourceIds: ["r_deck", "r_figma"],
    accent: ACCENT.zero,
  },
  {
    id: "s_research",
    kind: "space",
    title: "Research",
    parentId: "s_zero",
    taggedSpaceIds: [],
    description: "References, prior art, and inspiration.",
    assignedResourceIds: ["r_browser", "r_notion", "r_ai"],
    accent: ACCENT.zero,
  },
  {
    id: "s_prototype",
    kind: "space",
    title: "Prototype",
    parentId: "s_zero",
    taggedSpaceIds: [],
    description: "The working build — experiments and rough edges.",
    assignedResourceIds: ["r_figma", "r_whiteboard", "r_ai"],
    accent: ACCENT.zero,
  },
  {
    id: "s_lowprio_backlog",
    kind: "space",
    title: "Low Prio Backlog",
    parentId: "s_prototype",
    taggedSpaceIds: [],
    description: "Nice-to-haves to return to one day.",
    assignedResourceIds: ["r_notes"],
    accent: ACCENT.zero,
  },
  // Personal
  {
    id: "s_personal",
    kind: "space",
    title: "Home & Family",
    parentId: "s_root",
    taggedSpaceIds: [],
    description: "Life outside the work.",
    assignedResourceIds: ["r_journal", "r_notes", "r_contacts"],
    accent: ACCENT.personal,
  },
  {
    id: "s_home",
    kind: "space",
    title: "Home",
    parentId: "s_personal",
    taggedSpaceIds: [],
    description: "The place and its upkeep.",
    assignedResourceIds: ["r_files", "r_notes"],
    accent: ACCENT.personal,
  },
  {
    id: "s_family",
    kind: "space",
    title: "Family",
    parentId: "s_personal",
    taggedSpaceIds: [],
    description: "The people closest to you.",
    assignedResourceIds: ["r_contacts", "r_journal"],
    accent: ACCENT.personal,
  },
  {
    id: "s_journal",
    kind: "space",
    title: "Journal",
    parentId: "s_personal",
    taggedSpaceIds: [],
    description: "A quiet record of days.",
    assignedResourceIds: ["r_journal", "r_notes"],
    accent: ACCENT.personal,
  },
  // Health
  {
    id: "s_health",
    kind: "space",
    title: "Health",
    parentId: "s_root",
    taggedSpaceIds: [],
    description: "The body you operate from.",
    assignedResourceIds: ["r_health", "r_notes", "r_ai"],
    accent: ACCENT.health,
  },
  {
    id: "s_training",
    kind: "space",
    title: "Training",
    parentId: "s_health",
    taggedSpaceIds: [],
    description: "Movement and strength.",
    assignedResourceIds: ["r_health", "r_notes"],
    accent: ACCENT.health,
  },
  {
    id: "s_sleep",
    kind: "space",
    title: "Sleep",
    parentId: "s_health",
    taggedSpaceIds: [],
    description: "Recovery and rest.",
    assignedResourceIds: ["r_health"],
    accent: ACCENT.health,
  },
  {
    id: "s_nutrition",
    kind: "space",
    title: "Nutrition",
    parentId: "s_health",
    taggedSpaceIds: [],
    description: "What fuels the work.",
    assignedResourceIds: ["r_health", "r_sheet"],
    accent: ACCENT.health,
  },
  // Workout — a SPACE (a daily world to invest in), not a one-off event. It
  // carries a recurring schedule (30min every day at 17:45) so it surfaces on
  // the timeline as a repeating chip, and it CONTAINS the exercise checklist
  // (w1–w6 below) the user ticks off each session. Over time this world can grow
  // stats, progress, and history.
  {
    id: "s_workout",
    kind: "space",
    title: "Workout",
    parentId: "s_health",
    taggedSpaceIds: [],
    description: "30 min every day at 17:45 — show up, move, log it.",
    assignedResourceIds: ["r_health", "r_notes", "r_ai"],
    accent: ACCENT.health,
    schedule: { startAt: t(17, 45), endAt: t(18, 15), repeat: { freq: "daily" } },
  },

  // --- Workout exercises (the Workout space's daily checklist) ---------------
  { id: "w1", kind: "task", title: "Warm-up & mobility", parentId: "s_workout", taggedSpaceIds: [], completed: false, priority: "medium", tags: ["workout"] },
  { id: "w2", kind: "task", title: "Squats — 4×8", parentId: "s_workout", taggedSpaceIds: [], completed: false, priority: "high", tags: ["workout", "legs"] },
  { id: "w3", kind: "task", title: "Bench press — 4×8", parentId: "s_workout", taggedSpaceIds: [], completed: false, priority: "high", tags: ["workout", "push"] },
  { id: "w4", kind: "task", title: "Pull-ups — 3× max", parentId: "s_workout", taggedSpaceIds: [], completed: false, priority: "high", tags: ["workout", "pull"] },
  { id: "w5", kind: "task", title: "Core circuit", parentId: "s_workout", taggedSpaceIds: [], completed: false, priority: "medium", tags: ["workout", "core"] },
  { id: "w6", kind: "task", title: "Cooldown stretch", parentId: "s_workout", taggedSpaceIds: [], completed: false, priority: "low", tags: ["workout"] },

  // --- NOW ------------------------------------------------------------------
  // A pinned space on home for the present moment. Being a `space` child of
  // `s_root`, it is auto-pinned into home's dock by the seed loop below. It holds
  // a RESOURCE TASK (`t_zerolaws`) that opens the in-app /zero-laws page through
  // Zero's contextual-browser mechanism — an <iframe> to a same-origin URL, which
  // frames cleanly (no X-Frame-Options block), so it loads "live" in the web build.
  {
    id: "s_now",
    kind: "space",
    title: "NOW",
    parentId: "s_root",
    taggedSpaceIds: [],
    description: "The present moment.",
    accent: ACCENT.zero,
  },
  {
    // A URL is a thing the work DRAWS ON → a `resource` (diamond), not a task. The
    // id keeps its historical `t_` prefix (identity is the id STRING, not the prefix;
    // pins reference it) but the kind is a resource. Opening swaps its body for the
    // ResourceCanvas web surface (the contextual browser). Relative URL resolves
    // against the current origin in the iframe, so it works on any deploy.
    id: "t_zerolaws",
    kind: "resource",
    title: "Zero Laws",
    parentId: "s_now",
    taggedSpaceIds: [],
    webUrl: "/zero-laws",
    tags: ["zero", "laws"],
  },
  {
    // Same as above: an internal-page resource (diamond). Frames the in-app /vision
    // manifesto (Do, don't plan; the substrate + honest constraints).
    id: "t_vision",
    kind: "resource",
    title: "The Vision",
    parentId: "s_now",
    taggedSpaceIds: [],
    webUrl: "/vision",
    tags: ["zero", "vision"],
  },

  // --- Tasks ----------------------------------------------------------------
  // Multi-space tasks re-parented to a single origin; the rest become tags.
  {
    id: "t1",
    kind: "task",
    title: "Finalize investor narrative for 4FTER",
    parentId: "s_zero",
    taggedSpaceIds: ["s_deck", "s_strategy"],
    completed: false,
    schedule: { dueAt: t(17) },
    priority: "high",
    tags: ["deck", "narrative"],
  },
  {
    id: "t2",
    kind: "task",
    title: "Refine nested Space interaction",
    parentId: "s_zero",
    taggedSpaceIds: ["s_product"],
    completed: false,
    schedule: { dueAt: t(17) },
    priority: "high",
    tags: ["motion", "product"],
  },
  {
    id: "t3",
    kind: "task",
    title: "Task 1",
    parentId: "s_root",
    taggedSpaceIds: [],
    completed: false,
    schedule: { dueAt: t(17) },
    priority: "medium",
    tags: ["ritual"],
  },
  {
    id: "t4",
    kind: "task",
    title: "Prepare Monday product notes",
    parentId: "s_dayjob",
    taggedSpaceIds: ["s_product", "s_zero"],
    completed: false,
    schedule: { dueAt: nextWeekday(1) },
    priority: "medium",
    tags: ["product"],
  },
  {
    id: "t5",
    kind: "task",
    title: "Organize Zero task taxonomy",
    parentId: "s_zero",
    taggedSpaceIds: ["s_product"],
    completed: false,
    schedule: { dueAt: nextWeekday(5) },
    priority: "low",
    tags: ["system"],
  },
  {
    id: "t6",
    kind: "task",
    title: "Write product deck outline",
    parentId: "s_zero",
    taggedSpaceIds: ["s_deck"],
    completed: false,
    schedule: { dueAt: nextWeekday(3) },
    priority: "high",
    tags: ["deck"],
  },
  {
    id: "t7",
    kind: "task",
    title: "Follow up with Romain",
    parentId: "s_dayjob",
    taggedSpaceIds: ["s_team"],
    completed: false,
    schedule: { dueAt: t(17) },
    priority: "medium",
    tags: ["people"],
  },
  {
    id: "t8",
    kind: "task",
    title: "Schedule dentist appointment",
    parentId: "s_personal",
    taggedSpaceIds: ["s_health"],
    completed: false,
    schedule: { dueAt: nextWeekday(5) },
    priority: "low",
    tags: ["errand"],
  },
  {
    id: "t9",
    kind: "task",
    title: "Grocery run",
    parentId: "s_personal",
    taggedSpaceIds: ["s_home"],
    completed: false,
    schedule: { dueAt: t(17) },
    priority: "low",
    tags: ["errand"],
  },
  {
    id: "t10",
    kind: "task",
    title: "Evening journal session",
    parentId: "s_personal",
    taggedSpaceIds: ["s_journal"],
    completed: false,
    schedule: { dueAt: t(17) },
    priority: "low",
    tags: ["ritual"],
  },
  {
    id: "t11",
    kind: "task",
    title: "Shoulder mobility routine",
    parentId: "s_health",
    taggedSpaceIds: ["s_training"],
    completed: false,
    schedule: { dueAt: t(17) },
    priority: "medium",
    tags: ["training"],
  },
  {
    id: "t12",
    kind: "task",
    title: "Draft Q3 admin review",
    parentId: "s_dayjob",
    taggedSpaceIds: ["s_admin"],
    completed: false,
    schedule: { dueAt: nextWeekday(4) },
    priority: "medium",
    tags: ["admin"],
  },
  {
    id: "t_refine_hollow_check",
    kind: "task",
    title: "Refine checkmark on hollow Events & Instants",
    parentId: "s_lowprio_backlog",
    taggedSpaceIds: [],
    completed: false,
    priority: "low",
    tags: ["prototype", "polish"],
  },

  // --- Events ---------------------------------------------------------------
  { id: "e1", kind: "moment", title: "Daily standup", parentId: "s_dayjob", taggedSpaceIds: [], schedule: { startAt: t(9), endAt: t(9, 30) } },
  { id: "e2", kind: "moment", title: "Deep work block", parentId: "s_zero", taggedSpaceIds: [], schedule: { startAt: t(9, 45), endAt: t(11, 30) } },
  { id: "e3", kind: "moment", title: "Product review", parentId: "s_product", taggedSpaceIds: [], schedule: { startAt: t(11, 30), endAt: t(12, 15) } },
  { id: "e4", kind: "moment", title: "Lunch", parentId: "s_personal", taggedSpaceIds: [], schedule: { startAt: t(12, 30), endAt: t(13, 15) } },
  { id: "e5", kind: "moment", title: "Investor prep", parentId: "s_deck", taggedSpaceIds: [], schedule: { startAt: t(13, 30), endAt: t(14, 45) } },
  { id: "e6", kind: "moment", title: "Admin hour", parentId: "s_admin", taggedSpaceIds: [], schedule: { startAt: t(15), endAt: t(16) } },
  // Overlapping events — real days double-book. These deliberately collide with the
  // blocks above so the timeline demonstrates vertical lane-stacking (e9 runs through
  // the deep-work + product-review window; e10 overlaps investor prep + admin hour).
  { id: "e9", kind: "moment", title: "1:1 with Sarah", parentId: "s_dayjob", taggedSpaceIds: [], schedule: { startAt: t(10, 30), endAt: t(11, 15) } },
  { id: "e10", kind: "moment", title: "Design sync", parentId: "s_product", taggedSpaceIds: [], schedule: { startAt: t(14), endAt: t(15, 30) } },
  { id: "e8", kind: "moment", title: "Evening reset", parentId: "s_journal", taggedSpaceIds: [], schedule: { startAt: t(21), endAt: t(21, 30) } },
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
    spaceId: "s_deck",
    preview: "18 slides · edited 2h ago",
  },
  {
    id: "a2",
    title: "Zero — Interaction Spec",
    type: "document",
    linkedResourceId: "r_notion",
    spaceId: "s_product",
    preview: "Living doc · 12 sections",
  },
  {
    id: "a3",
    title: "Nested Space Studies",
    type: "image",
    linkedResourceId: "r_figma",
    spaceId: "s_product",
    preview: "Frame set · 6 boards",
  },
  {
    id: "a4",
    title: "Strategy Memo — H2",
    type: "note",
    linkedResourceId: "r_notes",
    spaceId: "s_strategy",
    preview: "Note · 4 min read",
  },
  {
    id: "a5",
    title: "Financial Model",
    type: "sheet",
    linkedResourceId: "r_sheet",
    spaceId: "s_admin",
    preview: "Sheet · 9 tabs",
  },
  {
    id: "a6",
    title: "Notion Plus",
    type: "subscription",
    linkedResourceId: "r_notion",
    spaceId: "s_root",
    preview: "Subscription · renews Apr 2",
  },
  {
    id: "a7",
    title: "Research — Contextual UIs",
    type: "link",
    linkedResourceId: "r_browser",
    spaceId: "s_research",
    preview: "14 saved links",
  },
  {
    id: "a8",
    title: "Daily Journal",
    type: "note",
    linkedResourceId: "r_journal",
    spaceId: "s_journal",
    preview: "Note · 142 entries",
  },
  {
    id: "a9",
    title: "Figma Organization",
    type: "subscription",
    linkedResourceId: "r_figma",
    spaceId: "s_root",
    preview: "Subscription · seat active",
  },
  {
    id: "a10",
    title: "Family Calendar",
    type: "link",
    linkedResourceId: "r_contacts",
    spaceId: "s_family",
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
      // The identity triad's inner two kinds are structural, not browsable content,
      // so they never appear in any do-list / child listing (e.g. the Individual is
      // a direct child of the root Organism but must stay invisible at home).
      e.kind !== "individual" &&
      e.kind !== "soul" &&
      // Materialized recurrence occurrences (overrides) are timeline instances, not
      // do-list children — they must never leak into any listing (the round-27 trap).
      e.seriesId == null &&
      (e.parentId === contextId || e.taggedSpaceIds.includes(contextId)),
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
  return e.parentId === hostId || e.taggedSpaceIds.includes(hostId) || isPinned(hostId, childId)
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

/** Count of OPEN direct child events (outline triangle). "Open" = not yet closed,
 *  which — via `isClosed` — also excludes cancelled events and ones past their end. */
export function getOpenEventCount(contextId: string): number {
  return getChildren(contextId).filter((e) => e.kind === "moment" && !isClosed(e)).length
}

/** Count of CANCELLED direct child events (struck-through triangle). */
export function getCancelledEventCount(contextId: string): number {
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

/** Set of space ids in `spaceId`'s structural subtree, including itself. */
function collectDescendants(spaceId: string): Set<string> {
  const set = new Set<string>([spaceId])
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

/** True when `spaceId` is `nodeId` or a descendant of it. */
export function isInSubtree(nodeId: string, spaceId: string): boolean {
  if (nodeId === "s_root") return true
  return collectDescendants(nodeId).has(spaceId)
}

/**
 * Walk up from `spaceId` and return the DIRECT child space of `focusId` whose
 * subtree contains it — i.e. the band an item would roll up INTO under the
 * adaptive semantic-LOD. Returns:
 *   - `null` if `spaceId` is the focus itself or a direct member of it (no
 *     intervening child space — these items always render individually), or
 *   - `undefined` if `spaceId` isn't under `focusId` at all.
 * Drives timeline semantic rollup (e.g. a meeting deep under "Day Job" resolves
 * to the "Day Job" child space when focus is Home).
 */
export function directChildOfFocus(spaceId: string | null, focusId: string): string | null | undefined {
  if (!spaceId) return undefined
  // Build the parent chain of `spaceId` up to the root.
  const chain: string[] = []
  let cur: Entity | undefined = byId.get(spaceId)
  while (cur) {
    chain.push(cur.id)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  const focusIdx = chain.indexOf(focusId)
  // s_root focus: the "direct child of root" is the chain element just below root.
  if (focusId === "s_root") {
    // chain ends at the true root (s_root or a top-level node). Find s_root's index.
    const rootIdx = chain.indexOf("s_root")
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
 * parent chain starting at `spaceId` and return the nearest ancestor that has
 * its own accent. The root space (`s_root` / "Space 0") has no accent, so an
 * item created directly under it resolves to `undefined` — callers render those
 * with a neutral fallback (light grey). e.g. an instant in Zero inherits Zero's
 * magenta; an instant in Space 0 inherits nothing.
 */
export function getInheritedAccent(spaceId: string | null): string | undefined {
  let current = spaceId ? byId.get(spaceId) : undefined
  while (current) {
    if (current.kind === "space" && current.accent) return current.accent
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return undefined
}

/** A task entity by id (undefined for non-task ids). */
export function getTask(id: string): Entity | undefined {
  const e = byId.get(id)
  return e && e.kind === "task" ? e : undefined
}

/** An event entity by id (undefined for non-event ids). */
export function getEvent(id: string): Entity | undefined {
  const e = byId.get(id)
  return e && e.kind === "moment" ? e : undefined
}

/** An instant entity by id (undefined for non-instant ids). */
export function getInstant(id: string): Entity | undefined {
  const e = byId.get(id)
  return e && e.kind === "instant" ? e : undefined
}

/** Direct child spaces of a space. */
export function getChildSpaces(spaceId: string): Entity[] {
  return entities.filter((e) => e.kind === "space" && e.parentId === spaceId)
}

/** Resources assigned to a space. */
export function getSpaceResources(spaceId: string): Resource[] {
  const space = getSpace(spaceId)
  if (!space) return []
  return (space.assignedResourceIds ?? [])
    .map((id) => resourceById.get(id))
    .filter(Boolean) as Resource[]
}

/**
 * Tasks anywhere in a space's subtree (origin or tagged). Used by legacy
 * callers; the task list itself uses getChildren for direct children.
 */
export function getSpaceTasks(spaceId: string): Entity[] {
  if (spaceId === "s_root") return entities.filter((e) => e.kind === "task" && e.seriesId == null)
  const descendants = collectDescendants(spaceId)
  return entities.filter(
    (e) =>
      e.kind === "task" &&
      e.seriesId == null &&
      ((e.parentId !== null && descendants.has(e.parentId)) ||
        e.taggedSpaceIds.some((sid) => descendants.has(sid))),
  )
}

/** Timed entities anywhere in a space's subtree. Drives the timeline — events
 *  render as spans, instants as single-point markers, and SCHEDULED SPACES
 *  (a space with its own `schedule`, e.g. a recurring "Workout" world) render
 *  as span chips too. Time is read directly off `entity.schedule` (absolute
 *  epoch ms). Recurring entities are expanded into per-day occurrences by
 *  getTimelineOccurrences; this selector returns the underlying entities. */
export function getSpaceEvents(spaceId: string): Entity[] {
  const isTimed = (e: Entity) =>
    e.seriesId == null &&
    (e.kind === "moment" || e.kind === "instant" || (e.kind === "space" && !!e.schedule))
  if (spaceId === "s_root") return entities.filter(isTimed)
  const descendants = collectDescendants(spaceId)
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
  spaceId: string,
  rangeStart: number,
  rangeEnd: number,
): TimelineOccurrence[] {
  const out: TimelineOccurrence[] = []
  for (const e of getSpaceEvents(spaceId)) {
    const s = e.schedule
    if (!s) continue
    const anchor = s.at ?? s.startAt
    if (anchor == null) continue

    if (!s.repeat) {
      // One-off: pass through (the timeline clips to the viewport itself).
      out.push({ ...e, occKey: e.id })
      continue
    }

    const duration = s.startAt != null && s.endAt != null ? s.endAt - s.startAt : 0
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

/** Assets anywhere in a space's subtree. */
export function getSpaceAssets(spaceId: string): Asset[] {
  if (spaceId === "s_root") return assets
  const descendants = collectDescendants(spaceId)
  return assets.filter((a) => descendants.has(a.spaceId))
}

/**
 * A "context item" wrapper around an Entity. The `task` / `event` / `space`
 * fields are back-compat aliases that all point to the SAME underlying entity
 * (populated based on `kind`), so existing readers continue to work.
 */
export interface ContextItem {
  id: string
  kind: EntityKind
  title: string
  entity: Entity
  task?: Entity
  event?: Entity
  space?: Entity
}

function toContextItem(e: Entity): ContextItem {
  return {
    id: e.id,
    kind: e.kind,
    title: e.title,
    entity: e,
    task: e.kind === "task" ? e : undefined,
    event: e.kind === "moment" ? e : undefined,
    space: e.kind === "space" ? e : undefined,
  }
}

/** Direct children of a context as ContextItems (spaces, tasks, events). */
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
// the start (Zero, Home, Health… under All Life, and each subspace under its
// own parent). The root (parentId === null) has no parent dock to sit in.
// User pins restored from storage are merged on top of this in hydrate.
for (const e of entities) {
  if (e.kind !== "space" || e.parentId === null) continue
  const arr = pinnedByContext[e.parentId] ?? (pinnedByContext[e.parentId] = [])
  arr.push(e.id)
}

// The NOW space pins its browsable resource TASKS into its own dock. The loop above
// only auto-pins SPACES; these are resource tasks, so they're pinned explicitly.
;(pinnedByContext["s_now"] ??= []).push("t_zerolaws", "t_vision")

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

export function addTask(input: { title: string; spaceId: string }): Entity {
  const now = Date.now()
  const entity: Entity = {
    id: uid("t"),
    kind: "task",
    title: input.title,
    parentId: input.spaceId,
    taggedSpaceIds: [],
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
  spaceId: string
  kind: EntityKind
  schedule?: Schedule
  completed?: boolean
}): Entity {
  const now = Date.now()
  const entity = makeEntity({
    id: uid("t"),
    kind: input.kind,
    title: input.title,
    parentId: input.spaceId,
    taggedSpaceIds: [],
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
  const duration = s.startAt != null && s.endAt != null ? s.endAt - s.startAt : 0
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
    taggedSpaceIds: [...mother.taggedSpaceIds],
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
      taggedSpaceIds: [...child.taggedSpaceIds],
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
  spaceId: string
  resourceId?: string
}): Entity {
  const entity: Entity = {
    id: uid("r"),
    kind: "resource",
    title: input.title,
    parentId: input.spaceId,
    taggedSpaceIds: [],
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
    taggedSpaceIds: [],
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

export function addEvent(input: { title: string; spaceId: string }): Entity {
  const entity: Entity = {
    id: uid("e"),
    kind: "moment",
    title: input.title,
    parentId: input.spaceId,
    taggedSpaceIds: [],
    // Defaults to a noon→1pm block TODAY (absolute epoch ms).
    schedule: { startAt: t(12), endAt: t(13) },
  }
  entities.push(entity)
  byId.set(entity.id, entity)
  userEntityIds.add(entity.id)
  persist()
  return entity
}

export function addInstant(input: { title: string; spaceId: string }): Entity {
  // An instant is a single point in time (down-triangle). It defaults to noon
  // today exactly; sub-minute precision is free now that `at` is absolute ms.
  const entity: Entity = {
    id: uid("i"),
    kind: "instant",
    title: input.title,
    parentId: input.spaceId,
    taggedSpaceIds: [],
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
 * Set a task's completion and PERSIST it. Previously the glyph toggle only flipped
 * local component state, so a checkmark was lost the moment the row/window unmounted
 * — most visible on a recurrence occurrence (check a subtask, close, reopen → it was
 * back to unchecked). Writing through to the store fixes that for ALL tasks, and for
 * materialized occurrences it lands on the override's own cloned subtask, keeping each
 * day independent. No-op if the id is unknown. */
export function setEntityCompleted(id: string, completed: boolean): void {
  const stored = byId.get(id)
  if (!stored) return
  // Only completable kinds hold a normal "done". Community/Organism/Individual/Soul
  // reach a TERMINAL state (retire/death) instead — ignore completion writes on them.
  if (completed && !isCompletable(stored.kind)) return
  // Only append a log entry on a REAL state change (guards against redundant sets
  // adding duplicate done/undone Instants).
  const changed = isDone(stored) !== completed
  const entity = mutable(stored)
  const now = Date.now()
  entity.completed = completed
  // Track WHEN it was completed (cleared when un-checked) — part of every space's meta.
  entity.completedOn = completed ? now : undefined
  // DUAL-WRITE: append the toggle to the lifecycle log (the source of truth for reads),
  // seeding a log from scalars first if this entity predates it. Scalars above remain
  // as the transitional backup.
  if (changed) {
    const log = ensureEntityLog(stored)
    stored.log = appendInstant(log, makeInstant(completed ? "done" : "undone", entity.completedOn ?? now))
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
  // may have none yet); seed one from scalars if absent.
  ensureEntityLog(stored)
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
  if (!userEntityIds.has(id)) {
    // Seeded entity — track as an override patch so the sent state survives refreshes.
    seededOverrides.set(id, { ...seededOverrides.get(id), requested })
  }
  persist()
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
 * Cancel (or un-cancel) an event/instant. It stays on the timeline and in the
 * DO list but renders dimmed with a struck-through title. Seeded items record
 * a partial override so the state survives refreshes.
 */
export function setEventCancelled(id: string, cancelled: boolean): void {
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
 * CLOSE or REOPEN an entity — the "Close"/"Reopen" menu actions. The glyph fills
 * when closed (distinct from a task's "done"/checkmark).
 *  - CLOSE (`closed=true`): sets the manual `closed` flag and clears any prior
 *    `reopened` override.
 *  - REOPEN (`closed=false`): clears the manual `closed` flag AND sets `reopened`,
 *    which overrides a DERIVED close (an event past its end, a done task past its
 *    midnight) via {@link isClosed} — so ANY closed entity can be pulled back open
 *    and stays open until closed again. (A `cancelled` entity is reopened via
 *    Restore / setEventCancelled instead.)
 * Seeded items record a partial override so the state survives refreshes (mirrors
 * setEventCancelled).
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
