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
const HEADER_ROOT = 2
const HEADER_CHILD = 60
const HEADER_CHILD_WITH_DESCRIPTION = 88

/** The timeline's top offset — animates down to clear the child's title. */
export function headerHeightFor(node: ActiveNode): number {
  if (!node.isChild) return HEADER_ROOT
  return node.description ? HEADER_CHILD_WITH_DESCRIPTION : HEADER_CHILD
}

/**
 * The "shell stage" — how compact the chrome (header bar + timeline lift)
 * becomes as the user dives deeper. The whole interface reacts to depth:
 *
 *   stage 0  root (Space 0)      — everything full size, timeline rests low
 *   stage 1  first child open    — timeline slides up toward the header bar
 *   stage 2  second child (+)     — timeline lifts further AND the header bar
 *                                   compacts (avatar shrinks, handle drops,
 *                                   search collapses to its icon, logo shrinks)
 *
 * Depth 3 and beyond reuse stage 2 — no further push-up, for now.
 */
export type ShellStage = 0 | 1 | 2

export function shellStageFor(node: ActiveNode): ShellStage {
  return Math.min(node.depth, 2) as ShellStage
}

/** Top padding above the timeline — shrinks as the shell compacts, so the
 *  timeline slides up closer to the header bar with each level of depth.
 *  Stages 1 and 2 ride higher now that the day label shares the hour ruler
 *  (which already removed a row of height from the whole strip).
 *
 *  NOTE: these are intentionally NOT deeply negative. The WorkSurface card is
 *  `overflow-hidden` (to clip its rounded corners and the window frames), so
 *  pulling the timeline far above the card's top edge clips the day label that
 *  floats at the top of the strip. We keep the lift gentle so the label always
 *  stays inside the card; the extra compaction at depth comes from the header
 *  easing up (HEADER_PAD_Y) instead. */
export const TIMELINE_TOP_PAD: Record<ShellStage, number> = {
  0: 2,
  1: 0,
  2: -2,
}

/** Vertical padding of the header bar — the whole bar slides up as the user
 *  dives. It already eases up a touch at stage 1 (no shrinking yet — that is
 *  reserved for stage 2), then tightens fully when the chrome compacts. */
export const HEADER_PAD_Y: Record<ShellStage, number> = {
  0: 14,
  1: 10,
  2: 8,
}
