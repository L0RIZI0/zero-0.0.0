import type { Asset, Entity, EntityKind, Recurrence, Resource, User } from "./types"
import { readUserItems, writeUserItems } from "./persistence"

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

/** Local midnight of today, epoch ms. Computed once at module load. */
const START_OF_TODAY = (() => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
})()

/** Epoch ms for TODAY at h:m(:s) local. Keeps seed rows readable: `t(9, 30)`. */
const t = (h: number, m = 0, s = 0) => START_OF_TODAY + h * 3_600_000 + m * 60_000 + s * 1000

/** Epoch ms for a day-offset from today at h:m local. `dayT(1, 9)` = tomorrow 9am. */
const dayT = (dayOffset: number, h = 0, m = 0) => t(h, m) + dayOffset * DAY_MS

/** Next occurrence (today or future) of weekday `wd` (0=Sun..6=Sat) at `h:00`. */
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
  // --- Spaces ---------------------------------------------------------------
  // s_root is "Space 0" / All Life.
  {
    id: "s_root",
    kind: "space",
    title: "All Life",
    parentId: null,
    taggedSpaceIds: [],
    description: "Your whole life, in one calm context.",
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
    title: "Review today's priorities",
    parentId: "s_root",
    taggedSpaceIds: [],
    completed: true,
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

  // --- Events ---------------------------------------------------------------
  { id: "e1", kind: "event", title: "Daily standup", parentId: "s_dayjob", taggedSpaceIds: [], schedule: { startAt: t(9), endAt: t(9, 30) } },
  { id: "e2", kind: "event", title: "Deep work block", parentId: "s_zero", taggedSpaceIds: [], schedule: { startAt: t(9, 45), endAt: t(11, 30) } },
  { id: "e3", kind: "event", title: "Product review", parentId: "s_product", taggedSpaceIds: [], schedule: { startAt: t(11, 30), endAt: t(12, 15) } },
  { id: "e4", kind: "event", title: "Lunch", parentId: "s_personal", taggedSpaceIds: [], schedule: { startAt: t(12, 30), endAt: t(13, 15) } },
  { id: "e5", kind: "event", title: "Investor prep", parentId: "s_deck", taggedSpaceIds: [], schedule: { startAt: t(13, 30), endAt: t(14, 45) } },
  { id: "e6", kind: "event", title: "Admin hour", parentId: "s_admin", taggedSpaceIds: [], schedule: { startAt: t(15), endAt: t(16) } },
  { id: "e8", kind: "event", title: "Evening reset", parentId: "s_journal", taggedSpaceIds: [], schedule: { startAt: t(21), endAt: t(21, 30) } },
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
  return entities.filter(
    (e) =>
      e.id !== contextId &&
      (e.parentId === contextId || e.taggedSpaceIds.includes(contextId)),
  )
}

/**
 * Whether `childId` would appear inside `hostId`'s do-list / dock — i.e. `host`
 * is the child's structural parent OR a space it is tagged into. This is the
 * exact membership rule `getChildren` uses, so it is the test for whether an
 * entity has an IN-PLACE owning node when `host` is open.
 */
export function isMemberOf(childId: string, hostId: string): boolean {
  const e = byId.get(childId)
  if (!e) return false
  return e.parentId === hostId || e.taggedSpaceIds.includes(hostId)
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
 * Count of DIRECT child tasks (origin + tagged) that are still incomplete.
 * Child spaces and events are intentionally not counted. Drives the "N ■"
 * detail shown on pinned cards and space rows.
 */
export function getOpenTaskCount(contextId: string): number {
  return getChildren(contextId).filter((e) => e.kind === "task" && !e.completed).length
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
      if (e.kind !== "space" || e.parentId === null) continue
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
  return e && e.kind === "event" ? e : undefined
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
  if (spaceId === "s_root") return entities.filter((e) => e.kind === "task")
  const descendants = collectDescendants(spaceId)
  return entities.filter(
    (e) =>
      e.kind === "task" &&
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
    e.kind === "event" || e.kind === "instant" || (e.kind === "space" && !!e.schedule)
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
export interface TimelineOccurrence extends Entity {
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
function dayMatchesRecurrence(dayStart: number, anchor: number, repeat: Recurrence): boolean {
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
        const occDate = new Date(dayStart)
        occDate.setHours(anchorDate.getHours(), anchorDate.getMinutes(), anchorDate.getSeconds(), 0)
        const occStart = occDate.getTime()
        const schedule =
          s.at != null
            ? { ...s, at: occStart }
            : { ...s, startAt: occStart, endAt: occStart + duration }
        out.push({ ...e, schedule, occKey: `${e.id}@${dayStart}` })
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
    event: e.kind === "event" ? e : undefined,
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

  for (const entity of stored.entities) {
    if (byId.has(entity.id)) continue
    migrateLegacyTime(entity)
    entities.push(entity)
    byId.set(entity.id, entity)
    userEntityIds.add(entity.id)
    added = true
  }

  // Restore pins (per-context). Pins reference seeded or user items by id.
  for (const [contextId, ids] of Object.entries(stored.pins)) {
    if (!Array.isArray(ids) || ids.length === 0) continue
    pinnedByContext[contextId] = [...ids]
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

  return added
}

export function addTask(input: { title: string; spaceId: string }): Entity {
  const entity: Entity = {
    id: uid("t"),
    kind: "task",
    title: input.title,
    parentId: input.spaceId,
    taggedSpaceIds: [],
    completed: false,
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
 * Create a RESOURCE TASK — a task bound to a web resource/URL. Opening it shows a
 * web surface (live embed or illustrative stand-in) instead of a do-list. This is
 * the create path behind the "type a URL / pick a resource" gesture. Title falls
 * back to the resource/host name when the user only supplied a URL.
 */
export function addWebTask(input: {
  title: string
  url: string
  spaceId: string
  resourceId?: string
}): Entity {
  const entity: Entity = {
    id: uid("t"),
    kind: "task",
    title: input.title,
    parentId: input.spaceId,
    taggedSpaceIds: [],
    completed: false,
    priority: "medium",
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
    kind: "event",
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
  const entity = byId.get(id)
  if (!entity || entity.kind === kind) return
  entity.kind = kind
  if (kind === "task") {
    entity.completed = entity.completed ?? false
    entity.priority = entity.priority ?? "medium"
    entity.tags = entity.tags ?? []
  } else if (kind === "space") {
    entity.description = entity.description ?? ""
    entity.assignedResourceIds = entity.assignedResourceIds ?? []
  } else if (kind === "event") {
    entity.schedule = { startAt: t(12), endAt: t(13), ...entity.schedule }
  } else if (kind === "instant") {
    entity.schedule = { at: t(12), ...entity.schedule }
  } else if (kind === "resource" || kind === "community") {
    // Both are containers like a space: they hold things and carry a blurb.
    entity.description = entity.description ?? ""
    entity.assignedResourceIds = entity.assignedResourceIds ?? []
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
  entity.cancelled = cancelled
  if (!userEntityIds.has(id)) {
    // Seeded entity — track as an override patch.
    seededOverrides.set(id, { ...seededOverrides.get(id), cancelled })
  }
  persist()
}
