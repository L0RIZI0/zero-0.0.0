import type { Transition } from "motion/react"

/**
 * Zero motion language: calm, precise, deterministic. No bounce.
 * A single shared transition keeps the shared-element morph coherent.
 */
export const layerTransition: Transition = {
  // [v0] TEMP DIAGNOSTIC: slowed to a long tween to capture the close ghost.
  type: "tween",
  duration: 2,
  ease: "linear",
}

export const contentTransition: Transition = {
  duration: 0.32,
  ease: [0.22, 0.61, 0.36, 1],
}

/** Quick, natural expand/collapse for the side panels (Inputs / Outputs). */
export const panelTransition: Transition = {
  duration: 0.24,
  ease: [0.22, 0.61, 0.36, 1],
}

export const spaceLayoutId = (id: string) => `space-frame-${id}`
export const spaceTitleId = (id: string) => `space-title-${id}`
export const taskLayoutId = (id: string) => `task-frame-${id}`
export const taskTitleId = (id: string) => `task-title-${id}`
/**
 * Events have no window of their own (opening one dives into its parent space),
 * but they still morph between their DO-list row and their dock card, so they
 * carry their own identity for that pin/unpin transition.
 */
export const eventLayoutId = (id: string) => `event-frame-${id}`
export const eventTitleId = (id: string) => `event-title-${id}`
/**
 * Instants mirror events: no window context of their own, but they morph
 * between their TIMELINE marker and their opened window, so they carry their
 * own identity for that transition.
 */
export const instantLayoutId = (id: string) => `instant-frame-${id}`
export const instantTitleId = (id: string) => `instant-title-${id}`
/**
 * Events/instants can be opened from two places — their TIMELINE marker or
 * their DO-list ROW — and the window should grow from (and collapse back to)
 * whichever was used. The ids above belong to the timeline marker; these
 * belong to the DO-list row. They are deliberately distinct so the timeline
 * overlay and the row can coexist without two elements owning one id; the
 * frame simply adopts whichever set matches the source it was opened from.
 */
export const eventRowLayoutId = (id: string) => `event-row-${id}`
export const eventRowTitleId = (id: string) => `event-row-title-${id}`
export const instantRowLayoutId = (id: string) => `instant-row-${id}`
export const instantRowTitleId = (id: string) => `instant-row-title-${id}`
/**
 * Per-entity glyph id so the kind icon travels continuously between the DO-list
 * row and the dock card (shared across space / task / event alike).
 */
export const glyphId = (id: string) => `glyph-${id}`
