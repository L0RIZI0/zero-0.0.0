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

/**
 * Shared-element morph identity. An entity is rendered in two visual states —
 * COLLAPSED (a dock card / DO-list row / timeline marker) and EXPANDED (its
 * window) — and the transition between them is a Framer shared-layout animation,
 * not a bespoke geometry tween. Three/four sub-elements carry a stable layoutId
 * per entity so each independently flies between its collapsed and expanded
 * position while staying crisp (no whole-window scale distortion):
 *
 *   - frame  : the visual box (border + surface + shadow), behind the content —
 *              conceptually "the window" is just this element, which is also the
 *              button's background when collapsed.
 *   - accent : the kind's left color strip.
 *   - glyph  : the kind mark.
 *   - title  : the entity title (slides from beneath the glyph on a dock card to
 *              beside it in the window header, growing en route).
 *
 * Only ONE on-screen element may own a given layoutId at a time (Framer matches
 * by id), so collapsed sources RELEASE their ids while the window is open. For
 * entities that live in two places at once (a timed event is both a DO-list row
 * and a timeline marker) the nav store's open-source elects the single owner.
 */
export const frameLayoutId = (id: string) => `z-frame-${id}`
export const accentLayoutId = (id: string) => `z-accent-${id}`
export const glyphLayoutId = (id: string) => `z-glyph-${id}`
export const titleLayoutId = (id: string) => `z-title-${id}`

/** Corner radius shared by the frame in BOTH states (button + window) so the
 *  shared frame element needs no radius correction as it morphs. */
export const FRAME_RADIUS = 6

/** Geometry of the nested-doll window stack (px), keyed off absolute depth. */
export const TOP_PEEK_PX = 40
export const SIDE_PX = 10

/** A rectangle in region-local coordinates — a window's resting box. */
export type Rect = { top: number; left: number; width: number; height: number }
