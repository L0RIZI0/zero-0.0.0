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
  1: -32,
  2: -66,
}

/** How much the open windows grow UPWARD as the shell compacts.
 *
 *  ZERO at every stage now. Under the REGION model (see lib/zero/regions and
 *  WorkSurface) region 0 — the window region — spans the FULL card height (from
 *  just under the app bar to the surface bottom), so an open window already fills
 *  to the top and its header sits directly beneath the app bar. The timeline is no
 *  longer a band ABOVE the window that the window rises to meet; it is an OVERLAY
 *  that drops to sit just below the active window's header (region 1, referenced
 *  from entity 0). So there is nothing to "rise toward" — the lift is 0 and the
 *  window's top is governed purely by region 0's rect. */
export const WINDOW_TOP_LIFT: Record<ShellStage, number> = {
  0: 0,
  1: 0,
  2: 0,
}

/** Height of an open window's header band (glyph + title + close). Held constant
 *  across depth (the header compacts its CONTENTS, not its box — see HEADER_PAD_Y),
 *  so the timeline overlay can be positioned at a stable `headerBottom` offset
 *  below the app bar when a window is open. Measured from the live layout. */
export const HEADER_BAND_H = 60

/** Resting top margin of the timeline (constant — the depth response is the
 *  transform above, which doesn't reflow). */
export const TIMELINE_TOP_PAD = 2

/** Vertical padding of the header bar — held CONSTANT across depth. The header
 *  compacts at stage 2 by shrinking its CONTENTS (avatar, handle, search, logo)
 *  inside a fixed-height bar, so its box never changes and the WorkSurface card
 *  below it (and thus the window region) never moves. */
export const HEADER_PAD_Y = 14

/* --- Timeline morph sizing (Lifelane ⇄ Atlas) -------------------------------
 * The Timeline is ONE growing box anchored at the card top. As a fraction of the
 * card's height it: rests over the top ~1/3 as a Lifelane, grows continuously to
 * ~1/2 as you zoom out, then — at the snap to the Atlas day-grid — jumps to fill
 * most of the card. WorkSurface multiplies the chosen fraction by the live card
 * height to get pixels (for the band height + the `--region1-reserve`). */
export const TIMELINE_LIFELANE_MIN_FRAC = 0.33
export const TIMELINE_LIFELANE_MAX_FRAC = 0.5
export const TIMELINE_ATLAS_FRAC = 0.88

/** In Atlas the grid fills most of the card, but the do-list does NOT reserve all
 *  of that — it floats OVER the grid's lower edge as a compact block just above the
 *  (shrunken) dock. So the do-list region's top is reserved only to this fraction,
 *  giving the bottom-anchored create-row + ~3-row scroller room to sit over the grid. */
export const TIMELINE_ATLAS_DOLIST_TOP_FRAC = 0.5

/** Map the current zoom span (ms) + atlas flag to the Timeline's height fraction.
 *  In Atlas it's a constant (the grid fills most of the view). In Lifelane it lerps
 *  MIN→MAX as the span widens from `spanMinMs` (fully zoomed in) up to `spanSnapMs`
 *  (the Atlas threshold), so the band visibly grows as you zoom out toward the snap. */
export function timelineHeightFrac(
  spanMs: number,
  atlas: boolean,
  spanMinMs: number,
  spanSnapMs: number,
): number {
  if (atlas) return TIMELINE_ATLAS_FRAC
  const t = Math.min(1, Math.max(0, (spanMs - spanMinMs) / (spanSnapMs - spanMinMs)))
  return TIMELINE_LIFELANE_MIN_FRAC + t * (TIMELINE_LIFELANE_MAX_FRAC - TIMELINE_LIFELANE_MIN_FRAC)
}
