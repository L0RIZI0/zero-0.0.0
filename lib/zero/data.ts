import type { Asset, Resource, Space, Task, User, ZeroEvent } from "./types"

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
// Spaces — nested contexts. s_root is "Space 0" / All Life.
// ----------------------------------------------------------------------------

export const spaces: Space[] = [
  {
    id: "s_root",
    name: "All Life",
    parentId: null,
    description: "Your whole life, in one calm context.",
    childSpaceIds: ["s_dayjob", "s_zero", "s_personal", "s_health"],
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
  // --- Day Job ---------------------------------------------------------------
  {
    id: "s_dayjob",
    name: "Day Job",
    parentId: "s_root",
    description: "Your role, your team, the work that pays.",
    childSpaceIds: ["s_team", "s_strategy", "s_admin"],
    assignedResourceIds: ["r_gmail", "r_slack", "r_drive", "r_notion", "r_docs", "r_ai"],
    accent: "#7F9AA3",
  },
  {
    id: "s_team",
    name: "Team",
    parentId: "s_dayjob",
    description: "People you work alongside.",
    childSpaceIds: [],
    assignedResourceIds: ["r_slack", "r_gmail", "r_docs", "r_contacts"],
    accent: "#7F9AA3",
  },
  {
    id: "s_strategy",
    name: "Strategy",
    parentId: "s_dayjob",
    description: "Direction, bets, and the long arc.",
    childSpaceIds: [],
    assignedResourceIds: ["r_notion", "r_browser", "r_deck", "r_docs", "r_whiteboard", "r_sheet", "r_ai"],
    accent: "#7F9AA3",
  },
  {
    id: "s_admin",
    name: "Admin",
    parentId: "s_dayjob",
    description: "The necessary maintenance of work.",
    childSpaceIds: [],
    assignedResourceIds: ["r_gmail", "r_drive", "r_docs", "r_sheet", "r_files"],
    accent: "#7F9AA3",
  },
  // --- Zero ------------------------------------------------------------------
  {
    id: "s_zero",
    name: "Zero",
    parentId: "s_root",
    description: "Building the contextual shell itself.",
    childSpaceIds: ["s_product", "s_deck", "s_research"],
    assignedResourceIds: ["r_figma", "r_notion", "r_slack", "r_deck", "r_whiteboard", "r_notes", "r_ai"],
    accent: "#B5895E",
  },
  {
    id: "s_product",
    name: "Product",
    parentId: "s_zero",
    description: "Interaction, surface, and feel.",
    childSpaceIds: [],
    assignedResourceIds: ["r_figma", "r_whiteboard", "r_notes", "r_slack"],
    accent: "#B5895E",
  },
  {
    id: "s_deck",
    name: "Deck",
    parentId: "s_zero",
    description: "The investor narrative for 4FTER.",
    childSpaceIds: [],
    assignedResourceIds: ["r_deck", "r_figma"],
    accent: "#B5895E",
  },
  {
    id: "s_research",
    name: "Research",
    parentId: "s_zero",
    description: "References, prior art, and inspiration.",
    childSpaceIds: [],
    assignedResourceIds: ["r_browser", "r_notion", "r_ai"],
    accent: "#B5895E",
  },
  // --- Personal --------------------------------------------------------------
  {
    id: "s_personal",
    name: "Personal",
    parentId: "s_root",
    description: "Life outside the work.",
    childSpaceIds: ["s_home", "s_family", "s_journal"],
    assignedResourceIds: ["r_journal", "r_notes", "r_contacts"],
    accent: "#A88C6A",
  },
  {
    id: "s_home",
    name: "Home",
    parentId: "s_personal",
    description: "The place and its upkeep.",
    childSpaceIds: [],
    assignedResourceIds: ["r_files", "r_notes"],
    accent: "#A88C6A",
  },
  {
    id: "s_family",
    name: "Family",
    parentId: "s_personal",
    description: "The people closest to you.",
    childSpaceIds: [],
    assignedResourceIds: ["r_contacts", "r_journal"],
    accent: "#A88C6A",
  },
  {
    id: "s_journal",
    name: "Journal",
    parentId: "s_personal",
    description: "A quiet record of days.",
    childSpaceIds: [],
    assignedResourceIds: ["r_journal", "r_notes"],
    accent: "#A88C6A",
  },
  // --- Health ----------------------------------------------------------------
  {
    id: "s_health",
    name: "Health",
    parentId: "s_root",
    description: "The body you operate from.",
    childSpaceIds: ["s_training", "s_sleep", "s_nutrition"],
    assignedResourceIds: ["r_health", "r_notes", "r_ai"],
    accent: "#6E9C84",
  },
  {
    id: "s_training",
    name: "Training",
    parentId: "s_health",
    description: "Movement and strength.",
    childSpaceIds: [],
    assignedResourceIds: ["r_health", "r_notes"],
    accent: "#6E9C84",
  },
  {
    id: "s_sleep",
    name: "Sleep",
    parentId: "s_health",
    description: "Recovery and rest.",
    childSpaceIds: [],
    assignedResourceIds: ["r_health"],
    accent: "#6E9C84",
  },
  {
    id: "s_nutrition",
    name: "Nutrition",
    parentId: "s_health",
    description: "What fuels the work.",
    childSpaceIds: [],
    assignedResourceIds: ["r_health", "r_sheet"],
    accent: "#6E9C84",
  },
]

// ----------------------------------------------------------------------------
// Tasks
// ----------------------------------------------------------------------------

export const tasks: Task[] = [
  {
    id: "t1",
    title: "Finalize investor narrative for 4FTER",
    completed: false,
    dueDate: "Today",
    priority: "high",
    tags: ["deck", "narrative"],
    spaceIds: ["s_zero", "s_deck", "s_strategy"],
  },
  {
    id: "t2",
    title: "Refine nested Space interaction",
    completed: false,
    dueDate: "Today",
    priority: "high",
    tags: ["motion", "product"],
    spaceIds: ["s_zero", "s_product"],
  },
  {
    id: "t3",
    title: "Review today's priorities",
    completed: true,
    dueDate: "Today",
    priority: "medium",
    tags: ["ritual"],
    spaceIds: ["s_root"],
  },
  {
    id: "t4",
    title: "Prepare Monday product notes",
    completed: false,
    dueDate: "Mon",
    priority: "medium",
    tags: ["product"],
    spaceIds: ["s_dayjob", "s_product", "s_zero"],
  },
  {
    id: "t5",
    title: "Organize Zero task taxonomy",
    completed: false,
    dueDate: "This week",
    priority: "low",
    tags: ["system"],
    spaceIds: ["s_zero", "s_product"],
  },
  {
    id: "t6",
    title: "Write product deck outline",
    completed: false,
    dueDate: "Wed",
    priority: "high",
    tags: ["deck"],
    spaceIds: ["s_zero", "s_deck"],
  },
  {
    id: "t7",
    title: "Follow up with Romain",
    completed: false,
    dueDate: "Today",
    priority: "medium",
    tags: ["people"],
    spaceIds: ["s_dayjob", "s_team"],
  },
  {
    id: "t8",
    title: "Schedule dentist appointment",
    completed: false,
    dueDate: "This week",
    priority: "low",
    tags: ["errand"],
    spaceIds: ["s_personal", "s_home"],
  },
  {
    id: "t9",
    title: "Grocery run",
    completed: false,
    dueDate: "Today",
    priority: "low",
    tags: ["errand"],
    spaceIds: ["s_personal", "s_home"],
  },
  {
    id: "t10",
    title: "Evening journal session",
    completed: false,
    dueDate: "Today",
    priority: "low",
    tags: ["ritual"],
    spaceIds: ["s_personal", "s_journal"],
  },
  {
    id: "t11",
    title: "Shoulder mobility routine",
    completed: false,
    dueDate: "Today",
    priority: "medium",
    tags: ["training"],
    spaceIds: ["s_health", "s_training"],
  },
  {
    id: "t12",
    title: "Draft Q3 admin review",
    completed: false,
    dueDate: "Thu",
    priority: "medium",
    tags: ["admin"],
    spaceIds: ["s_dayjob", "s_admin"],
  },
]

// ----------------------------------------------------------------------------
// Events — minutes from midnight
// ----------------------------------------------------------------------------

const hm = (h: number, m = 0) => h * 60 + m

export const events: ZeroEvent[] = [
  { id: "e1", title: "Daily standup", start: hm(9), end: hm(9, 30), spaceId: "s_dayjob" },
  { id: "e2", title: "Deep work block", start: hm(9, 45), end: hm(11, 30), spaceId: "s_zero" },
  { id: "e3", title: "Product review", start: hm(11, 30), end: hm(12, 15), spaceId: "s_product" },
  { id: "e4", title: "Lunch", start: hm(12, 30), end: hm(13, 15), spaceId: "s_personal" },
  { id: "e5", title: "Investor prep", start: hm(13, 30), end: hm(14, 45), spaceId: "s_deck" },
  { id: "e6", title: "Admin hour", start: hm(15), end: hm(16), spaceId: "s_admin" },
  { id: "e7", title: "Workout", start: hm(17, 30), end: hm(18, 30), spaceId: "s_training" },
  { id: "e8", title: "Evening reset", start: hm(21), end: hm(21, 30), spaceId: "s_journal" },
]

// ----------------------------------------------------------------------------
// Assets — unified resource/asset model
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
// Selectors / helpers
// ----------------------------------------------------------------------------

const spaceById = new Map(spaces.map((s) => [s.id, s]))
const resourceById = new Map(resources.map((r) => [r.id, r]))
const taskById = new Map(tasks.map((t) => [t.id, t]))

export function getSpace(id: string): Space | undefined {
  return spaceById.get(id)
}

export function getTask(id: string): Task | undefined {
  return taskById.get(id)
}

export function getResource(id: string): Resource | undefined {
  return resourceById.get(id)
}

export function getChildSpaces(spaceId: string): Space[] {
  const space = spaceById.get(spaceId)
  if (!space) return []
  return space.childSpaceIds.map((id) => spaceById.get(id)).filter(Boolean) as Space[]
}

/** Resources assigned to a space, falling back to the space's explicit list. */
export function getSpaceResources(spaceId: string): Resource[] {
  const space = spaceById.get(spaceId)
  if (!space) return []
  const fromAssigned = space.assignedResourceIds
    .map((id) => resourceById.get(id))
    .filter(Boolean) as Resource[]
  return fromAssigned
}

/**
 * Tasks for a space. The root space shows all tasks; nested spaces show tasks
 * whose spaceIds include this space (or any descendant for non-leaf spaces).
 */
export function getSpaceTasks(spaceId: string): Task[] {
  if (spaceId === "s_root") return tasks
  const descendants = collectDescendants(spaceId)
  return tasks.filter((t) => t.spaceIds.some((sid) => descendants.has(sid)))
}

export function getSpaceEvents(spaceId: string): ZeroEvent[] {
  if (spaceId === "s_root") return events
  const descendants = collectDescendants(spaceId)
  return events.filter((e) => descendants.has(e.spaceId))
}

export function getSpaceAssets(spaceId: string): Asset[] {
  if (spaceId === "s_root") return assets
  const descendants = collectDescendants(spaceId)
  return assets.filter((a) => descendants.has(a.spaceId))
}

function collectDescendants(spaceId: string): Set<string> {
  const set = new Set<string>([spaceId])
  const stack = [spaceId]
  while (stack.length) {
    const current = stack.pop() as string
    const space = spaceById.get(current)
    if (!space) continue
    for (const child of space.childSpaceIds) {
      if (!set.has(child)) {
        set.add(child)
        stack.push(child)
      }
    }
  }
  return set
}
