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

export interface Space {
  id: string
  name: string
  parentId: string | null
  description: string
  childSpaceIds: string[]
  assignedResourceIds: string[]
  /** Visual accent for the space, used sparingly as a contextual tint. */
  accent?: string
}

export interface Task {
  id: string
  title: string
  completed: boolean
  dueDate: string | null
  priority: TaskPriority
  tags: string[]
  /** A task can belong to more than one space. */
  spaceIds: string[]
}

export interface ZeroEvent {
  id: string
  title: string
  /** Minutes from midnight, simplifies the timeline rendering. */
  start: number
  end: number
  spaceId: string
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
