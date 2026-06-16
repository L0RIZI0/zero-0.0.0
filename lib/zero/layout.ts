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
  // FROZEN AT STAGE 0 for now. The depth-driven chrome compaction (timeline lift
  // + header tightening) animated unevenly across dives — nothing on the first
  // child (since the pad values are flat) then a visible jump on the second when
  // `compact` and the timeline's stage-2 treatments kicked in. Per design call,
  // the chrome no longer reacts to depth at all, so window opens/closes are the
  // only motion. Restore `Math.min(entity.depth, 2)` to bring the adaptation back
  // once it can be done without reflowing the window region.
  void entity
  return 0
}

/** Top margin above the timeline — goes increasingly negative as the shell
 *  compacts, so the timeline slides up toward (and slightly into) the header
 *  bar with each level of depth: a little higher at stage 1, much higher at
 *  stage 2.
 *
 *  This is now safe to push negative: the WorkSurface card no longer clips its
 *  top (the `overflow-hidden` was moved down to the focus-window region), so the
 *  timeline can overflow upward into the header's empty space below the date
 *  without the day label being cropped. The floor is the header's centered date
 *  row — pushing past it makes the off-today link/label collide with the date —
 *  so the deepest lift stops just under it. The header itself also compacts with
 *  depth, lifting the card top, so stage 2 still sits highest overall. */
// NOTE: held CONSTANT across depth (was -18/-17 at deeper stages). The depth-
// driven lift reflowed the focus-window region downward/upward mid-morph, so the
// home backdrop (and any parent body) visibly "jumped" while a child window grew
// or shrank — and it also shifted the region whose rect anchors every fixed
// window's geometry, leaving freshly opened windows a few px off. A stable region
// top keeps the morph rock-solid and the parent dead still. A non-reflowing
// timeline lift (e.g. transform-based) can be reintroduced later if desired.
export const TIMELINE_TOP_PAD: Record<ShellStage, number> = {
  0: 2,
  1: 2,
  2: 2,
}

/** Vertical padding of the header bar — the whole bar slides up as the user
 *  dives. It already eases up a touch at stage 1 (no shrinking yet — that is
 *  reserved for stage 2), then tightens fully when the chrome compacts. */
// Also held CONSTANT now (was 14/10/8). Shrinking the header padding with depth
// moved the WorkSurface card — and therefore the window region — up by a few px
// during a dive, which is the same reflow-jump described above. Keeping it fixed
// guarantees the region's top never moves between depths.
export const HEADER_PAD_Y: Record<ShellStage, number> = {
  0: 14,
  1: 14,
  2: 14,
}
