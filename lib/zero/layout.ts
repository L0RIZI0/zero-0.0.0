import type { ActiveNode } from "./nav-store"

/**
 * Shared geometry for the work surface. The window frame (Layer B) and the
 * persistent frontmost content (Layer C) are rendered in separate z-layers, so
 * they must agree on where the title band (top) and spaces dock (bottom) sit.
 * These constants are the single source of truth used by both:
 *
 *   ┌───────────────────────────────┐
 *   │  title + description   (window) │  ← headerHeight
 *   │  ───────────────────────────── │
 *   │  timeline           (frontmost) │
 *   │  inputs | tasks | outputs       │  ← fills the middle
 *   │  ───────────────────────────── │
 *   │  spaces row            (window) │  ← spacesDockHeight
 *   └───────────────────────────────┘
 */

/** Horizontal padding of the surface, matching the frame's `px-6`. */
export const SURFACE_PADDING_X = 24

/** Top band reserved for the child window's title + description. */
const HEADER_ROOT = 12
const HEADER_CHILD = 60
const HEADER_CHILD_WITH_DESCRIPTION = 88

/** Bottom band reserved for the spaces dock (heading + a row of space cards). */
export const SPACES_DOCK_HEIGHT = 120
/** Bottom band when no spaces dock is shown (task windows). */
const BOTTOM_MINIMAL = 16

/** The timeline's top offset — animates down to clear the child's title. */
export function headerHeightFor(node: ActiveNode): number {
  if (!node.isChild) return HEADER_ROOT
  return node.description ? HEADER_CHILD_WITH_DESCRIPTION : HEADER_CHILD
}

/** Bottom inset reserved by the frontmost layer for the window's spaces dock. */
export function bottomInsetFor(node: ActiveNode): number {
  // Only spaces hold subspaces; task windows have no spaces dock.
  return node.kind === "space" ? SPACES_DOCK_HEIGHT : BOTTOM_MINIMAL
}
