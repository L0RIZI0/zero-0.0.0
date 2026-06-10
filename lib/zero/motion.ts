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
