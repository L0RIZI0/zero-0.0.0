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
 *   - `space` — an area / folder / gathering ("Day Job", "Health").
 *   - `task`  — a unit of work; still a container (it can hold subtasks).
 *   - `event` — a scheduled span; also a container at its core.
 *
 * Containment is recursive: any entity can contain any other entity. The shared
 * attributes below are present on every kind; only some are *relevant* per kind
 * (an event cares about start/end, a task about priority/dueDate, a space about
 * description), so renderers show fields conditionally rather than the model
 * splitting into separate shapes.
 */
export type EntityKind = "space" | "task" | "event"

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
  /** Free-text labels. */
  tags?: string[]
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
