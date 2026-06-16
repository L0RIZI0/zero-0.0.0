import type { ActiveEntity } from "./nav-store"

/**
 * Shared geometry for the work surface. Each entity renders its own body
 * (title band + dock + inputs/do-list/outputs) inside its window frame, so
 * there is no longer a separate frontmost layer to keep aligned. What remains
 * here is the depth-driven chrome: how the header bar and the persistent
 * timeline compact and lift as the user dives deeper.
 */

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

export function shellStageFor(entity: ActiveEntity): ShellStage {
  // Re-enabled. Depth drives the chrome compaction:
  //   depth 0 (home)        → stage 0  (everything full size)
  //   depth 1 (first child) → stage 1  (timeline lifts toward the header)
  //   depth 2+ (deeper)     → stage 2  (timeline lifts more + header compacts)
  // This is now safe because BOTH treatments are non-reflowing: the timeline lift
  // is a `transform` (no layout impact) and the header keeps a constant box height
  // while only its CONTENTS shrink — so the focus-window region's box never moves
  // and the fixed-window geometry stays pinned to a stable rect through the morph.
  return Math.min(entity.depth, 2) as ShellStage
}

/** Vertical TRANSFORM (translateY) applied to the timeline as the shell compacts,
 *  so it slides up toward (and slightly into) the header bar with each level of
 *  depth: a little at stage 1, more at stage 2.
 *
 *  Crucially this is a `transform`, NOT a margin: it has ZERO layout impact, so
 *  the focus-window region directly below keeps its exact box. That stability is
 *  what makes the lift safe — the earlier margin-based version moved the region
 *  (whose rect anchors every fixed window) mid-morph, so the home backdrop and
 *  freshly-opened windows visibly jumped. The vacated space below the lifted
 *  strip is just more `bg-background` (same color), so no seam shows; and the
 *  WorkSurface card no longer clips its top, so the strip can ride up into the
 *  header's empty area without being cropped. */
export const TIMELINE_LIFT_Y: Record<ShellStage, number> = {
  0: 0,
  1: -24,
  2: -44,
}

/** How much the open windows grow UPWARD as the shell compacts. The window's
 *  bottom stays put; only its TOP rises by this many px (so it gets taller and
 *  reads as "displayed higher"). Applied to the effective region every window is
 *  measured against (see styleFor): top -= lift, height += lift, which leaves the
 *  bottom exactly where it was.
 *
 *  Kept STRICTLY LESS than TIMELINE_LIFT_Y at the same stage: the region top sits
 *  flush under the timeline's natural bottom, so windows may only rise as far as
 *  the timeline vacates — otherwise the topmost (parent) frame would collide with
 *  the timeline strip. The clip-path top inset on the region is widened to a
 *  negative value to fit these taller windows. */
export const WINDOW_TOP_LIFT: Record<ShellStage, number> = {
  0: 0,
  1: 16,
  2: 34,
}

/** Resting top margin of the timeline (constant — the depth response is the
 *  transform above, which doesn't reflow). */
export const TIMELINE_TOP_PAD = 2

/** Vertical padding of the header bar — held CONSTANT across depth. The header
 *  compacts at stage 2 by shrinking its CONTENTS (avatar, handle, search, logo)
 *  inside a fixed-height bar, so its box never changes and the WorkSurface card
 *  below it (and thus the window region) never moves. */
export const HEADER_PAD_Y = 14
