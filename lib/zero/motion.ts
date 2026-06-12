import type { Transition } from "motion/react"

/**
 * Zero motion language: calm, precise, deterministic. No bounce.
 * A single shared transition keeps the shared-element morph coherent.
 */
export const layerTransition: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 44,
  mass: 0.9,
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
 * Per-entity glyph id so the kind icon travels continuously between the DO-list
 * row and the dock card (shared across space / task / event alike).
 */
export const glyphId = (id: string) => `glyph-${id}`
