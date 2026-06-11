import type { ActiveNode } from "./nav-store"

/**
 * Shared geometry for the work surface. The window frame (Layer B) and the
 * persistent frontmost content (Layer C) are rendered in separate z-layers, so
 * they must agree on where the title band (top) sits. These constants are the
 * single source of truth used by both:
 *
 *   ┌───────────────────────────────┐
 *   │  title + description   (window) │  ← headerHeight
 *   │  ───────────────────────────── │
 *   │  timeline           (frontmost) │
 *   │  spaces row         (frontmost) │
 *   │  inputs | tasks | outputs       │  ← fills the middle
 *   └───────────────────────────────┘
 */

/** Horizontal padding of the surface, matching the frame's `px-6`. */
export const SURFACE_PADDING_X = 24

/** Top band reserved for the child window's title + description. */
const HEADER_ROOT = 12
const HEADER_CHILD = 60
const HEADER_CHILD_WITH_DESCRIPTION = 88

/** The timeline's top offset — animates down to clear the child's title. */
export function headerHeightFor(node: ActiveNode): number {
  if (!node.isChild) return HEADER_ROOT
  return node.description ? HEADER_CHILD_WITH_DESCRIPTION : HEADER_CHILD
}
