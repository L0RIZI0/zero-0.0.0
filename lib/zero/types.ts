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
  /** Free-text due label ("Today", "Mon", "This week"); mainly tasks. */
  dueDate?: string
  /** Minutes from midnight; mainly events. Kept numeric for timeline math. */
  start?: number
  end?: number
  /**
   * Minutes from midnight for an `instant` — a single point in time rather than
   * a span. `seconds` carries the sub-minute precision (0–59) so an instant can
   * be pinned to a specific second.
   */
  at?: number
  seconds?: number
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
